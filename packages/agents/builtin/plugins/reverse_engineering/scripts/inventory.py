#!/usr/bin/env python3
"""Build a bounded, deterministic source inventory and complexity estimate.

Every file record carries the sha256 of its bytes (`sha256`), so the item catalog can tell a changed
item by its digest; a non-source file larger than MAX_FILE_BYTES has no hash.
"""

import argparse
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import docmd  # noqa: E402
import paths  # noqa: E402

MAX_FILE_BYTES = 5_000_000
MAX_TOTAL_BYTES = 100_000_000
MAX_FILES = 25_000
MAX_DIRECTORIES = 50_000
MAX_SOURCE_FILES = 10_000
MAX_OUTPUT_BYTES = 8_000_000

# The `.git` file of a linked worktree or submodule checkout points at the repository: not source.
SKIP_FILES = {'.git'}
SKIP_DIRS = {
    '.git', '.hg', '.svn', '.idea', '.vscode', '__pycache__', '.venv', 'venv',
    'node_modules', 'vendor', 'vendors', 'dist', 'build', 'target', 'out',
    'coverage', 'bin', 'obj',
}
LANGUAGES = {
    '.asm': 'Assembly', '.bas': 'BASIC', '.c': 'C', '.cc': 'C++', '.cpp': 'C++',
    '.cbl': 'COBOL', '.cob': 'COBOL', '.cs': 'C#', '.css': 'CSS', '.dart': 'Dart',
    '.go': 'Go', '.h': 'C/C++', '.hpp': 'C++', '.html': 'HTML', '.java': 'Java',
    '.js': 'JavaScript', '.jsx': 'JavaScript', '.kt': 'Kotlin', '.kts': 'Kotlin',
    '.md': 'Markdown', '.mjs': 'JavaScript', '.php': 'PHP', '.pl': 'Perl',
    '.py': 'Python', '.rb': 'Ruby', '.rs': 'Rust', '.scala': 'Scala', '.sh': 'Shell',
    '.sql': 'SQL', '.swift': 'Swift', '.ts': 'TypeScript', '.tsx': 'TypeScript',
    '.vb': 'Visual Basic', '.xml': 'XML', '.yaml': 'YAML', '.yml': 'YAML',
    # Visual Basic 6: classes, forms, user controls and designers.
    '.cls': 'Visual Basic', '.frm': 'Visual Basic', '.ctl': 'Visual Basic', '.dsr': 'Visual Basic',
}
C_FAMILY = {'C', 'C++', 'C#', 'C/C++', 'Java', 'JavaScript', 'TypeScript', 'Go', 'Kotlin', 'Swift', 'PHP', 'Dart', 'Scala'}
BRANCHES = {
    'COBOL': ('IF', 'EVALUATE', 'PERFORM'),
    'Python': ('if', 'for', 'while', 'except'),
    'Ruby': ('if', 'unless', 'for', 'while', 'rescue', 'when'),
    'Rust': ('if', 'for', 'while', 'match'),
    'SQL': ('case', 'when'),
    'Visual Basic': ('if', 'elseif', 'for', 'while', 'case', 'until'),
    'BASIC': ('if', 'elseif', 'for', 'while', 'case', 'until'),
}
DEFAULT_BRANCHES = ('if', 'for', 'while', 'case', 'catch')
COMMENT_PREFIXES = ('#', '//', '/*', '*', '*/', '--', '<!--', '-->', '*>')


def branch_pattern(language):
    words = ('if', 'for', 'while', 'case', 'catch') if language in C_FAMILY else BRANCHES.get(language, DEFAULT_BRANCHES)
    return re.compile(r'\b(?:' + '|'.join(re.escape(word) for word in words) + r')\b', re.IGNORECASE)


class DataError(ValueError):
    """Invalid, oversized, or unsafe input data."""


def within(root, path):
    root = os.path.realpath(root)
    real = os.path.realpath(path)
    try:
        return os.path.commonpath((root, real)) == root
    except ValueError:
        return False


def read_source(path):
    return decode_source(read_bounded(path), path)


