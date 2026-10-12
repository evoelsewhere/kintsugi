#!/usr/bin/env python3
"""Split a scoped run's extract-rules result into one rules file per selected item (ADR-0033).

    python3 split_rules.py <app> --rules FILE --catalog FILE --items ID,ID,... --out DIR

--rules is the rules_result.json the extract-rules workflow returned for the run's shards;
--catalog assessment/<app>/catalog.json; --items the run's items. --out is the document-repository
root. Each confirmed rule goes to the item that owns the file of its primary citation (the first
path:line of `source`); a rule whose file no selected item owns is left out and counted. Writes
assessment/<app>/items/<module>/<item>/rules.json per item:

    {"app", "item", "generatedBy", "rules": [{"id": "RULE-<module>.<item>-NN", ...card}], "dataObjects": [...]}

Ids are numbered inside the item by (category, name), so they never collide across runs and a rerun
renumbers only the item it rewrites. A data object goes to the item owning its `source` file, when it
has one. Standard library only.
"""
import argparse
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import catalog_common as cc  # noqa: E402
import render_rules as rr  # noqa: E402


def primary_file(value):
    citation, _ = rr.split_citation(value)
    return cc.norm_path(citation.split(':', 1)[0]) if citation else None


def split(app, result, chosen):
    owner = cc.owner_of(chosen)
    per_item = {item['id']: {'rules': [], 'dataObjects': []} for item in chosen}
    unplaced = 0
    for rule in result.get('confirmedRules') or []:
        item_id = owner.get(primary_file(rule.get('source')) or '')
        if item_id is None:
            unplaced += 1
            continue
        per_item[item_id]['rules'].append(rule)
    for obj in result.get('dataObjects') or []:
        item_id = owner.get(primary_file(obj.get('source')) or '') if isinstance(obj, dict) else None
        if item_id is not None:
            per_item[item_id]['dataObjects'].append(obj)
    outputs = {}
    for item_id, found in per_item.items():
        rules = sorted(found['rules'], key=lambda r: (rr.CATEGORIES.index(r['category']) if r.get('category') in rr.CATEGORIES else 9, str(r.get('name')), str(r.get('source'))))
        outputs[f'assessment/{app}/items/{item_id}/rules.json'] = {
            'app': app,
            'item': item_id,
            'generatedBy': 'split_rules.py',
            'rules': [{**rule, 'id': cc.namespaced('RULE', item_id, number)} for number, rule in enumerate(rules, start=1)],
            'dataObjects': found['dataObjects'],
        }
    return outputs, unplaced


def main(argv):
    ap = argparse.ArgumentParser(description='Split a scoped extract-rules result into per-item rules files.')
    ap.add_argument('app')
    ap.add_argument('--rules', required=True)
    ap.add_argument('--catalog', required=True)
    ap.add_argument('--items', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args(argv[1:])
    try:
        if not cc.APP_RE.match(args.app):
            raise cc.DataError('the application id must be kebab-case')
        items, _ = cc.load_catalog(args.catalog)
        chosen = cc.selected(items, args.items)
        raw = cc.read_optional_json(args.rules)
        result = rr.validate_result(raw if isinstance(raw, dict) else {})
        outputs, unplaced = split(args.app, result, chosen)
        root = os.path.abspath(args.out)
        for path, value in outputs.items():
            cc.write_json(os.path.join(root, *path.split('/')), value)
    except (cc.DataError, rr.DataError, OSError, RecursionError) as error:
        print(f'split_rules.py: {error}', file=sys.stderr)
        return 1
    total = sum(len(value['rules']) for value in outputs.values())
    print(f'{total} rule(s) split over {len(outputs)} item(s); {unplaced} left out (cited file in no selected item)')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
