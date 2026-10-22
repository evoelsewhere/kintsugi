"""Shared helpers of the item catalog scripts (ADR-0033): catalog_from_topology.py, apply_catalog_edits.py,
reconcile_catalog.py and render_catalog.py. Not a script on its own.

The catalog lists an application's items, module -> item. Inside a run it is one JSON document passed
between the steps (scratch, never committed):

    {"app": "...", "generatedBy": "...", "sources": ["<repository id>@<commit>", ...],
     "modules": [{"id", "name", "summary"}],
     "items": [{"id": "<module>/<item>", "module", "kind", "name", "summary", "files", "leaves",
                "entryPoints", "loc", "complexity", "digest", "status", "aliases", "parts"}],
     "unassigned": [...], "ambiguities": [...]}

What the run commits is Markdown (ADR-0042, docs/reference/document-formats.md): assessment/catalog/index.md
(the modules and the ambiguities) and assessment/catalog/<module>.md (one card per item, with its leaves,
the items it depends on and the data stores it touches). render_catalog() writes them and load_catalog()
reads them back, so the next assessment, the understand stage and the planning stage start from the
committed documents.

Invariant (checked by check_catalog): every file of the inventory is in exactly one active item or in
`unassigned`; item files are inventory files; ids are unique `<segment>/<segment>`. Standard library only.
"""
import hashlib
import json
import os
import re
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import docmd  # noqa: E402
import paths  # noqa: E402
import topology_units as tu  # noqa: E402

SEGMENT = r'[a-z0-9][a-z0-9-]{0,62}'
SEGMENT_RE = re.compile(rf'^{SEGMENT}$')
ITEM_ID_RE = re.compile(rf'^{SEGMENT}/{SEGMENT}$')
APP_RE = re.compile(r'^[a-z0-9][a-z0-9-]{0,62}$')
STATUSES = ('active', 'retired')
COMPLEXITY_BANDS = ('low', 'medium', 'high')
# Summed cyclomatic complexity of an item's files: up to LOW is low, up to MEDIUM is medium.
LOW, MEDIUM = 20, 100
# Without complexity figures, code lines decide: up to LOW_LOC is low, up to MEDIUM_LOC medium.
LOW_LOC, MEDIUM_LOC = 500, 2000
MAX_NAME = 120
MAX_SUMMARY = 1000
MAX_AMBIGUITIES = 200
MAX_PARTS = 100
# The unassigned files the committed index lists; the count is in its front matter.
MAX_UNASSIGNED_LISTED = 200


DataError = docmd.DataError
norm_path = docmd.norm_path
clean_text = docmd.clean_text
unit_kinds = docmd.manifest_unit_kinds
read_json = docmd.read_json
write_json = docmd.write_json


def slug(text, fallback='item'):
    return docmd.slug(text, fallback)


def read_optional_json(path):
    """The parsed scratch file, or None when the path is not given or not a file."""
    if not path or not os.path.isfile(path):
        return None
    return read_json(path)


def load_inventory(path):
    """{path: {'codeLines', 'complexity', 'sha256'}} of the run's inventory.json (scratch), in its (sorted) order."""
    data = read_json(path, 'inventory.json')
    if not isinstance(data, dict) or not isinstance(data.get('files'), list):
        raise DataError('inventory.json must be an object with a files list')
    files = {}
    for entry in data['files']:
        if not isinstance(entry, dict):
            continue
        rel = norm_path(entry.get('path'))
        if rel is None:
            continue
        lines = entry.get('codeLines')
        complexity = entry.get('cyclomaticComplexity')
        digest = entry.get('sha256')
        files[rel] = {
            'codeLines': lines if isinstance(lines, int) and not isinstance(lines, bool) and lines >= 0 else None,
            'complexity': complexity if isinstance(complexity, int) and not isinstance(complexity, bool) and complexity >= 0 else None,
            'sha256': digest if isinstance(digest, str) and re.fullmatch(r'[0-9a-f]{64}', digest) else None,
        }
    return files, sources_of(data.get('sources'))


