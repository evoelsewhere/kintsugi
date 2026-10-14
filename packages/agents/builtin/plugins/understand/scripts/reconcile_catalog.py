#!/usr/bin/env python3
"""Keep the item ids of an application's catalog stable across re-assessments (ADR-0033).

    python3 reconcile_catalog.py --catalog FILE --inventory FILE --out FILE
        [--previous FILE] [--units-json FILE] [--units-dir DIR]

--catalog is this run's curated catalog; --inventory its inventory.json; --previous the catalog.json
on the document repository's default branch. Without a previous catalog, the old items are seeded
from the understand stage's units (ADR-0031): --units-json (knowledge/as-is/<app>/units.json) and
--units-dir (the units/<app>/ work-item files), so existing unit ids are kept. Missing inputs are
skipped. --out is the reconciled catalog.

Deterministic rules:
- A new item whose files overlap an old item's by Jaccard >= 0.5 takes the old id; the pairs are
  taken best first (higher Jaccard, then larger overlap, then ids). A changed name goes to `aliases`.
- An old item still without a match passes its id to the unmatched new item that holds the largest
  share of its files, if at least half of that new item's files came from it: a split keeps the id
  on its largest piece, the other pieces get new ids.
- An old item that matches nothing is kept with `status: "retired"`, never deleted, so its
  specifications and work items still resolve. A retired item that matches again becomes active.
- Modules keep their ids the same way: a new module takes the id of the old module most of its kept
  items came from (one to one, unless another new module has that id), and its new items move under
  it. A kept item keeps its id even when it now sits in another module: ids never change, `module`
  is where the item sits now.
- A new id that an old item holds already gets a -2, -3, ... suffix.
Standard library only.
"""
import argparse
import json
import os
import re
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import catalog_common as cc  # noqa: E402

THRESHOLD = 0.5
MAX_UNIT_FILES = 5_000
MAX_UNIT_BYTES = 200_000


def jaccard(a, b):
    union = len(a | b)
    return len(a & b) / union if union else 0.0


def old_from_catalog(previous):
    items = []
    for item in previous.get('items', []) if isinstance(previous, dict) else []:
        if not isinstance(item, dict) or not cc.ITEM_ID_RE.match(str(item.get('id', ''))):
            continue
        entry = cc.new_item(item['id'], item.get('module') if cc.SEGMENT_RE.match(str(item.get('module', ''))) else item['id'].split('/')[0],
                            cc.clean_text(item.get('kind'), 40) or 'module', cc.clean_text(item.get('name'), cc.MAX_NAME) or item['id'],
                            [rel for rel in (cc.norm_path(value) for value in item.get('files', []) if isinstance(item.get('files'), list)) if rel])
        for key in ('summary', 'digest', 'complexity'):
            if isinstance(item.get(key), str):
                entry[key] = item[key]
        for key in ('leaves', 'entryPoints', 'aliases'):
            if isinstance(item.get(key), list):
                entry[key] = [value for value in item[key] if isinstance(value, str)]
        if isinstance(item.get('parts'), list):
            entry['parts'] = [part for part in item['parts'] if isinstance(part, dict)][:cc.MAX_PARTS]
        if isinstance(item.get('loc'), int):
            entry['loc'] = item['loc']
        entry['status'] = 'retired' if item.get('status') == 'retired' else 'active'
        items.append(entry)
    modules = [m for m in previous.get('modules', []) if isinstance(m, dict) and cc.SEGMENT_RE.match(str(m.get('id', '')))] if isinstance(previous, dict) else []
    return items, modules


FRONT_FIELD = re.compile(r'^(id|title|module|kind):\s*(.+?)\s*$')


def scalar(value):
    value = value.strip()
    if value.startswith('"'):
        try:
            return str(json.loads(value))
        except json.JSONDecodeError:
            return value.strip('"')
    return value.strip("'")


def unit_file(path):
    """{id, title, module, kind, files} of a work-item file's frontmatter (a best-effort read)."""
    if os.path.islink(path) or os.path.getsize(path) > MAX_UNIT_BYTES:
        return None
    with open(path, encoding='utf-8-sig', errors='replace') as handle:
        lines = handle.read().splitlines()
    if not lines or lines[0].strip() != '---':
        return None
    fields, files, in_paths = {}, [], False
    for line in lines[1:]:
        if line.strip() == '---':
            break
        match = FRONT_FIELD.match(line)
        if match:
            fields[match.group(1)] = scalar(match.group(2))
            in_paths = False
            continue
        listed = re.search(r'paths:\s*(\[.*\])', line)
        if listed:
            try:
                files += [value for value in json.loads(listed.group(1)) if isinstance(value, str)]
            except json.JSONDecodeError:
                files += [scalar(value) for value in listed.group(1).strip('[]').split(',') if value.strip()]
            continue
        if re.match(r'^\s*-?\s*paths:\s*$', line):
            in_paths = True
            continue
        block = re.match(r'^\s+-\s+(.+)$', line)
        if in_paths and block:
            files.append(scalar(block.group(1)))
        elif not line.startswith(' '):
            in_paths = False
    return {**fields, 'files': files}


