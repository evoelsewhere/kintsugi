#!/usr/bin/env python3
"""Apply a curation job's structured edits to a proposed item catalog (ADR-0033).

    python3 apply_catalog_edits.py --catalog FILE --edits FILE --inventory FILE --out FILE [--manifest FILE]

--catalog is the catalog catalog_from_topology.py proposed; --edits the curation job's structured
result, {"edits": [...]} (a missing or unreadable file applies nothing); --inventory the inventory.json
of the same run; --manifest kintsugi.yaml (its unitKinds bound the kinds). --out is written.

Edits are applied in order. Each one is checked on its own: an edit that names an unknown item,
breaks the catalog's invariant (every inventory file in exactly one item or unassigned, no empty
item, unique ids) or is malformed is rejected with a reason and the others still apply. The model's
text is data: names and summaries are cut to one bounded line.

Operations:
  {"op": "rename", "item": ID, "name": TEXT}
  {"op": "set-kind", "item": ID, "kind": KIND}
  {"op": "describe", "item": ID, "summary": TEXT}           or {"op": "describe", "module": M, "summary": TEXT}
  {"op": "rename-module", "module": M, "name": TEXT}
  {"op": "move-item", "item": ID, "module": M, "moduleName"?: TEXT, "name"?: TEXT}  (an unknown module is created; the id follows it)
  {"op": "merge", "items": [ID, ID, ...], "name"?: TEXT}     (into the first item)
  {"op": "split", "item": ID, "into": [{"name": TEXT, "files": [...]}, ...]}  (the largest piece keeps the id)
  {"op": "move-files", "files": [...], "to": ID}            (from their item, or from unassigned)
  {"op": "unassign-files", "files": [...]}
  {"op": "add-parts", "item": ID, "parts": [{"name": TEXT, "kind"?: TEXT, "file"?: "path[:line]"}]}
Standard library only.
"""
import argparse
import copy
import os
import re
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import catalog_common as cc  # noqa: E402

MAX_EDITS = 500
MAX_REJECTED = 100
OPS = ('rename', 'set-kind', 'describe', 'rename-module', 'move-item', 'merge', 'split', 'move-files', 'unassign-files', 'add-parts')

class Rejected(Exception):
    """An edit that cannot be applied; the message says why."""


def item_of(catalog, item_id):
    for item in catalog['items']:
        if item['id'] == item_id and item['status'] == 'active':
            return item
    raise Rejected(f'unknown item {item_id!r}')


def text(edit, key, limit, required=True):
    value = cc.clean_text(edit.get(key), limit)
    if required and not value:
        raise Rejected(f'"{key}" is missing')
    return value


def file_list(edit, inventory):
    files = edit.get('files')
    if not isinstance(files, list) or not files:
        raise Rejected('"files" must be a non-empty list')
    paths = []
    for value in files:
        rel = cc.norm_path(value)
        if rel is None or rel not in inventory:
            raise Rejected(f'{value!r} is not a file of the inventory')
        paths.append(rel)
    return sorted(set(paths))


def module_id(catalog, value, create_name=None):
    module = value if isinstance(value, str) else ''
    if not cc.SEGMENT_RE.match(module):
        module = cc.slug(module, '')
    if not cc.SEGMENT_RE.match(module):
        raise Rejected('"module" is not a module id')
    if not any(entry['id'] == module for entry in catalog['modules']):
        if create_name is None:
            raise Rejected(f'unknown module {module!r}')
        catalog['modules'].append({'id': module, 'name': create_name or module, 'summary': ''})
    return module


def taken_ids(catalog, but=()):
    return {item['id'] for item in catalog['items'] if item['id'] not in but}