def sources_of(value):
    """The `<repository id>@<commit>` entries of a `sources` list, in order; anything else is dropped."""
    return [entry for entry in value if isinstance(entry, str) and entry] if isinstance(value, list) else []


def digest_of(files, inventory):
    """sha256 over the item's sorted files and their per-file hashes ('-' when a file has none)."""
    hasher = hashlib.sha256()
    for rel in sorted(files):
        entry = inventory.get(rel) or {}
        hasher.update(f'{rel}\0{entry.get("sha256") or "-"}\n'.encode('utf-8'))
    return 'sha256:' + hasher.hexdigest()


def band(loc, complexity):
    if complexity is not None:
        return 'low' if complexity <= LOW else 'medium' if complexity <= MEDIUM else 'high'
    return 'low' if loc <= LOW_LOC else 'medium' if loc <= MEDIUM_LOC else 'high'


def refresh(catalog, inventory):
    """Recomputes loc, complexity and digest of the active items and the unassigned files."""
    covered = set()
    for item in catalog['items']:
        if item.get('status') == 'retired':
            continue
        item['files'] = sorted(set(item['files']))
        covered.update(item['files'])
        lines = [inventory[rel]['codeLines'] for rel in item['files'] if rel in inventory and inventory[rel]['codeLines'] is not None]
        if lines:
            item['loc'] = sum(lines)
        elif not isinstance(item.get('loc'), int):
            item['loc'] = 0
        measured = [inventory[rel]['complexity'] for rel in item['files'] if rel in inventory and inventory[rel]['complexity'] is not None]
        item['complexity'] = band(item['loc'], sum(measured) if measured else None)
        item['digest'] = digest_of(item['files'], inventory)
    catalog['unassigned'] = sorted(rel for rel in inventory if rel not in covered)
    used = {item['module'] for item in catalog['items']}
    catalog['modules'] = sorted((module for module in catalog['modules'] if module['id'] in used), key=lambda module: module['id'])
    catalog['items'].sort(key=lambda item: item['id'])
    return catalog


def check_catalog(catalog, inventory):
    """Problems of a catalog against its inventory; [] when it is valid."""
    problems = []
    module_ids = set()
    for module in catalog.get('modules', []):
        if not SEGMENT_RE.match(module.get('id', '')):
            problems.append(f'invalid module id {module.get("id")!r}')
        module_ids.add(module.get('id'))
    seen_ids, owner = set(), {}
    for item in catalog.get('items', []):
        item_id = item.get('id', '')
        if not ITEM_ID_RE.match(item_id):
            problems.append(f'invalid item id {item_id!r}')
        if item_id in seen_ids:
            problems.append(f'duplicate item id {item_id}')
        seen_ids.add(item_id)
        if item.get('module') not in module_ids:
            problems.append(f'item {item_id} names the unknown module {item.get("module")!r}')
        if item.get('status') not in STATUSES:
            problems.append(f'item {item_id} has the invalid status {item.get("status")!r}')
        if item.get('status') == 'retired':
            continue
        if not item.get('files'):
            problems.append(f'item {item_id} has no files')
        for rel in item.get('files', []):
            if rel not in inventory:
                problems.append(f'item {item_id} names {rel}, which is not in the inventory')
            elif rel in owner:
                problems.append(f'{rel} is in both {owner[rel]} and {item_id}')
            else:
                owner[rel] = item_id
    unassigned = set(catalog.get('unassigned', []))
    for rel in unassigned & set(owner):
        problems.append(f'{rel} is both unassigned and in {owner[rel]}')
    missing = [rel for rel in inventory if rel not in owner and rel not in unassigned]
    if missing:
        problems.append(f'{len(missing)} inventory file(s) in no item and not unassigned (first: {missing[0]})')
    return problems


def new_item(item_id, module, kind, name, files, **extra):
    item = {
        'id': item_id,
        'module': module,
        'kind': kind,
        'name': name,
        'summary': '',
        'files': sorted(set(files)),
        'leaves': [],
        'entryPoints': [],
        'loc': 0,
        'complexity': 'low',
        'digest': '',
        'status': 'active',
        'aliases': [],
        'parts': [],
    }
    item.update(extra)
    return item