def expand(paths, inventory):
    """Inventory files of a unit's paths: a file as is, a directory as every inventory file under it.
    A path that names nothing of the inventory is kept as it is (the unit's code is gone)."""
    files = set()
    for rel in (cc.norm_path(value) for value in paths):
        if rel is None:
            continue
        if rel in inventory:
            files.add(rel)
            continue
        under = {path for path in inventory if path.startswith(rel.rstrip('/') + '/')}
        files |= under or {rel}
    return sorted(files)


def old_from_units(units_json, units_dir, inventory):
    """Seed items of the understand stage's units: units.json first, then work-item files. A unit
    lists the files of its map leaves, which may be directories: they are expanded on the inventory."""
    seeded = {}
    if isinstance(units_json, dict):
        for unit in units_json.get('units', []) if isinstance(units_json.get('units'), list) else []:
            if not isinstance(unit, dict) or not cc.ITEM_ID_RE.match(str(unit.get('key', ''))):
                continue
            files = expand(unit.get('files') if isinstance(unit.get('files'), list) else [], inventory)
            seeded[unit['key']] = cc.new_item(unit['key'], unit['key'].split('/')[0], cc.clean_text(unit.get('kind'), 40) or 'module',
                                              cc.clean_text(unit.get('title'), cc.MAX_NAME) or unit['key'], files)
    if units_dir and os.path.isdir(units_dir) and not os.path.islink(units_dir):
        count = 0
        for current, directories, names in os.walk(units_dir):
            directories[:] = sorted(name for name in directories if not os.path.islink(os.path.join(current, name)))
            for name in sorted(names):
                if not name.endswith('.md') or name.endswith('.example.md'):
                    continue
                count += 1
                if count > MAX_UNIT_FILES:
                    break
                unit = unit_file(os.path.join(current, name))
                key = '/'.join(str(unit.get('id', '')).split('/')[1:]) if unit else ''
                if not unit or not cc.ITEM_ID_RE.match(key):
                    continue
                files = expand(unit['files'], inventory)
                if key in seeded:
                    if not seeded[key]['files']:
                        seeded[key]['files'] = sorted(set(files))
                    continue
                seeded[key] = cc.new_item(key, unit.get('module') if cc.SEGMENT_RE.match(str(unit.get('module', ''))) else key.split('/')[0],
                                          cc.clean_text(unit.get('kind'), 40) or 'module', cc.clean_text(unit.get('title'), cc.MAX_NAME) or key, files)
    return [seeded[key] for key in sorted(seeded)], []


def match(new_items, old_items):
    """{new id: old id}."""
    new_files = {item['id']: set(item['files']) for item in new_items}
    old_files = {item['id']: set(item['files']) for item in old_items}
    by_file = {}
    for old_id, files in old_files.items():
        for rel in files:
            by_file.setdefault(rel, set()).add(old_id)
    pairs = []
    for new_id, files in new_files.items():
        candidates = set()
        for rel in files:
            candidates |= by_file.get(rel, set())
        for old_id in candidates:
            overlap = len(files & old_files[old_id])
            pairs.append((jaccard(files, old_files[old_id]), overlap, new_id, old_id))
    pairs.sort(key=lambda pair: (-pair[0], -pair[1], pair[2], pair[3]))
    matched, used = {}, set()
    for score, _, new_id, old_id in pairs:
        if score >= THRESHOLD and new_id not in matched and old_id not in used:
            matched[new_id] = old_id
            used.add(old_id)
    # Splits: an unmatched old item passes its id to its largest unmatched piece.
    for old_id in sorted(old_files):
        if old_id in used:
            continue
        best = None
        for new_id, files in new_files.items():
            if new_id in matched or not files:
                continue
            overlap = len(files & old_files[old_id])
            if overlap and overlap / len(files) >= THRESHOLD:
                key = (-overlap, new_id)
                if best is None or key < best[0]:
                    best = (key, new_id)
        if best is not None:
            matched[best[1]] = old_id
            used.add(old_id)
    return matched


def module_renames(new_items, old_of, new_module_ids):
    """{new module id: old module id}: a new module takes the old module most of its kept items came
    from, one to one, best first, unless another new module already has that id."""
    votes = {}
    for item in new_items:
        old = old_of.get(item['id'])
        if old is not None and old['module'] != item['module']:
            votes[(item['module'], old['module'])] = votes.get((item['module'], old['module']), 0) + 1
    renames, used = {}, set(new_module_ids)
    for (new_module, old_module), _ in sorted(votes.items(), key=lambda vote: (-vote[1], vote[0])):
        if new_module in renames or old_module in used:
            continue
        renames[new_module] = old_module
        used.add(old_module)
    return renames


