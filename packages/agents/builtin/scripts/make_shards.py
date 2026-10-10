#!/usr/bin/env python3
"""Split an application's source into shards for per-module rule extraction.

    python3 make_shards.py <app> [module-pattern] --source DIR --out DIR [--assessment DIR] [--all]

--source is the checkout of the application's source repository (read-only: nothing is written there).
With topology.json in --assessment (the workspace repository's assessment/<app>/ folder, written by the
map stage), one shard per map module (small modules of a domain merged); without it, one shard per
directory of source files. The list is written to <out>/extract-rules.modules.json as
[{"name", "domain", "files": [relative to the source dir], "loc"}], the form the
extract-rules workflow takes. --out is the step's output folder (a member may give the assessment
folder itself). Standard library only.
"""
import argparse
import fnmatch
import json
import os
import sys

SOURCE_EXT = {
    # mainframe and legacy business languages
    '.cbl', '.cob', '.cobol', '.cpy', '.pli', '.pl1', '.jcl', '.proc', '.rpg', '.rpgle', '.sqlrpgle', '.clle', '.nat', '.ada', '.adb', '.ads',
    '.asm', '.bms', '.map', '.pas', '.dpr', '.prg', '.f', '.for', '.f90', '.f77',
    # general purpose
    '.java', '.kt', '.scala', '.groovy', '.cs', '.vb', '.vbs', '.bas', '.cls', '.frm', '.fs', '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.m', '.mm',
    '.go', '.rs', '.py', '.rb', '.php', '.pl', '.pm', '.js', '.jsx', '.ts', '.tsx', '.swift', '.lua', '.tcl', '.erl', '.ex', '.exs', '.clj',
    '.hs', '.ml', '.r', '.sh', '.bat', '.ps1',
    # web and data
    '.asp', '.aspx', '.ascx', '.cshtml', '.jsp', '.jspx', '.sql', '.pks', '.pkb', '.plsql', '.tf',
}
SKIP_DIRS = {
    '.git', '.svn', '.hg', 'node_modules', 'vendor', 'third_party', 'thirdparty', 'dist', 'build', 'target', 'bin', 'obj', 'out',
    '__pycache__', '.venv', 'venv', '.tox', '.gradle', '.idea', 'coverage', 'fixtures', 'testdata', 'test-data', 'generated',
}
TEST_DIRS = {'test', 'tests', '__tests__', 'spec', 'specs'}
MAX_FILES = 25
MAX_LOC = 5000
SMALL = 300
TINY_ESTATE = 30
MAX_BYTES = 5_000_000
MAX_SCAN_FILES = 50_000
MAX_SCAN_DIRS = 50_000
MAX_TOTAL_BYTES = 100_000_000
MAX_TOPOLOGY_BYTES = 2_000_000


class DataError(ValueError):
    """Invalid or unsafe input data."""


def within(root, path):
    root = os.path.realpath(root)
    real = os.path.realpath(path)
    try:
        return os.path.commonpath((root, real)) == root
    except ValueError:
        return False


def too_broad(path):
    """The filesystem root, the home directory or one of its parents, or a top-level system directory: never an application's code."""
    if not path or path.strip() in ('~', '~/'):
        return True
    real = os.path.realpath(os.path.expanduser(path))
    home = os.path.realpath(os.path.expanduser('~'))
    parts = [p for p in real.split(os.sep) if p]
    return real == os.sep or len(parts) < 2 or home == real or home.startswith(real + os.sep)


def count_lines(path):
    try:
        size = os.path.getsize(path)
        if size > MAX_BYTES:
            raise DataError(f"source file exceeds the {MAX_BYTES}-byte limit: {path}")
        with open(path, 'rb') as handle:
            data = handle.read(MAX_BYTES + 1)
    except OSError as error:
        raise DataError(f"cannot read source file {path}: {error}") from error
    if len(data) > MAX_BYTES:
        raise DataError(f"source file exceeds the {MAX_BYTES}-byte limit: {path}")
    if b'\x00' in data:
        raise DataError(f"unexpected binary content in source file: {path}")
    try:
        text = data.decode('utf-8-sig')
    except UnicodeDecodeError as error:
        raise DataError(f"source file is not valid UTF-8: {path}") from error
    return len(text.splitlines())