def read_bounded(path):
    try:
        size = os.path.getsize(path)
        if size > MAX_FILE_BYTES:
            raise DataError(f'source file exceeds the {MAX_FILE_BYTES}-byte limit: {path}')
        with open(path, 'rb') as handle:
            data = handle.read(MAX_FILE_BYTES + 1)
    except OSError as error:
        raise DataError(f'cannot read source file {path}: {error}') from error
    if len(data) > MAX_FILE_BYTES:
        raise DataError(f'source file exceeds the {MAX_FILE_BYTES}-byte limit: {path}')
    return data


def decode_source(data, path):
    if b'\x00' in data:
        raise DataError(f'unexpected binary content in source file: {path}')
    try:
        return data.decode('utf-8-sig')
    except UnicodeDecodeError:
        # Legacy sources are often in a single-byte code page (Windows-1252, Latin-1); line and
        # keyword counts do not depend on the exact characters, and Latin-1 decodes any byte.
        return data.decode('latin-1')


def language_for(path):
    return LANGUAGES.get(os.path.splitext(path)[1].lower(), 'Other')


def analyze(path, text, language):
    lines = text.splitlines()
    blank = 0
    comments = 0
    branches = 0
    pattern = branch_pattern(language)
    for line in lines:
        stripped = line.strip()
        is_comment = stripped.startswith(COMMENT_PREFIXES)
        if language == 'COBOL' and len(line) > 6 and line[6] in ('*', '/'):
            is_comment = True
        if language in ('Visual Basic', 'BASIC') and (stripped.startswith("'") or stripped.upper().startswith('REM ')):
            is_comment = True
        if not stripped:
            blank += 1
        elif is_comment:
            comments += 1
        else:
            branches += len(pattern.findall(line))
    code_lines = max(0, len(lines) - blank - comments)
    return {
        'path': path,
        'language': language,
        'lines': len(lines),
        'blankLines': blank,
        'commentLines': comments,
        'codeLines': code_lines,
        'sloc': code_lines,
        'cyclomaticComplexity': (1 + branches) if code_lines else 0,
    }



def source_commit(source):
    git_dir = os.path.join(source, '.git')
    if not os.path.isdir(git_dir) or not within(source, git_dir):
        return 'not available'
    try:
        raw = read_source(os.path.join(git_dir, 'HEAD')).decode('ascii').strip()
    except (DataError, UnicodeDecodeError):
        return 'not available'
    if re.fullmatch(r'[0-9a-fA-F]{40,64}', raw):
        return raw.lower()
    if not raw.startswith('ref: '):
        return 'not available'
    ref = raw[5:]
    if not ref or ref.startswith('/') or '..' in ref.split('/'):
        return 'not available'
    path = os.path.join(git_dir, *ref.split('/'))
    if within(source, path) and os.path.isfile(path):
        try:
            value = read_source(path).decode('ascii').strip()
            if re.fullmatch(r'[0-9a-fA-F]{40,64}', value):
                return value.lower()
        except (DataError, UnicodeDecodeError):
            pass
    return 'not available'

