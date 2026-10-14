#!/usr/bin/env python3
"""Propose the units of an application from the map's topology.json, for the understand stage.

    python3 units_from_topology.py <app> --assessment DIR --out DIR [--manifest FILE] [--max-units N]

--assessment is the document repository's assessment/<app>/ folder: topology.json (written by the map
stage) is required; inventory.json (assess), BUSINESS_RULES.md (extract-rules) and SECURITY_FINDINGS.md
(harden) are used when present. --manifest is kintsugi.yaml, read for `unitKinds` only. --out is the
folder units.json and the per-unit briefs (briefs/<module>/<unit>.json) are written to.

No code is read and nothing is parsed: the units are the map's leaves, grouped deterministically.
- A module is the map's domain (the nearest `domain` node; `core` for leaves outside any domain).
- A unit is one leaf (module, job, screen, ...); data stores are never units. Small leaves (fewer than
  SMALL lines) of one domain in one directory are grouped into one unit named after the directory.
- Above --max-units units, every leaf of a domain directory is grouped; if there are still too many,
  the largest units are kept and the rest are reported as left out.
- Size comes from the leaf's `loc`, else from inventory.json (code lines of the files under the leaf).
- Unit dependencies come from the map's edges between leaves of different units; data-store access
  from its read and write edges. Rules (RULE-NNN, by their **Source:** file) and security findings
  (SEC-NNN rows citing a file) are attached to the units owning the cited files, as candidates the
  specification job confirms.
- Problems a person should look at (leaves without a file, files claimed by several leaves, very
  large units, units left out) are listed under `ambiguities`.
Standard library only.
"""
import argparse
import json
import os
import re
import sys

SMALL = 150
LARGE = 5000
MAX_GROUP_FILES = 20
DEFAULT_MAX_UNITS = 240
MAX_JSON_BYTES = 8_000_000
MAX_TEXT_BYTES = 5_000_000
MAX_NODES = 50_000
NON_UNIT_KINDS = {'system', 'domain', 'datastore'}
# Map leaf kinds to the usual unit-kind names of kintsugi.yaml, in order of preference.
KIND_SYNONYMS = {
    'job': ['batch-job', 'batch', 'job'],
    'screen': ['screen', 'ui', 'page'],
    'module': ['module', 'program', 'component', 'service'],
}
RULE_HEADING = re.compile(r'^### (RULE-\d{3}): ')
RULE_SOURCE = re.compile(r'^\*\*Source:\*\*\s*`([^`]+)`')
FINDING_ID = re.compile(r'\bSEC-\d{3}\b')
CITED_PATH = re.compile(r'[`(\s|]([A-Za-z0-9_.@$\-][A-Za-z0-9_.@$/\-]*\.[A-Za-z0-9]+)(?::\d+(?:-\d+)?)?')


class DataError(ValueError):
    """Invalid or unsafe input."""


def within(root, path):
    root = os.path.realpath(root)
    real = os.path.realpath(path)
    try:
        return os.path.commonpath((root, real)) == root
    except ValueError:
        return False


def read_bytes(path, limit):
    if os.path.islink(path):
        raise DataError(f'refusing to read through a symbolic link: {os.path.basename(path)}')
    if os.path.getsize(path) > limit:
        raise DataError(f'{os.path.basename(path)} exceeds the {limit}-byte limit')
    with open(path, 'rb') as handle:
        data = handle.read(limit + 1)
    if len(data) > limit:
        raise DataError(f'{os.path.basename(path)} exceeds the {limit}-byte limit')
    return data


def read_json(path):
    try:
        return json.loads(read_bytes(path, MAX_JSON_BYTES).decode('utf-8-sig'))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DataError(f'{os.path.basename(path)} is not valid UTF-8 JSON: {error.__class__.__name__}') from error


def read_text(path):
    return read_bytes(path, MAX_TEXT_BYTES).decode('utf-8-sig', errors='replace')


def slug(text, fallback='unit'):
    value = re.sub(r'[^a-z0-9]+', '-', str(text).lower()).strip('-')[:60].strip('-')
    return value or fallback


def norm_path(value):
    if not isinstance(value, str) or not value or '\x00' in value:
        return None
    path = os.path.normpath(value.replace('\\', '/')).replace('\\', '/')
    if path.startswith('/') or path == '..' or path.startswith('../') or path == '.':
        return None
    return path