def matcher(pattern):
    """A glob matches a name or a path (or its file name); a plain name such as `jetty-util` also matches what lies beneath it."""
    plain_name = not any(ch in pattern for ch in '*?[')
    wanted = pattern.strip('/')

    def match(text):
        if fnmatch.fnmatch(text, pattern) or fnmatch.fnmatch(os.path.basename(text), pattern):
            return True
        if plain_name:
            padded = '/' + text.strip('/') + '/'
            return padded.startswith('/' + wanted + '/') or ('/' + wanted + '/') in padded
        return False

    return match


def contained(source, rel):
    """True when `rel` under the source directory really resolves inside it (no `..`, no symlink out)."""
    if not isinstance(rel, str) or not rel or '\x00' in rel:
        return False
    root = os.path.realpath(source)
    real = os.path.realpath(os.path.join(source, rel))
    return within(root, real)


def relative_to_source(path, source):
    """A topology `file` may be absolute or source-relative: return it source-relative."""
    if not isinstance(path, str) or not path or '\x00' in path:
        return None
    path = path.replace('\\', '/')
    root = os.path.realpath(source)
    if os.path.isabs(path):
        try:
            rel = os.path.relpath(os.path.realpath(path), root).replace(os.sep, '/')
        except ValueError:          # another drive
            return None
        return None if rel == '..' or rel.startswith('../') else rel
    normalized = os.path.normpath(path).replace('\\', '/')
    if normalized == '..' or normalized.startswith('../'):
        return normalized
    root_alias = os.path.normpath(source).replace('\\', '/') + '/'
    if normalized.startswith(root_alias):
        normalized = normalized[len(root_alias):]
    return normalized


def shared_locations(modules, source):
    """Locations several map modules share, or that are directories: modules without files of their own cannot be sharded."""
    seen, shared = {}, []
    for module in modules:
        for rel in module['files']:
            seen.setdefault(rel, []).append(module['name'])
    for rel, owners in seen.items():
        if len(owners) > 1 or os.path.isdir(os.path.join(source, rel)):
            shared.append((rel, len(owners)))
    return shared


def from_topology(topology, source, pattern):
    if not isinstance(topology, dict) or not isinstance(topology.get('root'), dict):
        raise DataError('topology.json must be an object with a root node')
    modules, names, ids, escaped = [], set(), set(), []

    def walk(node, domain, depth=0):
        if depth > 100:
            raise DataError('topology.json exceeds the maximum node depth')
        if not isinstance(node, dict):
            raise DataError('topology.json contains a non-object node')
        node_id = node.get('id')
        if node_id is not None:
            if not isinstance(node_id, str) or not node_id or node_id in ids:
                raise DataError('topology.json contains an invalid or duplicate node id')
            ids.add(node_id)
        kind = node.get('kind')
        if kind == 'domain':
            domain = node.get('name') or node.get('id', '')
        if kind == 'module' and node.get('file'):
            if not isinstance(node['file'], str):
                raise DataError('topology module file must be a path string')
            rel = relative_to_source(node['file'], source)
            if rel and not contained(source, rel):
                escaped.append(rel)
            elif rel:
                name = node.get('name') or node.get('id')
                if not isinstance(name, str):
                    raise DataError('topology module name must be a string')
                if name in names:
                    name = str(node.get('id') or name)  # names can repeat across domains; ids are unique
                names.add(name)
                loc = node.get('loc')
                if loc is not None and (not isinstance(loc, int) or isinstance(loc, bool) or loc < 0):
                    raise DataError('topology module loc must be a non-negative integer')
                modules.append({'name': name, 'domain': domain, 'files': [rel], 'loc': loc or None})
        children = node.get('children', [])
        if not isinstance(children, list):
            raise DataError('topology node children must be an array')
        if len(ids) + len(children) > 50_000:
            raise DataError('topology.json contains too many nodes')
        for child in children:
            walk(child, domain, depth + 1)

    walk(topology['root'], '')
    total = len(modules)
    unusable = shared_locations(modules, source)
    if unusable:
        raise ValueError('%d map module(s) share a location or name a directory instead of a file (first: %s)' % (len(unusable), unusable[0][0]))
    if pattern:
        match = matcher(pattern)
        modules = [m for m in modules if match(m['name']) or any(match(f) for f in m['files'])]
    # merge small modules of the same domain; never split one
    shards, pool, counter = [], {}, {}
    for module in modules:
        if module['loc'] and module['loc'] < SMALL:
            current = pool.get(module['domain'])
            if current is None or current['loc'] >= SMALL or len(current['files']) >= MAX_FILES:
                counter[module['domain']] = counter.get(module['domain'], 0) + 1
                current = pool[module['domain']] = {
                    'name': f"{module['domain'] or 'misc'}:small-{counter[module['domain']]}",
                    'domain': module['domain'], 'files': [], 'loc': 0,
                }
                shards.append(current)
            current['files'] += module['files']
            current['loc'] += module['loc']
        else:
            shards.append(module)
    return shards, len(modules), escaped, total