def apply_one(catalog, edit, inventory, kinds):
    op = edit.get('op')
    if op not in OPS:
        raise Rejected(f'unknown operation {op!r}')
    if op == 'rename':
        item_of(catalog, edit.get('item'))['name'] = text(edit, 'name', cc.MAX_NAME)
    elif op == 'set-kind':
        kind = text(edit, 'kind', 40)
        if kinds and kind not in kinds:
            raise Rejected(f'kind {kind!r} is not one of the unitKinds ({", ".join(kinds)})')
        item_of(catalog, edit.get('item'))['kind'] = kind
    elif op == 'describe':
        summary = text(edit, 'summary', cc.MAX_SUMMARY)
        if edit.get('item') is not None:
            item_of(catalog, edit.get('item'))['summary'] = summary
        else:
            module = module_id(catalog, edit.get('module'))
            next(entry for entry in catalog['modules'] if entry['id'] == module)['summary'] = summary
    elif op == 'rename-module':
        module = module_id(catalog, edit.get('module'))
        next(entry for entry in catalog['modules'] if entry['id'] == module)['name'] = text(edit, 'name', cc.MAX_NAME)
    elif op == 'move-item':
        item = item_of(catalog, edit.get('item'))
        module = module_id(catalog, edit.get('module'), create_name=text(edit, 'moduleName', cc.MAX_NAME, required=False))
        item['module'] = module
        item['id'] = cc.unique_id(module, item['id'].split('/', 1)[1], taken_ids(catalog, but={item['id']}))
        name = text(edit, 'name', cc.MAX_NAME, required=False)
        if name:
            item['name'] = name
    elif op == 'merge':
        ids = edit.get('items')
        if not isinstance(ids, list) or len(set(ids)) < 2 or len(set(ids)) != len(ids):
            raise Rejected('"items" must list at least two distinct items')
        members = [item_of(catalog, item_id) for item_id in ids]
        target = members[0]
        for other in members[1:]:
            for key in ('files', 'leaves', 'entryPoints'):
                target[key] = sorted(set(target[key]) | set(other[key]))
            target['parts'] = (target['parts'] + other['parts'])[:cc.MAX_PARTS]
            target['loc'] = (target.get('loc') or 0) + (other.get('loc') or 0)
            catalog['items'].remove(other)
        name = text(edit, 'name', cc.MAX_NAME, required=False)
        if name:
            target['name'] = name
    elif op == 'split':
        item = item_of(catalog, edit.get('item'))
        pieces = edit.get('into')
        if not isinstance(pieces, list) or len(pieces) < 2:
            raise Rejected('"into" must list at least two pieces')
        parsed = []
        for piece in pieces:
            if not isinstance(piece, dict):
                raise Rejected('every piece must be an object')
            parsed.append((text(piece, 'name', cc.MAX_NAME), file_list(piece, inventory)))
        everything = [rel for _, files in parsed for rel in files]
        if len(everything) != len(set(everything)):
            raise Rejected('the pieces share files')
        if set(everything) != set(item['files']):
            raise Rejected('the pieces must hold exactly the files of the item')
        parsed.sort(key=lambda piece: (-len(piece[1]), piece[0]))
        catalog['items'].remove(item)
        taken = taken_ids(catalog)
        for index, (name, files) in enumerate(parsed):
            piece_id = item['id'] if index == 0 else cc.unique_id(item['module'], name, taken | {item['id']})
            taken.add(piece_id)
            catalog['items'].append(cc.new_item(
                piece_id, item['module'], item['kind'], name, files,
                leaves=item['leaves'], entryPoints=item['entryPoints'] if index == 0 else [],
                parts=[part for part in item['parts'] if part.get('file', '').split(':', 1)[0] in files],
            ))
    elif op in ('move-files', 'unassign-files'):
        files = set(file_list(edit, inventory))
        target = item_of(catalog, edit.get('to')) if op == 'move-files' else None
        for item in catalog['items']:
            if item['status'] == 'active' and item is not target:
                item['files'] = [rel for rel in item['files'] if rel not in files]
        if target is not None:
            target['files'] = sorted(set(target['files']) | files)
    elif op == 'add-parts':
        item = item_of(catalog, edit.get('item'))
        parts = edit.get('parts')
        if not isinstance(parts, list) or not parts:
            raise Rejected('"parts" must be a non-empty list')
        for part in parts:
            if not isinstance(part, dict):
                raise Rejected('every part must be an object')
            entry = {'name': text(part, 'name', cc.MAX_NAME)}
            kind = cc.clean_text(part.get('kind'), 40)
            if kind:
                entry['kind'] = kind
            location = cc.clean_text(part.get('file'), 300)
            if location:
                match = re.fullmatch(r'(.+?)(?::(\d+))?', location)
                rel = cc.norm_path(match.group(1)) if match else None
                if rel not in item['files']:
                    raise Rejected(f'part {entry["name"]!r} cites a file outside the item')
                entry['file'] = rel + (f':{match.group(2)}' if match.group(2) else '')
            item['parts'].append(entry)
        if len(item['parts']) > cc.MAX_PARTS:
            raise Rejected(f'an item has at most {cc.MAX_PARTS} parts')