def unit_kinds(manifest):
    """`unitKinds` of kintsugi.yaml (flow list or block list); [] when absent."""
    if not manifest or not os.path.isfile(manifest):
        return []
    lines = read_text(manifest).splitlines()
    for index, line in enumerate(lines):
        match = re.match(r'^unitKinds:\s*(.*)$', line)
        if not match:
            continue
        rest = match.group(1).split('#', 1)[0].strip()
        if rest.startswith('['):
            return [item.strip().strip('\'"') for item in rest.strip('[]').split(',') if item.strip()]
        kinds = []
        for following in lines[index + 1:]:
            item = re.match(r'^\s+-\s*([^#]+)', following)
            if not item:
                break
            kinds.append(item.group(1).strip().strip('\'"'))
        return kinds
    return []


def choose_kind(leaf_kind, kinds):
    if not kinds:
        return leaf_kind
    if leaf_kind in kinds:
        return leaf_kind
    for candidate in KIND_SYNONYMS.get(leaf_kind, []):
        if candidate in kinds:
            return candidate
    return kinds[0]


def walk_topology(topology):
    """Leaves with their domain: [{id, name, kind, file, loc, domain, description}]."""
    if not isinstance(topology, dict) or not isinstance(topology.get('root'), dict):
        raise DataError('topology.json must be an object with a root node')
    leaves, seen = [], set()

    def walk(node, domain, depth):
        if depth > 100:
            raise DataError('topology.json exceeds the maximum node depth')
        if not isinstance(node, dict):
            raise DataError('topology.json contains a non-object node')
        node_id = node.get('id')
        if not isinstance(node_id, str) or not node_id:
            raise DataError('topology.json contains a node without an id')
        if node_id in seen:
            raise DataError(f'topology.json contains the duplicate node id {node_id!r}')
        seen.add(node_id)
        if len(seen) > MAX_NODES:
            raise DataError('topology.json contains too many nodes')
        kind = node.get('kind') if isinstance(node.get('kind'), str) else ''
        children = node.get('children') or []
        if not isinstance(children, list):
            raise DataError('topology node children must be an array')
        if kind == 'domain':
            name = node.get('name') if isinstance(node.get('name'), str) and node.get('name') else node_id
            domain = name[4:] if name.startswith('dom:') else name
        if not children and kind not in ('system', 'domain'):
            loc = node.get('loc')
            leaves.append({
                'id': node_id,
                'name': node.get('name') if isinstance(node.get('name'), str) and node.get('name') else node_id,
                'kind': kind or 'module',
                'file': norm_path(node.get('file')),
                'loc': loc if isinstance(loc, int) and not isinstance(loc, bool) and loc >= 0 else None,
                'domain': domain,
                'description': node.get('description') if isinstance(node.get('description'), str) else None,
            })
        for child in children:
            walk(child, domain, depth + 1)

    walk(topology['root'], None, 0)
    return leaves


def inventory_sizes(path):
    """{file: code lines} from inventory.json; {} when absent or unusable."""
    if not os.path.isfile(path):
        return {}
    data = read_json(path)
    sizes = {}
    for entry in data.get('files', []) if isinstance(data, dict) else []:
        if isinstance(entry, dict):
            rel = norm_path(entry.get('path'))
            lines = entry.get('codeLines', entry.get('lines'))
            if rel and isinstance(lines, int) and not isinstance(lines, bool):
                sizes[rel] = lines
    return sizes


def size_of(leaf, sizes):
    if leaf['loc'] is not None:
        return leaf['loc']
    if not leaf['file'] or not sizes:
        return None
    prefix = leaf['file'].rstrip('/') + '/'
    total = sum(lines for rel, lines in sizes.items() if rel == leaf['file'] or rel.startswith(prefix))
    return total or None


def rule_sources(path):
    """{RULE-NNN: cited file} from BUSINESS_RULES.md."""
    if not os.path.isfile(path):
        return None
    rules, current = {}, None
    for line in read_text(path).splitlines():
        heading = RULE_HEADING.match(line)
        if heading:
            current = heading.group(1)
            rules.setdefault(current, None)
            continue
        source = RULE_SOURCE.match(line)
        if source and current and rules.get(current) is None:
            rules[current] = norm_path(source.group(1).split(':', 1)[0].strip())
    return rules


def finding_files(path):
    """{SEC-NNN: [cited files]} from the rows of SECURITY_FINDINGS.md that name a finding and a path."""
    if not os.path.isfile(path):
        return None
    findings = {}
    for line in read_text(path).splitlines():
        ids = FINDING_ID.findall(line)
        if not ids:
            continue
        files = {norm_path(match) for match in CITED_PATH.findall(' ' + line)}
        files.discard(None)
        for finding in ids:
            findings.setdefault(finding, set()).update(files)
    return {key: sorted(value) for key, value in findings.items()}


def owns(unit_files, cited):
    return any(cited == rel or cited.startswith(rel.rstrip('/') + '/') for rel in unit_files)