def from_tree(source, pattern, include_all):
    by_dir, skipped = {}, {'vendored or generated': 0, 'tests': 0, 'unreadable or binary': 0, 'symbolic links': 0}
    scanned = 0
    visited_directories = 0
    total_bytes = 0

    def walk_error(error):
        raise DataError(f'cannot scan source directory: {error}')

    for root, dirs, files in os.walk(source, onerror=walk_error):
        visited_directories += 1
        if visited_directories > MAX_SCAN_DIRS:
            raise DataError(f'source tree exceeds the {MAX_SCAN_DIRS}-directory limit')
        kept = []
        for d in sorted(dirs):
            if d in SKIP_DIRS or (d.startswith('.') and d not in ('.',)):
                skipped['vendored or generated'] += 1
            elif d.lower() in TEST_DIRS and not include_all:
                skipped['tests'] += 1
            else:
                kept.append(d)
        dirs[:] = kept
        for name in sorted(files):
            if os.path.splitext(name)[1].lower() not in SOURCE_EXT or name.endswith('.min.js'):
                continue
            path = os.path.join(root, name)
            if os.path.islink(path):
                if not within(source, path):
                    skipped['symbolic links'] += 1
                    continue
                skipped['symbolic links'] += 1
                continue
            scanned += 1
            if scanned > MAX_SCAN_FILES:
                raise DataError(f'source tree exceeds the {MAX_SCAN_FILES}-file limit')
            total_bytes += os.path.getsize(path)
            if total_bytes > MAX_TOTAL_BYTES:
                raise DataError(f'source files exceed the {MAX_TOTAL_BYTES}-byte aggregate limit')
            lines = count_lines(path)
            rel = os.path.relpath(path, source).replace(os.sep, '/')
            if not within(source, path):
                raise DataError(f'source path escapes --source: {rel}')
            by_dir.setdefault(os.path.dirname(rel), []).append((rel, lines))
    whole = sum(len(fs) for fs in by_dir.values())
    if pattern:
        match = matcher(pattern)
        by_dir = {d: [f for f in fs if match(f[0])] for d, fs in by_dir.items()}
    shards, total = [], 0
    for directory in sorted(by_dir):
        entries = by_dir[directory]
        total += len(entries)
        chunk, chunk_loc, part = [], 0, 1
        label = directory or '.'
        for rel, lines in entries + [(None, 0)]:
            if rel is None or (chunk and (len(chunk) >= MAX_FILES or chunk_loc + lines > MAX_LOC)):
                if chunk:
                    shards.append({'name': label if part == 1 else f'{label}#{part}', 'domain': directory,
                                   'files': [f for f, _ in chunk], 'loc': chunk_loc or None})
                    part += 1
                chunk, chunk_loc = [], 0
            if rel is not None:
                chunk.append((rel, lines))
                chunk_loc += lines
    return shards, total, skipped, whole