def apply_edits(catalog, edits, inventory, kinds):
    applied, rejected = 0, []
    for index, edit in enumerate(edits[:MAX_EDITS]):
        trial = copy.deepcopy(catalog)
        try:
            if not isinstance(edit, dict):
                raise Rejected('an edit must be an object')
            apply_one(trial, edit, inventory, kinds)
            cc.refresh(trial, inventory)
            problems = cc.check_catalog(trial, inventory)
            if problems:
                raise Rejected(problems[0])
        except Rejected as reason:
            if len(rejected) < MAX_REJECTED:
                rejected.append({'index': index, 'op': edit.get('op') if isinstance(edit, dict) and isinstance(edit.get('op'), str) else None, 'reason': str(reason)[:300]})
            continue
        catalog.clear()
        catalog.update(trial)
        applied += 1
    if len(edits) > MAX_EDITS:
        rejected.append({'index': MAX_EDITS, 'op': None, 'reason': f'{len(edits) - MAX_EDITS} edit(s) above the limit of {MAX_EDITS} were not applied'})
    return applied, rejected


def main(argv):
    ap = argparse.ArgumentParser(description='Apply structured curation edits to a proposed item catalog.')
    ap.add_argument('--catalog', required=True, help='the proposed catalog')
    ap.add_argument('--edits', required=True, help='the curation result {"edits": [...]}; missing applies nothing')
    ap.add_argument('--inventory', required=True, help='inventory.json')
    ap.add_argument('--out', required=True, help='the curated catalog to write')
    ap.add_argument('--manifest', help='kintsugi.yaml (unitKinds)')
    args = ap.parse_args(argv[1:])
    try:
        inventory, _ = cc.load_inventory(args.inventory)
        catalog = cc.read_json(args.catalog, 'the proposed catalog')
        if not isinstance(catalog, dict) or not isinstance(catalog.get('items'), list) or not isinstance(catalog.get('modules'), list):
            raise cc.DataError('the proposed catalog must have modules and items')
        problems = cc.check_catalog(catalog, inventory)
        if problems:
            raise cc.DataError('the proposed catalog is inconsistent: ' + '; '.join(problems[:5]))
        note = None
        try:
            result = cc.read_optional_json(args.edits)
        except cc.DataError as error:
            result, note = None, f'the curation result was not read: {error}'
        edits = result.get('edits') if isinstance(result, dict) else None
        if not isinstance(edits, list):
            edits = []
            note = note or 'no curation edits'
        applied, rejected = apply_edits(catalog, edits, inventory, cc.unit_kinds(args.manifest))
        catalog['generatedBy'] = 'apply_catalog_edits.py'
        catalog['curation'] = {'applied': applied, 'rejected': rejected, **({'note': note} if note else {})}
        cc.write_json(os.path.abspath(args.out), catalog)
    except (cc.DataError, OSError, RecursionError) as error:
        print(f'apply_catalog_edits.py: {error}', file=sys.stderr)
        return 1
    print(f'{applied} edit(s) applied, {len(rejected)} rejected; {len(catalog["items"])} items -> {args.out}')
    for entry in rejected[:50]:
        print(f'- rejected edit {entry["index"]} ({entry["op"]}): {entry["reason"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