def unique_id(module, base, taken):
    """`<module>/<base>`, or with -2, -3, ... when taken; the segment stays within 63 characters."""
    base = slug(base)[:56].strip('-') or 'item'
    candidate, count = f'{module}/{base}', 1
    while candidate in taken:
        count += 1
        candidate = f'{module}/{base}-{count}'
    return candidate


# ---------------------------------------------------------------------------
# The item graph: what each item calls, what calls it, the data stores it touches
# ---------------------------------------------------------------------------

def item_graph(items, topology):
    """{item id: {'leafNodes', 'dependsOn', 'usedBy', 'dataStores'}} of the active items, from the
    run's raw topology (a dict as the extraction script writes it; None gives items without links).

    dependsOn is [{'item', 'kinds', 'edges'}] (calls from this item's leaves into another item's),
    usedBy the item ids that depend on it, dataStores [{'id', 'access'}], leafNodes the item's leaves
    as {'id', 'name', 'kind', 'file', 'loc', 'entry'}."""
    active = [item for item in items if item.get('status') != 'retired']
    leaves = {leaf['id']: leaf for leaf in tu.walk_topology(topology)} if topology is not None else {}
    entry_leaves = {leaf for leaf in (topology or {}).get('entryPoints', []) if isinstance(leaf, str)}
    leaf_item = {}
    for item in active:
        for leaf in item.get('leaves') or []:
            if isinstance(leaf, str):
                leaf_item.setdefault(leaf, item['id'])
    depends, stores = {}, {}
    for edge in (topology or {}).get('edges', []):
        if not isinstance(edge, dict) or not isinstance(edge.get('source'), str) or not isinstance(edge.get('target'), str):
            continue
        source = leaf_item.get(edge['source'])
        if source is None:
            continue
        kind = clean_text(edge.get('kind'), 20) or 'call'
        target = leaf_item.get(edge['target'])
        if target is not None:
            if target != source:
                entry = depends.setdefault(source, {}).setdefault(target, {'kinds': set(), 'edges': 0})
                entry['kinds'].add(kind)
                entry['edges'] += 1
        elif leaves.get(edge['target'], {}).get('kind') == 'datastore' or edge['target'].startswith('ds:'):
            stores.setdefault(source, {}).setdefault(edge['target'], set()).add(kind)
    used_by = {}
    for source, targets in depends.items():
        for target in targets:
            used_by.setdefault(target, set()).add(source)
    graph = {}
    for item in active:
        item_id = item['id']
        graph[item_id] = {
            'leafNodes': [
                {'id': leaf, 'name': leaves[leaf]['name'], 'kind': leaves[leaf]['kind'], 'file': leaves[leaf]['file'] or '', 'loc': leaves[leaf]['loc'], 'entry': leaf in entry_leaves}
                for leaf in item.get('leaves') or [] if leaf in leaves
            ],
            'dependsOn': [{'item': target, 'kinds': sorted(info['kinds']), 'edges': info['edges']} for target, info in sorted(depends.get(item_id, {}).items())],
            'usedBy': sorted(used_by.get(item_id, ())),
            'dataStores': [{'id': store, 'access': sorted(kinds)} for store, kinds in sorted(stores.get(item_id, {}).items())],
        }
    return graph


# ---------------------------------------------------------------------------
# The committed catalog: assessment/catalog/index.md and assessment/catalog/<module>.md
# ---------------------------------------------------------------------------