def group(leaves, sizes, by_directory):
    """Units as lists of leaves, keyed (module, base name)."""
    units = {}
    pools = {}
    for leaf in leaves:
        module = slug(leaf['domain'], 'core') if leaf['domain'] else 'core'
        loc = size_of(leaf, sizes)
        leaf['size'] = loc
        directory = os.path.dirname(leaf['file']) if leaf['file'] else ''
        small = loc is not None and loc < SMALL
        if leaf['file'] and (by_directory or small):
            pool_key = (module, directory, 'all' if by_directory else 'small')
            pool = pools.get(pool_key)
            if pool is None or (not by_directory and len(pool) >= MAX_GROUP_FILES):
                pool = []
                part = sum(1 for key in units if key[0] == module and key[2] == pool_key)
                label = os.path.basename(directory) or 'root'
                name = label if part == 0 else f'{label}-{part + 1}'
                units[(module, name, pool_key)] = pool
                pools[pool_key] = pool
            pool.append(leaf)
        else:
            units[(module, leaf['name'], ('leaf', leaf['id']))] = [leaf]
    return units


def build_units(leaves, sizes, kinds, max_units):
    candidates = [leaf for leaf in leaves if leaf['kind'] not in NON_UNIT_KINDS]
    ambiguities = []
    grouped = group(candidates, sizes, by_directory=False)
    if len(grouped) > max_units:
        ambiguities.append(f'{len(grouped)} units from one leaf each exceed the limit of {max_units}: every leaf of a domain directory was grouped')
        grouped = group(candidates, sizes, by_directory=True)
    units, names = [], {}
    for (module, name, _), members in grouped.items():
        base = slug(members[0]['name'] if len(members) == 1 else name)
        count = names.get((module, base), 0) + 1
        names[(module, base)] = count
        unit = base if count == 1 else f'{base}-{count}'
        kinds_seen = sorted({leaf['kind'] for leaf in members})
        leaf_kind = max(kinds_seen, key=lambda kind: (sum(1 for leaf in members if leaf['kind'] == kind), kind))
        files = sorted({leaf['file'] for leaf in members if leaf['file']})
        sizes_known = [leaf['size'] for leaf in members if leaf['size'] is not None]
        units.append({
            'module': module,
            'unit': unit,
            'key': f'{module}/{unit}',
            'title': members[0]['name'] if len(members) == 1 else f'{name} ({len(members)} leaves)',
            'kind': choose_kind(leaf_kind, kinds),
            'leafKind': leaf_kind,
            'leaves': sorted(leaf['id'] for leaf in members),
            'files': files,
            'loc': sum(sizes_known) if sizes_known else None,
        })
    if len(units) > max_units:
        units.sort(key=lambda u: (-(u['loc'] or 0), u['key']))
        left = units[max_units:]
        units = units[:max_units]
        ambiguities.append(f'{len(left)} unit(s) left out above the limit of {max_units} (smallest first: {left[-1]["key"]})')
    return units, ambiguities


def link(units, leaves, topology, app, rules, findings):
    by_leaf = {}
    for unit in units:
        unit['id'] = f'{app}/{unit["key"]}'
        for leaf in unit['leaves']:
            by_leaf[leaf] = unit
    stores = {leaf['id']: leaf for leaf in leaves if leaf['kind'] == 'datastore'}
    entry = {e for e in topology.get('entryPoints', []) if isinstance(e, str)}
    for unit in units:
        unit.update({'entryPoint': any(leaf in entry for leaf in unit['leaves']), 'dependsOn': set(), 'usedBy': set(), 'dataStores': {}})
    for edge in topology.get('edges', []) if isinstance(topology.get('edges'), list) else []:
        if not isinstance(edge, dict):
            continue
        source, target, kind = edge.get('source'), edge.get('target'), edge.get('kind')
        origin = by_leaf.get(source)
        if origin is None:
            continue
        if target in stores:
            access = 'write' if kind == 'write' else 'read'
            origin['dataStores'].setdefault(target, set()).add(access)
            continue
        dest = by_leaf.get(target)
        if dest is not None and dest is not origin:
            origin['dependsOn'].add(dest['id'])
            dest['usedBy'].add(origin['id'])
    for unit in units:
        unit['dependsOn'] = sorted(unit['dependsOn'])
        unit['usedBy'] = sorted(unit['usedBy'])
        unit['dataStores'] = [
            {'id': store, 'name': stores[store]['name'], 'access': sorted(access)} for store, access in sorted(unit['dataStores'].items())
        ]
        unit['rules'] = sorted(rule for rule, cited in (rules or {}).items() if cited and owns(unit['files'], cited))
        unit['findings'] = sorted(finding for finding, cited in (findings or {}).items() if any(owns(unit['files'], c) for c in cited))
        unit['brief'] = f'briefs/{unit["key"]}.json'
    return [{'id': store, 'name': leaf['name']} for store, leaf in sorted(stores.items())]


