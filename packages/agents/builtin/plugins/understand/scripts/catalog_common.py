"""Shared helpers of the item catalog scripts (ADR-0033): catalog_from_topology.py,
apply_catalog_edits.py and reconcile_catalog.py. Not a script on its own.

The catalog (`applications/<app>/assessment/catalog.json`) lists an application's items, module -> item:

    {"schemaVersion": 1, "app": "...", "generatedBy": "...", "source": {"repo": "...", "commit": "..."},
     "modules": [{"id", "name", "summary"}],
     "items": [{"id": "<module>/<item>", "module", "kind", "name", "summary", "files", "leaves",
                "entryPoints", "loc", "complexity", "digest", "status", "aliases", "parts"}],
     "unassigned": [...], "ambiguities": [...]}

Invariant (checked by check_catalog): every file of inventory.json is in exactly one active item or
in `unassigned`; item files are inventory files; ids are unique `<segment>/<segment>`.
The path, slug and unitKinds helpers are the ones of units_from_topology.py, which the catalog
evolves. Standard library only.
"""
import hashlib
import json
import os
import re
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import units_from_topology as uft  # noqa: E402

SCHEMA_VERSION = 1
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
MAX_JSON_BYTES = 16_000_000
MAX_NAME = 120
MAX_SUMMARY = 1000
MAX_AMBIGUITIES = 200
MAX_PARTS = 100


DataError = uft.DataError
norm_path = uft.norm_path
unit_kinds = uft.unit_kinds


def slug(text, fallback='item'):
    return uft.slug(text, fallback)


def read_json(path, what=None):
    name = what or os.path.basename(path)
    if os.path.islink(path):
        raise DataError(f'refusing to read through a symbolic link: {name}')
    if os.path.getsize(path) > MAX_JSON_BYTES:
        raise DataError(f'{name} exceeds the {MAX_JSON_BYTES}-byte limit')
    with open(path, 'rb') as handle:
        data = handle.read(MAX_JSON_BYTES + 1)
    try:
        return json.loads(data.decode('utf-8-sig'))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DataError(f'{name} is not valid UTF-8 JSON: {error.__class__.__name__}') from error


def read_optional_json(path):
    """The parsed file, or None when the path is not given or not a file."""
    if not path or not os.path.isfile(path):
        return None
    return read_json(path)


def write_json(path, value):
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    temporary = path + '.tmp'
    if os.path.islink(path) or os.path.islink(temporary):
        raise DataError(f'refusing to write through a symbolic link: {os.path.basename(path)}')
    with open(temporary, 'w', encoding='utf-8', newline='\n') as handle:
        json.dump(value, handle, indent=1, ensure_ascii=False)
        handle.write('\n')
    os.replace(temporary, path)




def clean_text(value, limit):
    """A single-line, bounded, printable string ('' for anything else)."""
    if not isinstance(value, str):
        return ''
    text = ''.join(ch if ch.isprintable() else ' ' for ch in value)
    return re.sub(r'\s+', ' ', text).strip()[:limit]


def load_inventory(path):
    """{path: {'codeLines', 'complexity', 'sha256'}} of inventory.json, in its (sorted) order."""
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
    source = {
        'repo': data.get('sourceRepository') if isinstance(data.get('sourceRepository'), str) else None,
        'commit': data.get('sourceCommit') if isinstance(data.get('sourceCommit'), str) else None,
    }
    return files, source


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
                problems.append(f'item {item_id} names {rel}, which is not in inventory.json')
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
# Scoped understand runs (ADR-0033): the selected items of a catalog.
# ---------------------------------------------------------------------------

def load_catalog(path):
    """The catalog's items by id (every status) and its modules; DataError when it is not a catalog."""
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
    The file is human-owned and authored through a pull request; no script of this plugin writes it."""
    data = read_json(path, 'rules-review.json')
    if not isinstance(data, dict):
        raise DataError('rules-review.json must be an object of rule id -> review')
    reviews = {}
    for rule_id, review in data.items():
        if not isinstance(rule_id, str) or not rule_id or not isinstance(review, dict):
            raise DataError('rules-review.json must be an object of rule id -> review')
        verdict, approver, date = review.get('verdict'), review.get('approver'), review.get('date')
        if not isinstance(verdict, str) or verdict not in RULE_REVIEW_VERDICTS:
            raise DataError(f'rules-review.json: {rule_id} has no verdict of {"|".join(RULE_REVIEW_VERDICTS)}')
        if not isinstance(approver, str) or not isinstance(date, str):
            raise DataError(f'rules-review.json: {rule_id} has no approver and date')
        reviews[rule_id] = {'verdict': verdict, 'approver': approver, 'date': date}
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