def render_catalog(app, catalog, graph=None):
    """{repository-relative path: text} of the catalog documents. `graph` is item_graph()'s result."""
    graph = graph or {}
    sources = sources_of(catalog.get('sources'))
    modules = {module['id']: module for module in catalog['modules']}
    by_module = {}
    for item in catalog['items']:
        by_module.setdefault(item['module'], []).append(item)
    for module in by_module:
        modules.setdefault(module, {'id': module, 'name': module, 'summary': ''})
    unassigned = catalog.get('unassigned') or []
    active = [item for item in catalog['items'] if item.get('status') != 'retired']
    out = {}

    index = [
        docmd.front_matter({
            'app': app,
            'generatedBy': catalog.get('generatedBy') or 'render_catalog.py',
            'sources': sources,
            'modules': len(modules),
            'items': len(active),
            'retired': len(catalog['items']) - len(active),
            'unassigned': len(unassigned),
        }),
        f'# Item catalog of {app}',
        '',
        'The items a person selects for analysis, module by module. Each module has its own document with one card per item; '
        'the ids are stable across assessments.',
        '',
        '## Modules',
        '',
        docmd.table(['Module', 'Name', 'Items', 'Summary'], [
            [module_id, module['name'], len(by_module.get(module_id, [])), clean_text(module.get('summary'), 200)] for module_id, module in sorted(modules.items())
        ]),
        '## Items',
        '',
        docmd.table(['Item', 'Name', 'Kind', 'Status', 'LOC', 'Complexity', 'Files'], [
            [item['id'], item['name'], item['kind'], item['status'], item['loc'], item['complexity'], len(item['files'])]
            for item in sorted(catalog['items'], key=lambda entry: entry['id'])
        ]),
    ]
    if catalog.get('ambiguities'):
        index += ['## Ambiguities', '', 'What a person should check.', '', docmd.bullet_list(catalog['ambiguities'][:MAX_AMBIGUITIES], coded=False)]
    if unassigned:
        listed = unassigned[:MAX_UNASSIGNED_LISTED]
        more = f' ({len(unassigned) - len(listed)} more not listed)' if len(unassigned) > len(listed) else ''
        index += ['## Unassigned files', '', f'Inventory files in no item: documentation, build files, or code the topology did not place{more}.', '', docmd.bullet_list(listed)]
    out[paths.assessment_catalog_path(app)] = '\n'.join(index).rstrip() + '\n'

    for module_id, module in sorted(modules.items()):
        lines = [docmd.front_matter({'module': module_id, 'name': module['name'], 'items': len(by_module.get(module_id, []))}), f'# {module["name"]}', '']
        if clean_text(module.get('summary'), MAX_SUMMARY):
            lines += [clean_text(module.get('summary'), MAX_SUMMARY), '']
        for item in sorted(by_module.get(module_id, []), key=lambda entry: entry['id']):
            facts = graph.get(item['id'], {})
            lines += [docmd.heading(2, item['id'], clean_text(item['name'], MAX_NAME)), '']
            if clean_text(item.get('summary'), MAX_SUMMARY):
                lines += [clean_text(item.get('summary'), MAX_SUMMARY), '']
            lines.append(docmd.field_lines({
                'kind': item['kind'],
                'status': item['status'],
                'loc': item['loc'],
                'complexity': item['complexity'],
                'digest': item.get('digest') or '',
                'aliases': item.get('aliases') or [],
            }, coded=('digest',)))
            if item.get('leaves'):
                rows = facts.get('leafNodes')
                if rows:
                    lines += ['### Leaves', '', docmd.table(['Leaf', 'Name', 'Kind', 'File', 'LOC', 'Entry point'], [
                        [leaf['id'], leaf['name'], leaf['kind'], leaf['file'], '' if leaf['loc'] is None else leaf['loc'], 'yes' if leaf['entry'] else ''] for leaf in rows
                    ])]
                else:
                    lines += ['### Leaves', '', docmd.table(['Leaf', 'Name', 'Kind', 'File', 'LOC', 'Entry point'], [[leaf, '', '', '', '', 'yes' if leaf in item.get('entryPoints', []) else ''] for leaf in item['leaves']])]
            if facts.get('dependsOn'):
                lines += ['### Depends on', '', docmd.table(['Item', 'Kinds', 'Edges'], [[dep['item'], ', '.join(dep['kinds']), dep['edges']] for dep in facts['dependsOn']])]
            if facts.get('usedBy'):
                lines += ['### Used by', '', docmd.bullet_list(facts['usedBy'])]
            if facts.get('dataStores'):
                lines += ['### Data stores', '', docmd.table(['Store', 'Access'], [[store['id'], ', '.join(store['access'])] for store in facts['dataStores']])]
            if item.get('parts'):
                lines += ['### Parts', '', docmd.table(['Part', 'Kind', 'File'], [[part.get('name'), part.get('kind') or '', part.get('file') or ''] for part in item['parts'][:MAX_PARTS]])]
            if item['files']:
                lines += ['### Files', '', docmd.bullet_list(item['files'])]
            lines.append('')
        out[paths.assessment_catalog_module_path(app, module_id)] = '\n'.join(lines).rstrip() + '\n'
    return out


