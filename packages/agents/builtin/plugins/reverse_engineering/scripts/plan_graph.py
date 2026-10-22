#!/usr/bin/env python3
"""The item graph a planning run reasons over (ADR-0041): which catalog items call, read and use which.

    python3 plan_graph.py <app> --catalog DIR --out DIR [--existing DIR]

--catalog is 10-applications/<app>/01-legacy/_catalog/, whose cards carry the links between items (the assess
stage computed them from the topology); --existing the application's 01-legacy/ folder (an item with an
understanding.md in its <module>/<unit>/ folder there is understood already); --out the document-repository root the graph is written
under (scratch/<app>/understand/graph.json, intermediate).

Per active item: size, complexity, asset class, whether it holds an entry point, the items it depends
on (with the kinds of calls and how many) and that use it, the data stores it touches, its depth
(0 = depends on no other item, so its callers can be read with it explained) and its cycle (items
that depend on each other, which are best understood together). No code is read. Standard library only.
"""
import argparse
import os
import re
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import catalog_common as cc  # noqa: E402
import docmd  # noqa: E402
import paths  # noqa: E402

# Keep in sync with classifyItem in packages/domain/src/catalog.ts.
TEST_PATH = re.compile(r'(^|/)(tests?|__tests__|spec|specs|testing|testdata|fixtures)/|\.(test|spec)\.[a-z0-9]+$|(Tests?|IT)\.(java|kt|cs|scala|groovy)$|_test\.(go|py|rb|rs)$|(^|/)test_[^/]+\.py$', re.IGNORECASE)
GENERATED_PATH = re.compile(r'(^|/)(generated|gen|build|dist|target|node_modules|vendor|__generated__)/|\.min\.(js|css)$|\.pb\.go$|_pb2\.py$|\.generated\.[a-z0-9]+$|\.designer\.cs$', re.IGNORECASE)


def asset_class(files):
    if not files:
        return 'code'
    if all(TEST_PATH.search(path) for path in files):
        return 'test'
    if all(GENERATED_PATH.search(path) for path in files):
        return 'generated'
    return 'code'


def components(nodes, edges):
    """Strongly connected components (Tarjan, iterative): {node: component index}, components as lists."""
    index, low, on_stack, stack = {}, {}, set(), []
    result, counter = [], [0]
    for root in nodes:
        if root in index:
            continue
        work = [(root, iter(sorted(edges.get(root, ()))))]
        index[root] = low[root] = counter[0]
        counter[0] += 1
        stack.append(root)
        on_stack.add(root)
        while work:
            node, children = work[-1]
            advanced = False
            for child in children:
                if child not in index:
                    index[child] = low[child] = counter[0]
                    counter[0] += 1
                    stack.append(child)
                    on_stack.add(child)
                    work.append((child, iter(sorted(edges.get(child, ())))))
                    advanced = True
                    break
                if child in on_stack:
                    low[node] = min(low[node], index[child])
            if advanced:
                continue
            work.pop()
            if work:
                parent = work[-1][0]
                low[parent] = min(low[parent], low[node])
            if low[node] == index[node]:
                members = []
                while True:
                    member = stack.pop()
                    on_stack.discard(member)
                    members.append(member)
                    if member == node:
                        break
                result.append(sorted(members))
    owner = {member: number for number, members in enumerate(result) for member in members}
    return owner, result