def find_ambiguities(leaves, units):
    found = []
    claimed = {}
    for leaf in leaves:
        if leaf['kind'] in NON_UNIT_KINDS:
            continue
        if not leaf['file']:
            found.append(f'leaf {leaf["id"]} names no source file')
        else:
            claimed.setdefault(leaf['file'], []).append(leaf['id'])
    for rel, owners in sorted(claimed.items()):
        if len(owners) > 1:
            found.append(f'{rel} is claimed by {len(owners)} leaves ({", ".join(sorted(owners)[:3])})')
    for unit in units:
        if unit['loc'] is not None and unit['loc'] > LARGE:
            found.append(f'unit {unit["key"]} has {unit["loc"]} lines: consider splitting it')
    return found


def write_json(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.islink(path):
        raise DataError(f'refusing to write through a symbolic link: {path}')
    with open(path, 'w', encoding='utf-8', newline='\n') as handle:
        json.dump(value, handle, indent=1, ensure_ascii=False)
        handle.write('\n')


def main(argv):
    ap = argparse.ArgumentParser(description='Propose the units of an application from topology.json.')
    ap.add_argument('app', help='the application id from kintsugi.yaml')
    ap.add_argument('--assessment', required=True, help='the assessment/<app>/ folder (topology.json and optional inputs)')
    ap.add_argument('--out', required=True, help='the folder units.json and briefs/ are written to')
    ap.add_argument('--manifest', help='kintsugi.yaml (its unitKinds name the unit kinds)')
    ap.add_argument('--max-units', type=int, default=DEFAULT_MAX_UNITS, help='at most this many units')
    args = ap.parse_args(argv[1:])
    app = args.app
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,62}', app):
        print('units_from_topology.py: the application id must be kebab-case', file=sys.stderr)
        return 1
    if args.max_units < 1:
        print('units_from_topology.py: --max-units must be at least 1', file=sys.stderr)
        return 1
    assessment = os.path.realpath(args.assessment)
    out = os.path.abspath(args.out)
    try:
        topology_path = os.path.join(assessment, 'topology.json')
        if not os.path.isfile(topology_path):
            raise DataError('topology.json is missing: run the assess stage first')
        topology = read_json(topology_path)
        leaves = walk_topology(topology)
        sizes = inventory_sizes(os.path.join(assessment, 'inventory.json'))
        rules = rule_sources(os.path.join(assessment, 'BUSINESS_RULES.md'))
        findings = finding_files(os.path.join(assessment, 'SECURITY_FINDINGS.md'))
        kinds = unit_kinds(args.manifest)
        units, ambiguities = build_units(leaves, sizes, kinds, args.max_units)
        if not units:
            raise DataError('the map has no leaf that can be a unit (only data stores, or no leaves at all)')
        stores = link(units, leaves, topology, app, rules, findings)
        ambiguities = find_ambiguities(leaves, units) + ambiguities
        units.sort(key=lambda u: u['key'])
        described = {leaf['id']: leaf['description'] for leaf in leaves if leaf['description']}
        for unit in units:
            brief = dict(unit)
            brief['leafDescriptions'] = {leaf: described[leaf] for leaf in unit['leaves'] if leaf in described}
            target = os.path.join(out, *unit['brief'].split('/'))
            if not within(out, target):
                raise DataError(f'unit path escapes --out: {unit["key"]}')
            write_json(target, brief)
        result = {
            'app': app,
            'generatedBy': 'units_from_topology.py',
            'inputs': {
                'topology': True,
                'inventory': bool(sizes),
                'businessRules': rules is not None,
                'securityFindings': findings is not None,
                'unitKinds': kinds,
            },
            'units': units,
            'dataStores': stores,
            'ambiguities': ambiguities,
        }
        write_json(os.path.join(out, 'units.json'), result)
    except (DataError, OSError, RecursionError) as error:
        print(f'units_from_topology.py: {error}', file=sys.stderr)
        return 1
    modules = sorted({unit['module'] for unit in units})
    print(f'{len(units)} units in {len(modules)} module(s) from {len(leaves)} map leaves -> {os.path.join(out, "units.json")}')
    missing = [name for name, present in (('inventory.json', bool(sizes)), ('BUSINESS_RULES.md', rules is not None), ('SECURITY_FINDINGS.md', findings is not None)) if not present]
    if missing:
        print(f'not present: {", ".join(missing)}')
    print(f'ambiguities: {len(ambiguities)}')
    for line in ambiguities[:50]:
        print(f'- {line}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