def _read_catalog_dir(directory):
    index_path = os.path.join(directory, 'index.md')
    if not os.path.isfile(index_path):
        raise DataError('the catalog has no index.md')
    return docmd.read_text(index_path, 'catalog/index.md')


def load_catalog_dir(directory):
    """The committed catalog as (items by id, catalog dict): the shape the scratch JSON has, plus, per
    active item, the links of its card (`dependsOn`, `usedBy`, `dataStores`, `leafNodes`)."""
    front, body = docmd.split_front_matter(_read_catalog_dir(directory))
    app = front.get('app') if isinstance(front.get('app'), str) else ''
    modules = []
    for row in docmd.records_in(dict(docmd.sections(body, 2)).get('Modules', '')):
        if SEGMENT_RE.match(row.get('module', '')):
            modules.append({'id': row['module'], 'name': clean_text(row.get('name'), MAX_NAME) or row['module'], 'summary': clean_text(row.get('summary'), MAX_SUMMARY)})
    sections = dict(docmd.sections(body, 2))
    ambiguities = docmd.bullets_in(sections.get('Ambiguities', ''))
    unassigned = [rel for rel in (norm_path(value) for value in docmd.bullets_in(sections.get('Unassigned files', ''))) if rel]
    items = {}
    for module in modules:
        path = os.path.join(directory, f'{module["id"]}.md')
        if not os.path.isfile(path):
            continue
        for title, card in docmd.sections(docmd.split_front_matter(docmd.read_text(path, f'catalog/{module["id"]}.md'))[1], 2):
            item_id, name = docmd.split_heading(title)
            if not ITEM_ID_RE.match(item_id) or item_id in items:
                continue
            prose, fields, subs = docmd.parse_card(card, 2)
            files = [rel for rel in (norm_path(value) for value in docmd.bullets_in(subs.get('Files', ''))) if rel]
            leaf_rows = docmd.records_in(subs.get('Leaves', ''))
            entry_points = [row['leaf'] for row in leaf_rows if row.get('entry point', '').strip().lower() == 'yes']
            items[item_id] = {
                'id': item_id,
                'module': module['id'],
                'kind': clean_text(fields.get('kind'), 40) or 'module',
                'name': clean_text(name, MAX_NAME) or item_id,
                'summary': clean_text(prose, MAX_SUMMARY),
                'files': sorted(set(files)),
                'leaves': [row['leaf'] for row in leaf_rows if row.get('leaf')],
                'entryPoints': entry_points,
                'loc': docmd.as_int(fields.get('loc')),
                'complexity': fields.get('complexity') if fields.get('complexity') in COMPLEXITY_BANDS else 'low',
                'digest': fields.get('digest') if isinstance(fields.get('digest'), str) else '',
                'status': 'retired' if fields.get('status') == 'retired' else 'active',
                'aliases': [value for value in docmd.as_list(fields.get('aliases')) if isinstance(value, str)],
                'parts': [{k: v for k, v in (('name', row.get('part')), ('kind', row.get('kind')), ('file', row.get('file'))) if v} for row in docmd.records_in(subs.get('Parts', '')) if row.get('part')][:MAX_PARTS],
                'dependsOn': [
                    {'item': row['item'], 'kinds': [kind.strip() for kind in row.get('kinds', '').split(',') if kind.strip()], 'edges': docmd.as_int(row.get('edges'), 1)}
                    for row in docmd.records_in(subs.get('Depends on', '')) if ITEM_ID_RE.match(row.get('item', ''))
                ],
                'usedBy': [value for value in docmd.bullets_in(subs.get('Used by', '')) if ITEM_ID_RE.match(value)],
                'dataStores': [
                    {'id': row['store'], 'access': [kind.strip() for kind in row.get('access', '').split(',') if kind.strip()]}
                    for row in docmd.records_in(subs.get('Data stores', '')) if row.get('store')
                ],
                'leafNodes': [
                    {'id': row['leaf'], 'name': row.get('name', ''), 'kind': row.get('kind', ''), 'file': row.get('file', ''), 'loc': docmd.as_int(row.get('loc'), None) if row.get('loc') else None, 'entry': row.get('entry point', '').strip().lower() == 'yes'}
                    for row in leaf_rows if row.get('leaf')
                ],
            }
    catalog = {
        'app': app,
        'generatedBy': front.get('generatedBy') if isinstance(front.get('generatedBy'), str) else '',
        'sources': sources_of(front.get('sources')),
        'modules': modules,
        'items': list(items.values()),
        'unassigned': unassigned,
        'ambiguities': ambiguities,
    }
    return items, catalog


