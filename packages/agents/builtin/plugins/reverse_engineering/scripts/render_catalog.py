#!/usr/bin/env python3
"""Render the reconciled item catalog of an application as Markdown (ADR-0033, ADR-0042).

    python3 render_catalog.py <app> --catalog FILE --out DIR [--topology FILE]

--catalog is the run's reconciled catalog (scratch JSON, written by reconcile_catalog.py); --topology the
raw topology.json of the same run (scratch), read for the links between items: which item calls which, the
data stores each touches, and the leaves of each item. --out is the document-repository root the catalog
is written under: 10-applications/<app>/01-legacy/_catalog/index.md and one <module>.md per module, a card
per item. No code is read. Standard library only.
"""
import argparse
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import catalog_common as cc  # noqa: E402
import docmd  # noqa: E402


def main(argv):
    ap = argparse.ArgumentParser(description='Render the reconciled item catalog as Markdown.')
    ap.add_argument('app')
    ap.add_argument('--catalog', required=True)
    ap.add_argument('--topology')
    ap.add_argument('--out', required=True, help='the document-repository root to write under')
    args = ap.parse_args(argv[1:])
    try:
        if not cc.APP_RE.match(args.app):
            raise cc.DataError('the application id must be kebab-case')
        items, catalog = cc.load_catalog(args.catalog)
        if not catalog.get('items'):
            raise cc.DataError('the catalog has no items')
        topology = cc.read_optional_json(args.topology)
        graph = cc.item_graph(list(items.values()), topology)
        documents = cc.render_catalog(args.app, catalog, graph)
        root = os.path.abspath(args.out)
        for path, text in documents.items():
            docmd.write_text(os.path.join(root, *path.split('/')), text)
    except (cc.DataError, OSError, RecursionError) as error:
        print(f'render_catalog.py: {error}', file=sys.stderr)
        return 1
    active = [item for item in catalog['items'] if item.get('status') != 'retired']
    links = sum(len(facts['dependsOn']) for facts in graph.values())
    print(f'{len(active)} item(s) in {len(documents) - 1} module document(s); {links} dependency link(s); topology {"read" if topology is not None else "absent"}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
