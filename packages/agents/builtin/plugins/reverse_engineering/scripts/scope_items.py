#!/usr/bin/env python3
"""Prepare a scoped understand run (ADR-0033): per selected catalog item, its topology document, its
brief and its rule-extraction shard.

    python3 scope_items.py <app> --catalog DIR --items ID,ID,... --out DIR [--standards DIR]

--catalog is 10-applications/<app>/01-legacy/_catalog/ (the committed catalog: each card holds the item's
leaves, the items it depends on and that use it, the data stores it touches); --items the selected item
ids (active items only). --out is the document-repository root the files are written under:

- 10-applications/<app>/01-legacy/<module>/<unit>/topology.md - the item's leaves, the items it
  depends on and that use it, the data stores it reads and writes (published).
- scratch/<app>/understand/briefs/<module>/<unit>.json - what the specification job of the item starts
  from: name, kind, files, size, entry points, links, where its rules and findings will be, and the
  specification profile of its kind (ADR-0060: the sections to add, from --standards or the built-in ones) (scratch).
- scratch/<app>/understand/shards.json - one extract-rules shard per item ({name, domain, files, loc}).
- scratch/<app>/understand/scope.json - the items and their files.

No code is read. Standard library only.
"""
import argparse
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import catalog_common as cc  # noqa: E402
import docmd  # noqa: E402
import paths  # noqa: E402
import spec_profiles  # noqa: E402


def topology_document(app, item):
    """The item's topology.md: the same document shape as the application's, for one item."""
    leaves = item.get('leafNodes') or [{'id': leaf, 'name': '', 'kind': '', 'file': '', 'loc': None, 'entry': leaf in item.get('entryPoints', [])} for leaf in item.get('leaves') or []]
    code = [leaf for leaf in leaves if leaf.get('kind') != 'datastore']
    name = cc.clean_text(item.get('name'), cc.MAX_NAME) or item['id']
    depends, used_by, stores = item.get('dependsOn') or [], item.get('usedBy') or [], item.get('dataStores') or []
    out = [
        docmd.front_matter({
            'app': app,
            'system': app,
            'item': item['id'],
            'domains': 1,
            'leaves': len(code),
            'dataStores': len(stores),
            'edges': sum(dep.get('edges') or 1 for dep in depends),
            'entryPoints': sum(1 for leaf in code if leaf.get('entry')),
            'deadEnds': 0,
            'flows': 0,
            'truncated': False,
        }),
        f'# Topology of {name}',
        '',
        f'The leaves of `{item["id"]}` and its links to the other items of the catalog.',
        '',
        '## Domains',
        '',
        docmd.table(['Domain', 'Leaves', 'Data stores', 'LOC'], [[item['id'], len(code), len(stores), item.get('loc') if isinstance(item.get('loc'), int) else 0]]),
        '## Leaves',
        '',
        docmd.table(['Leaf', 'Name', 'Kind', 'Domain', 'File', 'LOC', 'Entry point', 'Dead end'], [
            [leaf['id'], leaf.get('name') or '', leaf.get('kind') or '', item['id'], leaf.get('file') or '', '' if leaf.get('loc') is None else leaf['loc'], 'yes' if leaf.get('entry') else '', '']
            for leaf in code
        ]),
        '## Depends on',
        '',
        docmd.table(['Item', 'Kinds', 'Edges'], [[dep['item'], ', '.join(dep.get('kinds') or []), dep.get('edges') or 1] for dep in depends]),
        '## Used by',
        '',
        docmd.bullet_list(used_by) if used_by else 'No other item of the catalog calls it.\n',
        '## Data stores',
        '',
        docmd.table(['Store', 'Access'], [[store['id'], ', '.join(store.get('access') or [])] for store in stores]),
    ]
    return '\n'.join(out).rstrip() + '\n'


def build(app, chosen, standards_dir=None, notes=None):
    files, shards, texts, scratch = set(), [], {}, {}
    profiles = {}
    for item in chosen:
        def at(file):
            return paths.unit_key_legacy_path(app, item['id'], file)
        brief_leaves = item.get('leafNodes') or []
        kind = cc.clean_text(item.get('kind'), 40) or 'module'
        if kind not in profiles:
            profiles[kind], why = spec_profiles.load(kind, standards_dir)
            if notes is not None:
                notes.extend(why)
        brief = {
            'app': app,
            'id': f'{app}/{item["id"]}',
            'key': item['id'],
            'name': cc.clean_text(item.get('name'), cc.MAX_NAME) or item['id'],
            'kind': kind,
            'summary': cc.clean_text(item.get('summary'), cc.MAX_SUMMARY),
            'files': item['files'],
            'loc': item.get('loc') if isinstance(item.get('loc'), int) else 0,
            'leaves': [{key: leaf[key] for key in ('id', 'name', 'kind', 'file', 'loc') if leaf.get(key) not in (None, '')} for leaf in brief_leaves],
            'entryPoints': sorted(item.get('entryPoints') or []),
            'dependsOn': sorted(dep['item'] for dep in item.get('dependsOn') or []),
            'usedBy': sorted(item.get('usedBy') or []),
            'dataStores': [{'id': store['id'], 'access': sorted(store.get('access') or [])} for store in item.get('dataStores') or []],
            'parts': [part for part in item.get('parts') or [] if isinstance(part, dict)][:cc.MAX_PARTS],
            'profile': profiles[kind],
            'topology': at('topology.md'),
            'rules': at('rules.md'),
            'findings': at('findings.md'),
        }
        texts[at('topology.md')] = topology_document(app, item)
        scratch[paths.assessment_brief_path(app, item['id'])] = brief
        shards.append({'name': item['id'].replace('/', '.'), 'domain': item['id'].split('/')[0], 'files': item['files'], 'loc': brief['loc']})
        files.update(item['files'])
    scratch[paths.understand_shards_path(app)] = shards
    scratch[paths.understand_scope_path(app)] = {'app': app, 'items': [item['id'] for item in chosen], 'files': sorted(files)}
    return texts, scratch


def main(argv):
    ap = argparse.ArgumentParser(description='Prepare a scoped understand run: topology documents, briefs and shards per item.')
    ap.add_argument('app')
    ap.add_argument('--catalog', required=True, help='the catalog folder (assessment/catalog/)')
    ap.add_argument('--items', required=True, help='comma-separated catalog item ids')
    ap.add_argument('--out', required=True, help='the document-repository root to write under')
    ap.add_argument('--standards', help='01-standards/specifications/ of the document repository (its <kind>.md replace the built-in profiles)')
    args = ap.parse_args(argv[1:])
    try:
        if not cc.APP_RE.match(args.app):
            raise cc.DataError('the application id must be kebab-case')
        items, _ = cc.load_catalog(args.catalog)
        chosen = cc.selected(items, args.items)
        notes = []
        texts, scratch = build(args.app, chosen, args.standards, notes)
        root = os.path.abspath(args.out)
        for path, text in texts.items():
            docmd.write_text(os.path.join(root, *path.split('/')), text)
        for path, value in scratch.items():
            docmd.write_json(os.path.join(root, *path.split('/')), value)
    except (cc.DataError, OSError, RecursionError) as error:
        print(f'scope_items.py: {error}', file=sys.stderr)
        return 1
    print(f'{len(chosen)} item(s) in scope, {sum(len(item["files"]) for item in chosen)} file(s)')
    for item in chosen[:60]:
        print(f'- {item["id"]}: {len(item["files"])} file(s)')
    for note in notes[:20]:
        print(f'- not used: {note}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