def build(app, catalog_items, understood, sources):
    active = [item for item in catalog_items.values() if item.get('status') != 'retired']
    depends, stores = {}, {}
    for item in active:
        for dep in item.get('dependsOn') or []:
            if dep.get('item') in catalog_items and dep['item'] != item['id']:
                depends.setdefault(item['id'], {})[dep['item']] = {'kinds': set(dep.get('kinds') or []), 'edges': dep.get('edges') or 1}
        for store in item.get('dataStores') or []:
            stores.setdefault(item['id'], {})[store['id']] = set(store.get('access') or [])

    ids = sorted(item['id'] for item in active)
    owner, groups = components(ids, {item: set(targets) for item, targets in depends.items()})
    depth = {}

    def depth_of(component):
        if component in depth:
            return depth[component]
        depth[component] = 0  # a cycle was condensed: no back edge remains
        below = [owner[target] for member in groups[component] for target in depends.get(member, {}) if owner[target] != component]
        depth[component] = 1 + max((depth_of(other) for other in below), default=-1)
        return depth[component]

    used_by = {}
    for source, targets in depends.items():
        for target in targets:
            used_by.setdefault(target, set()).add(source)

    items = []
    linked = False
    for item in sorted(active, key=lambda entry: entry['id']):
        item_id = item['id']
        group = groups[owner[item_id]]
        outgoing = depends.get(item_id, {})
        linked = linked or bool(outgoing)
        items.append({
            'id': item_id,
            'name': cc.clean_text(item.get('name'), cc.MAX_NAME) or item_id,
            'module': item_id.split('/')[0],
            'kind': cc.clean_text(item.get('kind'), 40) or 'module',
            'summary': cc.clean_text(item.get('summary'), 300),
            'loc': item.get('loc') if isinstance(item.get('loc'), int) else 0,
            'files': len(item.get('files') or []),
            'complexity': item.get('complexity') if item.get('complexity') in cc.COMPLEXITY_BANDS else 'low',
            'assetClass': asset_class(item.get('files') or []),
            'understood': item_id in understood,
            'entryPoint': bool(item.get('entryPoints')),
            'dependsOn': [{'item': target, 'kinds': sorted(info['kinds']), 'edges': info['edges']} for target, info in sorted(outgoing.items())],
            'usedBy': sorted(used_by.get(item_id, ())),
            'dataStores': [{'id': store, 'access': sorted(kinds)} for store, kinds in sorted(stores.get(item_id, {}).items())],
            'fanIn': len(used_by.get(item_id, ())),
            'fanOut': len(outgoing),
            'depth': depth_of(owner[item_id]),
            'cycle': group if len(group) > 1 else None,
        })
    cycles = [group for group in groups if len(group) > 1]
    return {
        'app': app,
        'generatedBy': 'plan_graph.py',
        'sources': sources,
        'items': items,
        'cycles': cycles,
        'stats': {
            'items': len(items),
            'open': sum(1 for item in items if not item['understood'] and item['assetClass'] == 'code'),
            'edges': sum(len(item['dependsOn']) for item in items),
            'linked': linked,
        },
    }


def main(argv):
    ap = argparse.ArgumentParser(description='Compute the item graph a planning run reasons over.')
    ap.add_argument('app')
    ap.add_argument('--catalog', required=True, help='the catalog folder (01-legacy/_catalog/)')
    ap.add_argument('--existing', help='the application 01-legacy/ folder: an item with an understanding record there is understood')
    ap.add_argument('--out', required=True, help='the document-repository root to write under')
    args = ap.parse_args(argv[1:])
    try:
        if not cc.APP_RE.match(args.app):
            raise cc.DataError('the application id must be kebab-case')
        items, catalog = cc.load_catalog(args.catalog)
        understood = set()
        if args.existing and os.path.isdir(args.existing):
            for item_id in items:
                module, unit = paths.split_unit_key(item_id)
                if os.path.isfile(os.path.join(args.existing, module, unit, 'understanding.md')):
                    understood.add(item_id)
        graph = build(args.app, items, understood, cc.sources_of(catalog.get('sources')))
        docmd.write_json(os.path.join(os.path.abspath(args.out), *paths.understand_graph_path(args.app).split('/')), graph)
    except (cc.DataError, OSError, RecursionError) as error:
        print(f'plan_graph.py: {error}', file=sys.stderr)
        return 1
    stats = graph['stats']
    print(f"{stats['items']} item(s), {stats['open']} open code item(s), {stats['edges']} dependency edge(s), {len(graph['cycles'])} cycle(s); links {'read' if stats['linked'] else 'absent'}")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
