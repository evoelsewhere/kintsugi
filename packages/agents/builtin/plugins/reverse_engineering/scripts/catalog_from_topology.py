#!/usr/bin/env python3
"""Propose the item catalog of an application from the run's topology.json and inventory.json (ADR-0033).

    python3 catalog_from_topology.py <app> --topology FILE --inventory FILE --out FILE [--manifest FILE] [--max-items N]

--topology is the skeleton topology.json the assess stage's extraction script wrote and --inventory the
per-file inventory.json of its inventory step (both scratch files of the run). --manifest is kintsugi.yaml,
read for `unitKinds` only. --out is the catalog file written (scratch JSON).

No code is read and nothing is parsed. The grouping is the one of topology_units.py (ADR-0031):
a module is the map's domain, an item is one leaf (data stores never are), small leaves of one domain
directory are grouped, and above --max-items the leaves of a domain directory are grouped.
Kinds come from the leaf kind (mapped onto `unitKinds`) and, for a generic module leaf that is an
entry point, from ENTRY_KINDS. Then every file of inventory.json is placed in exactly one item: a leaf naming the file itself wins,
else the leaf naming the deepest directory that contains it; files no leaf claims are `unassigned`.
Loc, complexity band and digest come from inventory.json. Problems a person should look at go to
`ambiguities`. Standard library only.
"""
import argparse
import os
import sys

sys.dont_write_bytecode = True  # importing the sibling scripts must not leave __pycache__ beside them
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import catalog_common as cc  # noqa: E402
import topology_units as tu  # noqa: E402

DEFAULT_MAX_ITEMS = 240
# A generic `module` leaf that is an entry point of the application (routes, main(), schedulers) is
# the start of a use case: it takes the first of these unitKinds, when kintsugi.yaml names one.
ENTRY_KINDS = ('api', 'service', 'transaction', 'program')


def kind_of(unit, entry_points, kinds):
    """The unit's kind from its leaf kind (topology_units.choose_kind) and its entry points."""
    if unit['leafKind'] == 'module' and kinds and any(leaf in entry_points for leaf in unit['leaves']):
        for candidate in ENTRY_KINDS:
            if candidate in kinds:
                return candidate
    return unit['kind']


def claims(units, inventory):
    """{file: unit key}: exact file claims first, then the deepest claimed directory."""
    exact, directories, ambiguities = {}, [], []
    for unit in units:
        for rel in unit['files']:
            if rel in inventory:
                if rel in exact and exact[rel] != unit['key']:
                    ambiguities.append(f'{rel} is claimed by {exact[rel]} and {unit["key"]}: kept in {exact[rel]}')
                    continue
                exact.setdefault(rel, unit['key'])
            else:
                directories.append((rel.rstrip('/'), unit['key']))
    directories.sort(key=lambda entry: (-len(entry[0]), entry[1]))
    owner = dict(exact)
    for rel in inventory:
        if rel in owner:
            continue
        for directory, key in directories:
            if rel.startswith(directory + '/'):
                owner[rel] = key
                break
    return owner, ambiguities


def build(app, topology, inventory, sources, kinds, max_items):
    leaves = tu.walk_topology(topology)
    sizes = {rel: entry['codeLines'] for rel, entry in inventory.items() if entry['codeLines'] is not None}
    units, ambiguities = tu.build_units(leaves, sizes, kinds, max_items)
    ambiguities = tu.find_ambiguities(leaves, units) + ambiguities
    owner, conflicts = claims(units, inventory)
    ambiguities += conflicts
    entry_points = {leaf for leaf in topology.get('entryPoints', []) if isinstance(leaf, str)}
    described = {leaf['id']: leaf['description'] for leaf in leaves if leaf['description']}
    domains = {}
    for leaf in leaves:
        if leaf['kind'] not in tu.NON_UNIT_KINDS:
            module = cc.slug(leaf['domain'], 'core') if leaf['domain'] else 'core'
            domains.setdefault(module, leaf['domain'] or 'Core')
    files_of = {}
    for rel, key in owner.items():
        files_of.setdefault(key, []).append(rel)
    items = []
    for unit in units:
        files = files_of.get(unit['key'], [])
        if not files:
            ambiguities.append(f'unit {unit["key"]} has no file of the inventory: left out of the catalog')
            continue
        summaries = [described[leaf] for leaf in unit['leaves'] if leaf in described]
        items.append(cc.new_item(
            unit['key'],
            unit['module'],
            kind_of(unit, entry_points, kinds),
            cc.clean_text(unit['title'], cc.MAX_NAME) or unit['unit'],
            files,
            summary=cc.clean_text(summaries[0], cc.MAX_SUMMARY) if len(summaries) == 1 else '',
            leaves=unit['leaves'],
            entryPoints=sorted(leaf for leaf in unit['leaves'] if leaf in entry_points),
            loc=unit['loc'] or 0,
        ))
    modules = [{'id': module, 'name': cc.clean_text(name, cc.MAX_NAME) or module, 'summary': ''} for module, name in sorted(domains.items())]
    catalog = {
        'app': app,
        'generatedBy': 'catalog_from_topology.py',
        'sources': list(sources),
        'modules': modules,
        'items': items,
        'unassigned': [],
        'ambiguities': ambiguities[:cc.MAX_AMBIGUITIES],
    }
    return cc.refresh(catalog, inventory)


def main(argv):
    ap = argparse.ArgumentParser(description='Propose the item catalog of an application from topology.json.')
    ap.add_argument('app', help='the application id from kintsugi.yaml')
    ap.add_argument('--topology', required=True, help="the run's topology.json")
    ap.add_argument('--inventory', required=True, help="the run's per-file inventory.json")
    ap.add_argument('--out', required=True, help='the catalog file to write')
    ap.add_argument('--manifest', help='kintsugi.yaml (its unitKinds name the item kinds)')
    ap.add_argument('--max-items', type=int, default=DEFAULT_MAX_ITEMS, help='at most this many items')
    args = ap.parse_args(argv[1:])
    if not cc.APP_RE.match(args.app):
        print('catalog_from_topology.py: the application id must be kebab-case', file=sys.stderr)
        return 1
    if args.max_items < 1:
        print('catalog_from_topology.py: --max-items must be at least 1', file=sys.stderr)
        return 1
    try:
        topology_path = os.path.realpath(args.topology)
        inventory_path = os.path.realpath(args.inventory)
        if not os.path.isfile(topology_path):
            raise cc.DataError('topology.json is missing: the extraction step writes it')
        if not os.path.isfile(inventory_path):
            raise cc.DataError('inventory.json is missing: the inventory step writes it')
        inventory, sources = cc.load_inventory(inventory_path)
        catalog = build(args.app, cc.read_json(topology_path), inventory, sources, cc.unit_kinds(args.manifest), args.max_items)
        if not catalog['items']:
            raise cc.DataError('the topology has no leaf with a file of the inventory (only data stores, or no leaves at all)')
        problems = cc.check_catalog(catalog, inventory)
        if problems:
            raise cc.DataError('the proposed catalog is inconsistent: ' + '; '.join(problems[:5]))
        cc.write_json(os.path.abspath(args.out), catalog)
    except (cc.DataError, OSError, RecursionError) as error:
        print(f'catalog_from_topology.py: {error}', file=sys.stderr)
        return 1
    print(f'{len(catalog["items"])} items in {len(catalog["modules"])} module(s); {len(catalog["unassigned"])} unassigned file(s) -> {args.out}')
    print(f'ambiguities: {len(catalog["ambiguities"])}')
    for line in catalog['ambiguities'][:50]:
        print(f'- {line}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
