"""Group the leaves of a topology into catalog items (ADR-0033). A library of catalog_from_topology.py and
render_catalog.py, not a script on its own.

No code is read and nothing is parsed: the items are the topology's leaves, grouped deterministically.
- A module is the topology's domain (the nearest `domain` node; `core` for leaves outside any domain).
- An item is one leaf (module, job, screen, ...); data stores are never items. Small leaves (fewer than
  SMALL lines) of one domain in one directory are grouped into one item named after the directory.
- Above max_units items, every leaf of a domain directory is grouped; if there are still too many,
  the largest items are kept and the rest are reported as left out.
- Size comes from the leaf's `loc`, else from the inventory (code lines of the files under the leaf).
Standard library only.
"""
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from docmd import DataError, norm_path, slug  # noqa: E402,F401

SMALL = 150
LARGE = 5000
MAX_GROUP_FILES = 20
DEFAULT_MAX_UNITS = 240
MAX_NODES = 50_000
NON_UNIT_KINDS = {'system', 'domain', 'datastore'}
# Map leaf kinds to the usual unit-kind names of kintsugi.yaml, in order of preference.
KIND_SYNONYMS = {
    'job': ['batch-job', 'batch', 'job'],
    'screen': ['screen', 'ui', 'page'],
    'module': ['module', 'program', 'component', 'service'],
}


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


def size_of(leaf, sizes):
    if leaf['loc'] is not None:
        return leaf['loc']
    if not leaf['file'] or not sizes:
        return None
    prefix = leaf['file'].rstrip('/') + '/'
    total = sum(lines for rel, lines in sizes.items() if rel == leaf['file'] or rel.startswith(prefix))
    return total or None


def group(leaves, sizes, by_directory):
    """Items as lists of leaves, keyed (module, base name)."""
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