def main(argv):
    ap = argparse.ArgumentParser(description="Split an application's source into shards for per-module rule extraction.")
    ap.add_argument('app', help='the application id from kintsugi.yaml (a label only)')
    ap.add_argument('pattern', nargs='?', default='', help='only the modules or files that match this glob or plain name')
    ap.add_argument('--source', required=True, help="the checkout of the application's source repository (read-only)")
    ap.add_argument('--assessment', help='the assessment/<app>/ folder of the workspace repository (topology.json is read from it)')
    ap.add_argument('--out', required=True, help='the folder extract-rules.modules.json is written to')
    ap.add_argument('--all', action='store_true', help='keep test folders too')
    args = ap.parse_args(argv[1:])
    if not args.out.strip() or (args.assessment is not None and not args.assessment.strip()):
        print('make_shards.py: --out and any supplied --assessment must be non-empty explicit paths', file=sys.stderr)
        return 1
    pattern = args.pattern
    source_arg = args.source
    source = os.path.realpath(os.path.expanduser(source_arg)) if source_arg else ''
    print(f'source: {source_arg}')
    if too_broad(source_arg) or (source and os.path.isdir(source) and too_broad(source)):
        print(f'{source} is too broad to be one application (the filesystem root, your home directory or a top-level directory). '
              'Point --source at the checkout that holds the code.', file=sys.stderr)
        return 1
    if not os.path.isdir(source):
        print(f"No code at {source}. Give --source the checkout of the application's source repository.", file=sys.stderr)
        return 1

    out_root = os.path.abspath(os.path.expanduser(args.out))
    if within(source, out_root):
        print('make_shards.py: --out must be outside the read-only --source checkout', file=sys.stderr)
        return 1
    out = os.path.join(out_root, 'extract-rules.modules.json')
    notes = []
    try:
        if args.assessment:
            assessment = os.path.realpath(os.path.expanduser(args.assessment))
            topo_path = os.path.join(assessment, 'topology.json') if os.path.isdir(assessment) else ''
            if topo_path and not within(assessment, topo_path):
                raise DataError('topology.json escapes the assessment directory')
        else:
            assessment, topo_path = '', ''

        if topo_path and os.path.isfile(topo_path):
            if os.path.getsize(topo_path) > MAX_TOPOLOGY_BYTES:
                raise DataError(f'topology.json exceeds the {MAX_TOPOLOGY_BYTES}-byte limit')
            with open(topo_path, 'rb') as handle:
                raw = handle.read(MAX_TOPOLOGY_BYTES + 1)
            if len(raw) > MAX_TOPOLOGY_BYTES:
                raise DataError(f'topology.json exceeds the {MAX_TOPOLOGY_BYTES}-byte limit')
            try:
                topology = json.loads(raw.decode('utf-8-sig'))
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                raise DataError(f'topology.json is not valid UTF-8 JSON: {error}') from error
            try:
                shards, modules, escaped, whole = from_topology(topology, source, pattern)
                origin = f'{modules} map modules'
                if escaped:
                    notes.append(f'{len(escaped)} map file(s) resolve outside the source directory and were left out (first: {escaped[0]})')
                missing = [f for shard in shards for f in shard['files'] if not os.path.isfile(os.path.join(source, f))]
                if missing:
                    notes.append(f'{len(missing)} file(s) named by the map do not exist under the source directory (first: {missing[0]})')
            except DataError:
                raise
            except (ValueError, KeyError, OSError, TypeError, AttributeError, RecursionError) as error:
                print(f'note: the map cannot be sharded by module ({error}); reading the directory tree instead.')
                shards, files, skipped, whole = from_tree(source, pattern, args.all)
                origin = f'{files} source files (tree)'
        else:
            shards, files, skipped, whole = from_tree(source, pattern, args.all)
            origin = f'{files} source files (no topology.json: read from the directory tree)'
            left_out = ', '.join(f'{n} {kind}' for kind, n in skipped.items() if n)
            if left_out:
                notes.append(f'left out: {left_out}')

        if not shards:
            print('0 shards: the pattern matched nothing, or no source files were found. Nothing was written.', file=sys.stderr)
            return 1

        if os.path.islink(out_root):
            raise DataError(f'refusing to write through a symbolic link: {out_root}')
        os.makedirs(out_root, exist_ok=True)
        if not within(out_root, out) or os.path.islink(out) or os.path.islink(out + '.tmp'):
            raise DataError(f'refusing to write outside --out or through a symbolic link: {out}')
        tmp = out + '.tmp'
        with open(tmp, 'w', encoding='utf-8', newline='\n') as handle:
            json.dump(shards, handle, indent=1, ensure_ascii=False)
            handle.write('\n')
        os.replace(tmp, out)
    except (DataError, OSError, RecursionError) as error:
        print(f'make_shards.py: {error}', file=sys.stderr)
        return 1

    file_count = sum(len(shard['files']) for shard in shards)
    loc = sum(shard['loc'] or 0 for shard in shards)
    print(f'{len(shards)} shards from {origin}, {file_count} files, {loc} lines -> {out}')
    if whole < TINY_ESTATE:
        print(f'tiny estate: the application has fewer than {TINY_ESTATE} source files, so sharding adds little (run the workflow in lens mode).')
    for note in notes:
        print(f'note: {note}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