def load_catalog(path):
    """The catalog's items by id (every status) and the catalog itself. `path` is the committed catalog
    folder (assessment/catalog/) or a run's scratch catalog.json; DataError when it is not a catalog."""
    if os.path.isdir(path):
        return load_catalog_dir(path)
    data = read_json(path, 'catalog.json')
    if not isinstance(data, dict) or not isinstance(data.get('items'), list):
        raise DataError('catalog.json must be an object with an items list')
    items = {}
    for item in data['items']:
        if isinstance(item, dict) and ITEM_ID_RE.match(str(item.get('id', ''))):
            files = item.get('files') if isinstance(item.get('files'), list) else []
            items[item['id']] = {**item, 'files': sorted({rel for rel in (norm_path(value) for value in files) if rel})}
    return items, data


def selected(items, value):
    """The active items named by --items (comma-separated ids), in id order; DataError for an unknown or retired id."""
    ids = sorted({part.strip() for part in str(value or '').split(',') if part.strip()})
    if not ids:
        raise DataError('--items names no item')
    unknown = [item_id for item_id in ids if item_id not in items or items[item_id].get('status') == 'retired']
    if unknown:
        raise DataError(f'unknown or retired item(s): {", ".join(unknown[:10])}')
    return [items[item_id] for item_id in ids]


def owner_of(items):
    """{file: item id} over the given items."""
    owner = {}
    for item in items:
        for rel in item['files']:
            owner.setdefault(rel, item['id'])
    return owner


def namespaced(prefix, item_id, number):
    """An item-namespaced id: SEC-invoicing.invoice-entry-03 (ADR-0033 §5)."""
    return f'{prefix}-{item_id.replace("/", ".")}-{number:02d}'


CITATION_RE = re.compile(r'^(?P<path>.*):(?P<start>\d+)(?:-(?P<end>\d+))?$')
HASH_HEX = 8
DISC_MAX = 31


def canonical_citation(source):
    """The canonical form of a rule's `path:start-end` citation: POSIX separators, no leading `./`
    or trailing `/`, and the line range as `start-end` (`end` defaults to `start`, a reversed range
    is flipped). A citation without a line range canonicalizes to `path:0-0`; an empty or missing
    source canonicalizes to '' so a rerun with the same source keeps the id."""
    text = source.strip().strip('`"\'').strip() if isinstance(source, str) else ''
    text = text.replace('\\', '/')
    match = CITATION_RE.match(text)
    if match:
        path, start, end = match.group('path'), int(match.group('start')), int(match.group('end') or match.group('start'))
    else:
        path, start, end = text, 0, 0
    path = re.sub(r'/+', '/', path)
    while path.startswith('./'):
        path = path[2:]
    path = path.rstrip('/')
    if not path:
        return ''
    if start > end:
        start, end = end, start
    return f'{path}:{start}-{end}'


def rule_body(rule):
    """The rule without its id, canonically serialized (for duplicate and discriminator checks)."""
    return json.dumps({key: value for key, value in rule.items() if key != 'id'}, sort_keys=True, ensure_ascii=False)