def parse_sources_argument(value):
    """The `--sources` spec as [(repository id, commit)]."""
    try:
        return paths.parse_sources(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError(str(error)) from error


def inventory(source, app, sources=None):
    """`source` is the folder the legacy repositories are mounted in, one folder per repository (ADR-0052), and `sources`
    their [(repository id, commit)]. Without `sources` the folder is read as one repository: its name and its HEAD."""
    if not isinstance(source, str) or not source.strip():
        raise DataError('--source must be a non-empty explicit checkout path')
    root = os.path.realpath(os.path.expanduser(source))
    if not os.path.isdir(root):
        raise DataError(f'--source is not a directory: {source}')
    for repo, _ in sources or []:
        # A source named in the provenance must be a folder of the tree that is measured.
        if not os.path.isdir(os.path.join(root, repo)):
            raise DataError(f'--sources names {repo}, which is not a folder of --source')
    files = []
    scanned = 0
    visited_directories = 0
    total_bytes = 0

    def walk_error(error):
        raise DataError(f'cannot scan source directory: {error}')

    for current, directories, names in os.walk(root, topdown=True, followlinks=False, onerror=walk_error):
        visited_directories += 1
        if visited_directories > MAX_DIRECTORIES:
            raise DataError(f'source tree exceeds the {MAX_DIRECTORIES}-directory limit')
        kept = []
        for name in sorted(directories):
            path = os.path.join(current, name)
            if name in SKIP_DIRS or os.path.islink(path):
                if os.path.islink(path) and not within(root, path):
                    raise DataError(f'source directory symlink escapes --source: {os.path.relpath(path, root)}')
                continue
            if not within(root, path):
                raise DataError(f'source directory escapes --source: {os.path.relpath(path, root)}')
            kept.append(name)
        directories[:] = kept
        for name in sorted(names):
            path = os.path.join(current, name)
            if name in SKIP_FILES:
                continue
            if os.path.islink(path):
                if not within(root, path):
                    raise DataError(f'source file symlink escapes --source: {os.path.relpath(path, root)}')
                continue
            if not os.path.isfile(path) or not within(root, path):
                raise DataError(f'unsafe source path: {path}')
            scanned += 1
            if scanned > MAX_FILES:
                raise DataError(f'source tree exceeds the {MAX_FILES}-file limit')
            size = os.path.getsize(path)
            total_bytes += size
            if total_bytes > MAX_TOTAL_BYTES:
                raise DataError(f'source tree exceeds the {MAX_TOTAL_BYTES}-byte scanned-data limit')
            rel = os.path.relpath(path, root).replace(os.sep, '/')
            language = language_for(rel)
            record = {'path': rel, 'bytes': size, 'language': language}
            if language != 'Other':
                data = read_bounded(path)
                record = analyze(rel, decode_source(data, path), language) | {'bytes': size, 'sha256': hashlib.sha256(data).hexdigest()}
                files.append(record)
                if len(files) > MAX_SOURCE_FILES:
                    raise DataError(f'source tree exceeds the {MAX_SOURCE_FILES}-source-file limit')
            else:
                if size <= MAX_FILE_BYTES:
                    record['sha256'] = hashlib.sha256(read_bounded(path)).hexdigest()
                files.append(record)

    source_files = [item for item in files if item['language'] != 'Other']
    language_counts = {}
    per_language = {}
    total_lines = code_lines = complexity = 0
    for item in source_files:
        lang = item['language']
        language_counts[lang] = language_counts.get(lang, 0) + 1
        metrics = per_language.setdefault(lang, {'files': 0, 'lines': 0, 'codeLines': 0, 'complexity': 0})
        metrics['files'] += 1
        metrics['lines'] += item['lines']
        metrics['codeLines'] += item['codeLines']
        metrics['sloc'] = metrics['codeLines']
        metrics['complexity'] += item['cyclomaticComplexity']
        total_lines += int(item['lines'])
        code_lines += int(item['codeLines'])
        complexity += int(item['cyclomaticComplexity'])
    ksloc = round(code_lines / 1000, 3)
    complexity_index = round(2.94 * (ksloc ** 1.10), 2) if ksloc else 0.0
    ranked = sorted(source_files, key=lambda item: (-item['cyclomaticComplexity'], item['path']))
    for metrics in per_language.values():
        metrics['ksloc'] = round(metrics['codeLines'] / 1000, 3)
    return {
        'app': app,
        'sources': [f'{repo}@{commit}' for repo, commit in (sources or [(os.path.basename(os.path.normpath(source)), source_commit(root))])],
        'method': 'static inventory (UTF-8, Latin-1 fallback); per-file decision keywords are counted as a language-neutral complexity proxy',
        'complexityIndexFormula': '2.94 × KSLOC^1.10',
        'fileCount': len(files),
        'sourceFileCount': len(source_files),
        'totalBytes': sum(item['bytes'] for item in files),
        'totalLines': total_lines,
        'codeLines': code_lines,
        'sloc': code_lines,
        'ksloc': ksloc,
        'languages': {key: language_counts[key] for key in sorted(language_counts)},
        'languageMetrics': {key: per_language[key] for key in sorted(per_language)},
        'complexity': complexity,
        'complexityPerKsloc': round(complexity / ksloc, 2) if ksloc else None,
        'complexityIndex': complexity_index,
        'mostComplexFiles': [
            {'path': item['path'], 'cyclomaticComplexity': item['cyclomaticComplexity']}
            for item in ranked[:25]
        ],
        'files': sorted(files, key=lambda item: item['path']),
    }


SIZE_BUCKETS = (('<50', 50), ('50-99', 100), ('100-249', 250), ('250-499', 500), ('500-999', 1000), ('1k-2.5k', 2500), ('2.5k+', float('inf')))
MAX_DIRECTORIES_LISTED = 60
MOST_COMPLEX = 50


def directory_of(path, depth):
    parts = path.split('/')[:-1]
    return '(root)' if not parts else '/'.join(parts[:depth])


def directory_rollup(code):
    """SLOC and complexity per directory; goes deeper (up to 4 levels) while one directory holds most of the code."""
    total = sum(item['sloc'] for item in code)
    rows, depth = [], 1
    while depth <= 4:
        groups = {}
        for item in code:
            name = directory_of(item['path'], depth)
            stat = groups.setdefault(name, {'path': name, 'files': 0, 'sloc': 0, 'complexity': 0})
            stat['files'] += 1
            stat['sloc'] += item['sloc']
            stat['complexity'] += item['cyclomaticComplexity']
        rows = sorted(groups.values(), key=lambda stat: (-stat['sloc'], stat['path']))
        if total == 0 or rows[0]['sloc'] / total < 0.6 or len(rows) > 40:
            break
        depth += 1
    return min(depth, 4), rows


def summarize(data):
    """What the committed inventory keeps of the per-file records: roll-ups, a distribution, the signals
    and the most complex files. The per-file records themselves stay in the run's scratch."""
    code = [item for item in data['files'] if item.get('language') != 'Other' and item.get('sloc', 0) > 0]
    depth, rows = directory_rollup(code)
    buckets = [0] * len(SIZE_BUCKETS)
    for item in code:
        buckets[next(index for index, (_, below) in enumerate(SIZE_BUCKETS) if item['sloc'] < below)] += 1
    by_complexity = sorted(code, key=lambda item: (-item['cyclomaticComplexity'], item['path']))
    total = sum(item['cyclomaticComplexity'] for item in by_complexity)
    running, half = 0, 0
    for item in by_complexity:
        running += item['cyclomaticComplexity']
        half += 1
        if running >= total / 2:
            break
    sizes = sorted(item['sloc'] for item in code)
    middle = len(sizes) // 2
    median = 0 if not sizes else sizes[middle] if len(sizes) % 2 else (sizes[middle - 1] + sizes[middle]) / 2
    return {
        'directoryDepth': depth,
        'directories': rows[:MAX_DIRECTORIES_LISTED],
        'sizeDistribution': [(label, buckets[index]) for index, (label, _) in enumerate(SIZE_BUCKETS)],
        'codeFiles': len(code),
        'medianSloc': median,
        'halfComplexityFiles': half if total else 0,
        'topTenShare': round(sum(item['cyclomaticComplexity'] for item in by_complexity[:10]) / total, 4) if total else 0,
        'oversized': sum(1 for item in code if item['sloc'] >= 1000),
        'mostComplex': by_complexity[:MOST_COMPLEX],
    }


def render_markdown(data, summary):
    """inventory.md: front matter with the figures of record, then Languages, Directories, Size distribution
    and the most complex files, as tables."""
    fields = {
        'app': data['app'],
        'sources': data['sources'],
        'method': data['method'],
        'complexityIndexFormula': data['complexityIndexFormula'],
        'fileCount': data['fileCount'],
        'sourceFileCount': data['sourceFileCount'],
        'totalBytes': data['totalBytes'],
        'totalLines': data['totalLines'],
        'sloc': data['sloc'],
        'ksloc': data['ksloc'],
        'complexity': data['complexity'],
        'complexityPerKsloc': data['complexityPerKsloc'],
        'complexityIndex': data['complexityIndex'],
        'directoryDepth': summary['directoryDepth'],
        'codeFiles': summary['codeFiles'],
        'medianSloc': summary['medianSloc'],
        'halfComplexityFiles': summary['halfComplexityFiles'],
        'topTenShare': summary['topTenShare'],
        'oversized': summary['oversized'],
    }
    languages = [
        [language, metrics['files'], metrics['lines'], metrics['sloc'], metrics['complexity']]
        for language, metrics in sorted(data['languageMetrics'].items(), key=lambda entry: (-entry[1]['sloc'], -entry[1]['files'], entry[0]))
    ]
    return '\n'.join([
        docmd.front_matter(fields),
        f'# Inventory of {data["app"]}',
        '',
        f'Measured at {", ".join(f"`{entry}`" for entry in data["sources"])}: {data["sourceFileCount"]:,} source files, {data["sloc"]:,} lines of code. '
        'The per-file records stay in the run; this document keeps the figures of record and their roll-ups.',
        '',
        '## Languages',
        '',
        docmd.table(['Language', 'Files', 'Lines', 'SLOC', 'Complexity'], languages),
        '## Directories',
        '',
        docmd.table(['Path', 'Files', 'SLOC', 'Complexity'], [[row['path'], row['files'], row['sloc'], row['complexity']] for row in summary['directories']]),
        '## Size distribution',
        '',
        docmd.table(['SLOC per file', 'Files'], summary['sizeDistribution']),
        '## Most complex files',
        '',
        docmd.table(
            ['Path', 'Language', 'Lines', 'SLOC', 'Complexity'],
            [[item['path'], item['language'], item['lines'], item['sloc'], item['cyclomaticComplexity']] for item in summary['mostComplex']],
        ),
    ])


def write_outputs(out, scratch, data, source_root):
    """inventory.md into --out and the per-file inventory.json into --scratch (never committed)."""
    for folder in (out, scratch):
        if within(source_root, folder):
            raise DataError('--out and --scratch must be outside the read-only --source checkout')
        if os.path.islink(folder):
            raise DataError(f'refusing to write through a symbolic link: {folder}')
    encoded = json.dumps(data, ensure_ascii=False, indent=1)
    if len(encoded.encode('utf-8')) > MAX_OUTPUT_BYTES:
        raise DataError(f'inventory output exceeds the {MAX_OUTPUT_BYTES}-byte limit')
    document = os.path.join(os.path.realpath(out), 'inventory.md')
    docmd.write_text(document, render_markdown(data, summarize(data)))
    docmd.write_text(os.path.join(os.path.realpath(scratch), 'inventory.json'), encoded)
    return document


def main(argv=None):
    parser = argparse.ArgumentParser(description='Build a bounded source inventory and static complexity estimate.')
    parser.add_argument('app', help='application id used in the inventory heading')
    parser.add_argument('--sources', type=parse_sources_argument, help='the legacy repositories mounted in --source and their commits, `id@commit,id@commit`')
    parser.add_argument('--source', required=True, help='read-only source folder: one folder per legacy repository')
    parser.add_argument('--out', required=True, help='folder where inventory.md is written')
    parser.add_argument('--scratch', required=True, help='folder where the per-file inventory.json is written (not committed)')
    args = parser.parse_args(argv[1:] if argv is not None else None)
    try:
        if not args.out.strip() or not args.scratch.strip():
            raise DataError('--out and --scratch must be non-empty explicit output folders')
        data = inventory(args.source, args.app, args.sources)
        source_root = os.path.realpath(os.path.expanduser(args.source))
        path = write_outputs(os.path.abspath(os.path.expanduser(args.out)), os.path.abspath(os.path.expanduser(args.scratch)), data, source_root)
    except (DataError, OSError, RecursionError) as error:
        print(f'inventory.py: {error}', file=sys.stderr)
        return 1
    print(f'inventory.md: {data["sourceFileCount"]} source files, {data["codeLines"]} code lines -> {path}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
