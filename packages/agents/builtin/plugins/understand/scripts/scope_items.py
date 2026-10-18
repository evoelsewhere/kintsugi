#!/usr/bin/env python3
"""Prepare a scoped understand run (ADR-0033): per selected catalog item, its topology fragment, its
brief and its rule-extraction shard.

    python3 scope_items.py <app> --catalog FILE --items ID,ID,... --out DIR [--topology FILE]

--catalog is applications/<app>/assessment/catalog.json; --items the selected item ids (active
items only); --topology the skeleton topology.json the assess stage published (optional: without it
the fragments hold no leaves or edges). --out is the document-repository root the files are written
under:

- applications/<app>/units/<module>/<unit>/topology.json — the item's leaves and their outbound
  edges, each edge target resolved to the catalog item that owns it (`targetItem`) or kept as a data
  store.
- applications/<app>/assessment/understand/briefs/<module>/<unit>.json — what the specification job
  of the item starts from: name, kind, files, size, entry points, the items it depends on and that
  use it, the data stores it reads and writes, and where its rules and findings will be.
- applications/<app>/assessment/understand/shards.json — one extract-rules shard per item
  ({name, domain, files, loc}).
- applications/<app>/assessment/understand/scope.json — the items and their files.

No code is read. Standard library only.
"""
import argparse
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import catalog_common as cc  # noqa: E402
import paths  # noqa: E402
import units_from_topology as uft  # noqa: E402

MAX_EDGES = 2000


def leaf_nodes(topology):
    """{leaf id: node fields} of the topology's leaves; {} without a topology."""
    if topology is None:
        return {}
    return {leaf['id']: leaf for leaf in uft.walk_topology(topology)}


def build(app, items_by_id, chosen, topology):
    leaves = leaf_nodes(topology)
    leaf_item = {}
    for item in items_by_id.values():
        if item.get('status') == 'retired':
            continue
        for leaf in item.get('leaves') or []:
            if isinstance(leaf, str):
                leaf_item.setdefault(leaf, item['id'])
    edges = [edge for edge in (topology or {}).get('edges', []) if isinstance(edge, dict) and isinstance(edge.get('source'), str) and isinstance(edge.get('target'), str)]
    entry_points = {leaf for leaf in (topology or {}).get('entryPoints', []) if isinstance(leaf, str)}
    files, shards, outputs = set(), [], {}
    for item in chosen:
        own = [leaf for leaf in item.get('leaves') or [] if isinstance(leaf, str)]
        out_edges, depends, stores = [], set(), {}
        for edge in edges:
            if edge['source'] not in own:
                continue
            target_item = leaf_item.get(edge['target'])
            entry = {'source': edge['source'], 'target': edge['target'], 'kind': cc.clean_text(edge.get('kind'), 20) or 'call'}
            if target_item is not None:
                entry['targetItem'] = target_item
                if target_item != item['id']:
                    depends.add(target_item)
            elif leaves.get(edge['target'], {}).get('kind') == 'datastore' or edge['target'].startswith('ds:'):
                stores.setdefault(edge['target'], set()).add(entry['kind'])
            out_edges.append(entry)
        used_by = sorted({leaf_item[edge['source']] for edge in edges if edge['target'] in own and leaf_item.get(edge['source']) not in (None, item['id'])})
        nodes = [{key: value for key, value in leaves[leaf].items() if key in ('id', 'name', 'kind', 'file', 'loc', 'description') and value is not None} for leaf in own if leaf in leaves]
        name = cc.clean_text(item.get('name'), cc.MAX_NAME) or item['id']
        # The topology.json schema of the whole application (one domain node holding the item's
        # leaves), so the readers and the aggregate rebuild treat a fragment like the whole.
        fragment = {
            'system': app,
            'item': item['id'],
            'generatedBy': 'scope_items.py',
            'root': {'id': 'sys', 'name': app, 'kind': 'system', 'children': [{'id': f'item:{item["id"]}', 'name': name, 'kind': 'domain', 'children': nodes}]},
            'edges': out_edges[:MAX_EDGES],
            'entryPoints': sorted(leaf for leaf in own if leaf in entry_points),
            'deadEnds': [],
            'observations': [],
            'flows': [],
        }
        base = paths.unit_key_dir(app, item['id'])
        brief = {
            'app': app,
            'id': f'{app}/{item["id"]}',
            'key': item['id'],
            'name': cc.clean_text(item.get('name'), cc.MAX_NAME) or item['id'],
            'kind': cc.clean_text(item.get('kind'), 40) or 'module',
            'summary': cc.clean_text(item.get('summary'), cc.MAX_SUMMARY),
            'files': item['files'],
            'loc': item.get('loc') if isinstance(item.get('loc'), int) else 0,
            'leaves': nodes,
            'entryPoints': fragment['entryPoints'],
            'dependsOn': sorted(depends),
            'usedBy': used_by,
            'dataStores': [{'id': store, 'access': sorted(kinds)} for store, kinds in sorted(stores.items())],
            'parts': [part for part in item.get('parts') or [] if isinstance(part, dict)][:cc.MAX_PARTS],
            'topology': f'{base}/topology.json',
            'rules': f'{base}/rules.json',
            'findings': f'{base}/findings.json',
        }
        outputs[f'{base}/topology.json'] = fragment
        outputs[paths.assessment_brief_path(app, item['id'])] = brief
        shards.append({'name': item['id'].replace('/', '.'), 'domain': item['id'].split('/')[0], 'files': item['files'], 'loc': brief['loc']})
        files.update(item['files'])
    outputs[paths.understand_shards_path(app)] = shards
    outputs[paths.understand_scope_path(app)] = {'app': app, 'items': [item['id'] for item in chosen], 'files': sorted(files)}
    return outputs


def main(argv):
    ap = argparse.ArgumentParser(description='Prepare a scoped understand run: topology fragments, briefs and shards per item.')
    ap.add_argument('app')
    ap.add_argument('--catalog', required=True)
    ap.add_argument('--items', required=True, help='comma-separated catalog item ids')
    ap.add_argument('--out', required=True, help='the document-repository root to write under')
    ap.add_argument('--topology', help='the skeleton topology.json (optional)')
    args = ap.parse_args(argv[1:])
    try:
        if not cc.APP_RE.match(args.app):
            raise cc.DataError('the application id must be kebab-case')
        items, _ = cc.load_catalog(args.catalog)
        chosen = cc.selected(items, args.items)
        topology = cc.read_optional_json(args.topology)
        outputs = build(args.app, items, chosen, topology)
        root = os.path.abspath(args.out)
        for path, value in outputs.items():
            cc.write_json(os.path.join(root, *path.split('/')), value)
    except (cc.DataError, OSError, RecursionError) as error:
        print(f'scope_items.py: {error}', file=sys.stderr)
        return 1
    print(f'{len(chosen)} item(s) in scope, {sum(len(item["files"]) for item in chosen)} file(s); topology {"read" if topology is not None else "absent"}')
    for item in chosen[:60]:
        print(f'- {item["id"]}: {len(item["files"])} file(s)')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