def reconcile(catalog, old_items, old_modules):
    new_items = [item for item in catalog['items'] if item.get('status') != 'retired']
    old_by_id = {item['id']: item for item in old_items}
    old_of = {new_id: old_by_id[old_id] for new_id, old_id in match(new_items, old_items).items()}
    # Modules keep their ids too, so new items land under the module id a person already knows.
    renames = module_renames(new_items, old_of, {module['id'] for module in catalog['modules']})
    for module in catalog['modules']:
        module['id'] = renames.get(module['id'], module['id'])
    reserved = set(old_by_id)
    kept = {old['id'] for old in old_of.values()}
    taken = set(kept)
    result = []
    for item in sorted(new_items, key=lambda entry: entry['id']):
        old = old_of.get(item['id'])
        item['module'] = renames.get(item['module'], item['module'])
        if old is not None:
            item['id'] = old['id']
            aliases = [*old.get('aliases', []), *item.get('aliases', [])]
            if old['name'] != item['name']:
                aliases.append(old['name'])
            item['aliases'] = sorted({alias for alias in aliases if alias and alias != item['name']})
        else:
            base = item['id'].split('/', 1)[1]
            candidate = f'{item["module"]}/{base}'
            item['id'] = cc.unique_id(item['module'], base, taken | reserved) if candidate in taken | reserved else candidate
        taken.add(item['id'])
        item['status'] = 'active'
        result.append(item)
    retired = []
    for old in old_items:
        if old['id'] in kept:
            continue
        old['status'] = 'retired'
        retired.append(old)
    modules = {module['id']: module for module in catalog['modules']}
    known = {module['id']: module for module in old_modules}
    for module in modules.values():
        if not module.get('summary') and module['id'] in known:
            module['summary'] = cc.clean_text(known[module['id']].get('summary'), cc.MAX_SUMMARY)
    for old in retired:
        if old['module'] not in modules:
            previous = known.get(old['module'])
            modules[old['module']] = {'id': old['module'], 'name': cc.clean_text(previous.get('name'), cc.MAX_NAME) if previous else old['module'], 'summary': cc.clean_text(previous.get('summary'), cc.MAX_SUMMARY) if previous else ''}
    catalog['items'] = result + retired
    catalog['modules'] = list(modules.values())
    return {'kept': len(kept), 'new': len(result) - len(kept), 'retired': len(retired), 'renamed': sum(1 for item in result if item['id'] in kept and old_by_id[item['id']]['name'] != item['name'])}


def main(argv):
    ap = argparse.ArgumentParser(description='Keep catalog item ids stable across re-assessments.')
    ap.add_argument('--catalog', required=True, help="this run's curated catalog")
    ap.add_argument('--inventory', required=True, help='inventory.json of this run')
    ap.add_argument('--out', required=True, help='the reconciled catalog to write')
    ap.add_argument('--previous', help='catalog.json on the default branch (optional)')
    ap.add_argument('--units-json', help='knowledge/as-is/<app>/units.json, seeds the first reconcile (optional)')
    ap.add_argument('--units-dir', help='units/<app>/, seeds the first reconcile (optional)')
    args = ap.parse_args(argv[1:])
    try:
        inventory, _ = cc.load_inventory(args.inventory)
        catalog = cc.read_json(args.catalog, 'the curated catalog')
        if not isinstance(catalog, dict) or not isinstance(catalog.get('items'), list) or not isinstance(catalog.get('modules'), list):
            raise cc.DataError('the curated catalog must have modules and items')
        previous = cc.read_optional_json(args.previous)
        if isinstance(previous, dict) and isinstance(previous.get('items'), list):
            old_items, old_modules = old_from_catalog(previous)
            seeded = 'catalog'
        else:
            old_items, old_modules = old_from_units(cc.read_optional_json(args.units_json), args.units_dir, inventory)
            seeded = 'units' if old_items else 'none'
        counts = reconcile(catalog, old_items, old_modules)
        cc.refresh(catalog, inventory)
        problems = cc.check_catalog(catalog, inventory)
        if problems:
            raise cc.DataError('the reconciled catalog is inconsistent: ' + '; '.join(problems[:5]))
        catalog['generatedBy'] = 'reconcile_catalog.py'
        catalog['reconciled'] = {'from': seeded, **counts}
        cc.write_json(os.path.abspath(args.out), catalog)
    except (cc.DataError, OSError, RecursionError) as error:
        print(f'reconcile_catalog.py: {error}', file=sys.stderr)
        return 1
    print(f'reconciled with the {"previous catalog" if seeded == "catalog" else "existing units" if seeded == "units" else "nothing (first catalog)"}: '
          f'{counts["kept"]} id(s) kept, {counts["new"]} new, {counts["retired"]} retired, {counts["renamed"]} renamed -> {args.out}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
