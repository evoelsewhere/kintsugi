#!/usr/bin/env python3
"""Split a scoped run's extract-rules result into one rules file per selected item (ADR-0033).

    python3 split_rules.py <app> --rules FILE --catalog DIR --items ID,ID,... --out DIR [--docs DIR] [--date YYYY-MM-DD] [--source-commit SHA]

--rules is the rules_result.json the extract-rules workflow returned for the run's shards (scratch);
--catalog the application's catalog folder (assessment/catalog/); --items the run's items. --out is the
document-repository root. Each confirmed rule goes to the item that owns the file of its primary
citation (the first path:line of `source`); a rule whose file no selected item owns is left out and
counted. Writes per item, under applications/<app>/units/<module>/<unit>/understanding/:

    rules.md            the index: a table of the rules (id, name, category, priority, confidence,
                        version, status, source, link) and the retired ones
    rules/<id>.md       one file per rule, `RULE-<module>.<unit>-<hash>`: specification, evidence, edge
                        cases, open questions and the rule's version history (rule_docs.py)
    data-objects.md     the data objects whose source file the item owns

--docs is the document repository as it is now (read-only, optional): a rule that is already there
keeps its version while its content is unchanged and gets the next one when it changed; a rule that
is no longer extracted is rewritten as a `retired` file and listed in the index's retired table.

Rule ids are citation-derived and stable (ADR-0038): the suffix hashes the item key and the
canonical `path:start-end` of the rule's source, so a rerun keeps every unchanged rule's id and a
changed or missing citation yields a new id. The item's human rule verdicts live in the sibling
rules-review.md, which is human-owned and never touched here; verdicts whose rule id is no longer
in the extraction are reported as orphaned. A data object goes to the item owning its `source`
file, when it has one. Standard library only.
"""
import argparse
import datetime
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import catalog_common as cc  # noqa: E402
import docmd  # noqa: E402
import paths  # noqa: E402
import render_rules as rr  # noqa: E402
import rule_docs as rd  # noqa: E402


def primary_file(value):
    citation, _ = rr.split_citation(value)
    return cc.norm_path(citation.split(':', 1)[0]) if citation else None


def prior_text(docs, path):
    return docmd.read_optional_text(os.path.join(docs, *path.split('/'))) if docs else None


def item_documents(app, item_id, rules, docs, date, commit):
    """{path: text} of one item: the index, one file per rule and the tombstones of the rules that are gone."""
    module, unit = item_id.split('/')
    index_text = prior_text(docs, paths.unit_rules_path(app, module, unit))
    prior_version, retired_rows = rd.unit_index_state(index_text)
    prior_ids = [row.get('id', '') for row in rr.unit_rule_rows(index_text or '') if row.get('id')] if index_text else []
    files, entries, changed = {}, [], False
    for rule in rules:
        prior = rd.read_rule_file(prior_text(docs, paths.unit_rule_file_path(app, module, unit, rule['id'])) or '')
        version, history, differs = rd.next_version(prior, rule, date, commit)
        changed = changed or differs
        entries.append({'rule': rule, 'version': version})
        files[paths.unit_rule_file_path(app, module, unit, rule['id'])] = rd.render_rule_file(app, item_id, rule, version, history, digest=rd.rule_digest(rule), commit=commit)
    current = {rule['id'] for rule in rules}
    retired_rows = [row for row in retired_rows if row[0] not in current]
    for rule_id in sorted(set(prior_ids) - current):
        prior = rd.read_rule_file(prior_text(docs, paths.unit_rule_file_path(app, module, unit, rule_id)) or '')
        if prior is None or prior['status'] == 'retired':
            continue
        changed = True
        tombstone = rd.retire(prior, date, commit)
        files[paths.unit_rule_file_path(app, module, unit, rule_id)] = tombstone
        retired_rows.append([rule_id, prior['name'], prior['version'] + 1, date])
    catalog_version = prior_version + 1 if changed or prior_version == 0 else prior_version
    files[paths.unit_rules_path(app, module, unit)] = rd.render_unit_index(app, item_id, entries, sorted(retired_rows), catalog_version)
    return files


def split(app, result, chosen, docs='', date='', commit=''):
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
        identified = cc.assign_rule_ids(item_id, rules)
        for path, text in item_documents(app, item_id, identified, docs, date, commit).items():
            outputs[path] = {'item': item_id, 'ids': [rule['id'] for rule in identified] if path == paths.unit_rules_path(app, *item_id.split('/')) else [], 'text': text}
        outputs[paths.unit_data_objects_path(app, *item_id.split('/'))] = {'item': item_id, 'ids': [], 'text': rr.render_unit_data_objects(app, item_id, found['dataObjects'])}
    return outputs, unplaced


def main(argv):
    ap = argparse.ArgumentParser(description='Split a scoped extract-rules result into per-item rules documents.')
    ap.add_argument('app')
    ap.add_argument('--rules', required=True)
    ap.add_argument('--catalog', required=True)
    ap.add_argument('--items', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--docs', default='', help='the document repository as it is now (read-only): keeps the versions of rules that are already there')
    ap.add_argument('--date', default='', help='the date written in version histories (default: today, UTC)')
    ap.add_argument('--source-commit', default='', help='the commit of the analysed source, written in version histories')
    args = ap.parse_args(argv[1:])
    try:
        if not cc.APP_RE.match(args.app):
            raise cc.DataError('the application id must be kebab-case')
        items, _ = cc.load_catalog(args.catalog)
        chosen = cc.selected(items, args.items)
        raw = cc.read_optional_json(args.rules)
        result = rr.validate_result(raw if isinstance(raw, dict) else {})
        date = args.date or datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')
        outputs, unplaced = split(args.app, result, chosen, os.path.realpath(args.docs) if args.docs else '', date, args.source_commit)
        root = os.path.abspath(args.out)
        for path, value in outputs.items():
            docmd.write_text(os.path.join(root, *path.split('/')), value['text'])
        reviewed, orphaned = 0, 0
        for path, value in sorted(outputs.items()):
            if not path.endswith('/rules.md'):
                continue
            review_path = os.path.join(root, *paths.unit_rules_review_path(args.app, *value['item'].split('/')).split('/'))
            if not os.path.isfile(review_path):
                continue
            reviewed += 1
            ids = cc.orphan_review_ids(cc.load_rules_review(review_path), value['ids'])
            if ids:
                orphaned += len(ids)
                print(f'- orphaned rule verdict(s) in {value["item"]} rules-review.md (kept, not applied): {", ".join(ids)}')
    except (cc.DataError, rr.DataError, OSError, RecursionError) as error:
        print(f'split_rules.py: {error}', file=sys.stderr)
        return 1
    total = sum(len(value['ids']) for value in outputs.values())
    print(f'{total} rule(s) split over {len(chosen)} item(s); {unplaced} left out (cited file in no selected item)')
    if reviewed:
        print(f'{reviewed} rules-review.md kept unchanged; {orphaned} orphaned rule verdict(s) reported')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