def stable_rule_id(item_id, rule, discriminator=''):
    """A citation-derived rule id (ADR-0038): RULE-invoicing.invoice-entry-1a2b3c4d. The suffix
    hashes the unit key and the canonical citation of the rule's source, so a rerun with the same
    unit and citation keeps the id. `discriminator` (the normalized rule name) only separates two
    distinct rules sharing one exact citation; array order never takes part in an id."""
    suffix = hashlib.sha256(f'{item_id}\n{canonical_citation(rule.get("source"))}'.encode('utf-8')).hexdigest()[:HASH_HEX]
    if discriminator:
        suffix = f'{suffix}-{discriminator}'
    return f'RULE-{item_id.replace("/", ".")}-{suffix}'


def assign_rule_ids(item_id, rules):
    """`rules` in their given order, each with a stable `id`; an exact duplicate rule collapses to
    one entry. Two distinct rules on one exact citation are told apart by a discriminator from the
    normalized rule name; if the name also collides, the discriminator gets a short hash of the
    rule body instead of relying on order."""
    bodies_per_citation = {}
    for rule in rules:
        bodies_per_citation.setdefault(canonical_citation(rule.get('source')), set()).add(rule_body(rule))
    disc_counts = {}
    for rule in rules:
        citation = canonical_citation(rule.get('source'))
        if len(bodies_per_citation[citation]) > 1:
            disc = slug(clean_text(rule.get('name'), MAX_NAME), 'rule')[:DISC_MAX].strip('-') or 'rule'
            disc_counts.setdefault((citation, disc), set()).add(rule_body(rule))
    out, seen = [], set()
    for rule in rules:
        body = rule_body(rule)
        if body in seen:
            continue
        seen.add(body)
        citation = canonical_citation(rule.get('source'))
        disc = ''
        if len(bodies_per_citation[citation]) > 1:
            disc = slug(clean_text(rule.get('name'), MAX_NAME), 'rule')[:DISC_MAX].strip('-') or 'rule'
            if len(disc_counts[(citation, disc)]) > 1:
                disc = f'{disc[:DISC_MAX - 5].strip("-")}-{hashlib.sha256(body.encode("utf-8")).hexdigest()[:4]}'
        out.append({**rule, 'id': stable_rule_id(item_id, rule, disc)})
    return out


RULE_REVIEW_VERDICTS = ('confirmed', 'refuted', 'clarify')


def load_rules_review(path):
    """One unit's human rule verdicts: {rule id: {'verdict', 'approver', 'date'}} (ADR-0038).
    The file is human-owned (a table `Rule | Verdict | Approver | Date`) and authored through a pull
    request; no script of this plugin writes it."""
    rows = docmd.records_in(docmd.read_text(path, 'rules-review.md'))
    reviews = {}
    for row in rows:
        rule_id, verdict = row.get('rule', '').strip('` '), row.get('verdict', '').strip().lower()
        if not rule_id:
            raise DataError('rules-review.md: a row has no rule id')
        if verdict not in RULE_REVIEW_VERDICTS:
            raise DataError(f'rules-review.md: {rule_id} has no verdict of {"|".join(RULE_REVIEW_VERDICTS)}')
        if not row.get('approver') or not row.get('date'):
            raise DataError(f'rules-review.md: {rule_id} has no approver and date')
        reviews[rule_id] = {'verdict': verdict, 'approver': row['approver'], 'date': row['date']}
    return reviews


def orphan_review_ids(reviews, rule_ids):
    """Verdicts whose rule id is not among `rule_ids`: reported as orphaned, never silently applied."""
    known = set(rule_ids)
    return sorted(rule_id for rule_id in reviews if rule_id not in known)


# Item-namespaced rule ids: legacy sequential suffixes and the citation-derived ones (ADR-0038),
# plus the `RULE-NNN` estate-wide ids and the `RULE-<segment>-NNN` legacy namespaced form.
ITEM_RULE_ID = re.compile(
    rf'^RULE-(?:[0-9]{{2,}}|{SEGMENT}(?:\.{SEGMENT})?-(?:[0-9]{{2,}}|[0-9a-f]{{{HASH_HEX}}}(?:-[a-z0-9][a-z0-9-]{{0,{DISC_MAX}}})?))$'
)
ITEM_FINDING_ID = re.compile(rf'^SEC-{SEGMENT}\.{SEGMENT}-\d{{2,}}$')
