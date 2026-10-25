"""Published reference IDs and Markdown allocation ledgers (ADR-0075). Standard library only.

The catalog owns scopes; each unit owns a separate ledger per type, so different units and
the rules/security steps never contend for a counter. Never reconstruct a lost ledger from order.
"""
import hashlib
import json
import os
import re

import docmd
import paths

TYPES = {'RULE': 'rules', 'SEC': 'findings', 'GAP': 'gaps'}
SCOPE = re.compile(r'^[A-Z][A-Z0-9]{1,15}$')
MODULE_CODE = re.compile(r'^[A-Z][A-Z0-9]{0,7}$')
REFERENCE = re.compile(r'^(RULE|SEC|GAP)-([A-Z][A-Z0-9]{1,15})-([0-9]{4,})$')
FINGERPRINT = re.compile(r'^[0-9a-f]{64}$')


class DataError(docmd.DataError):
    """An invalid catalog or allocation ledger; fail closed rather than reuse an ID."""


def normalized(value):
    return ' '.join(str(value or '').split()).casefold()


def fingerprint(*values):
    return hashlib.sha256(json.dumps([' '.join(str(v or '').split()) for v in values], ensure_ascii=False).encode('utf-8')).hexdigest()


def validate_catalog_codes(catalog):
    """Historical catalogs may omit codes, but provided codes must be valid and unique."""
    for entries, key, pattern, reserved in ((catalog['modules'], 'code', MODULE_CODE, {'APP'}),
                                            (catalog['items'], 'referenceCode', SCOPE, {'APP00'})):
        seen = set(reserved)
        for entry in entries:
            code = entry.get(key)
            if code is None:
                continue
            if not isinstance(code, str) or not pattern.fullmatch(code) or code in seen:
                raise DataError(f'duplicate or invalid catalog {key}: {code}')
            seen.add(code)


def assign_catalog_codes(catalog):
    """Keep supplied codes, including retired units; allocate new codes in stable key order."""
    if not isinstance(catalog.get('modules'), list) or not isinstance(catalog.get('items'), list):
        raise DataError('the catalog must have modules and items lists')
    if any(not isinstance(m, dict) or not isinstance(m.get('id'), str) for m in catalog['modules']):
        raise DataError('invalid catalog module')
    if any(not isinstance(i, dict) or not isinstance(i.get('id'), str) or not isinstance(i.get('module'), str) for i in catalog['items']):
        raise DataError('invalid catalog item')
    validate_catalog_codes(catalog)
    modules = {m['id']: m for m in catalog['modules']}
    for item in catalog['items']:
        modules.setdefault(item['module'], {'id': item['module'], 'name': item['module'], 'summary': ''})
    # APP00 is reserved for the standalone, application-wide rules renderer.
    used_modules = {'APP', *(module['code'] for module in modules.values() if module.get('code'))}
    for module_id, module in sorted(modules.items()):
        if module.get('code'):
            continue
        words = re.findall(r'[A-Za-z0-9]+', module_id)
        base = (''.join(w[0] for w in words) if len(words) > 1 else ''.join(words)[:4]).upper()
        if not base or not base[0].isalpha():
            base = 'M' + base
        base = base[:6]
        code, number = base, 1
        while code in used_modules:
            number += 1
            suffix = str(number)
            code = base[:8-len(suffix)] + suffix
        module['code'] = code
        used_modules.add(code)
    used = {'APP00', *(item['referenceCode'] for item in catalog['items'] if item.get('referenceCode'))}
    for item in sorted(catalog['items'], key=lambda i: i['id']):
        if item.get('referenceCode'):
            continue
        prefix = modules[item['module']]['code']
        # Always append after the highest allocated suffix, including retired/moved units.
        suffixes = [int(code[len(prefix):]) for code in used if code.startswith(prefix) and code[len(prefix):].isdigit()]
        number = max(suffixes, default=0) + 1
        code = f'{prefix}{number:02d}'
        while code in used:
            number += 1
            code = f'{prefix}{number:02d}'
        if not SCOPE.fullmatch(code):
            raise DataError(f'reference scope exhausted for module {item["module"]}')
        item['referenceCode'] = code
        used.add(code)
    catalog['modules'] = list(modules.values())


def scope_of(item):
    scope = item.get('referenceCode', '')
    if not isinstance(scope, str) or not SCOPE.fullmatch(scope):
        raise DataError(f'{item["id"]}: no referenceCode in the catalog; run assess before understand')
    return scope


def registry_path(app, item, kind):
    return paths.unit_identifier_registry_path(app, *item['id'].split('/'), TYPES[kind])


def prior_registry(docs, app, item, kind):
    path = registry_path(app, item, kind)
    text = docmd.read_optional_text(os.path.join(docs, *path.split('/'))) if docs else None
    # A deleted ledger must never silently reset a published counter.
    # The current specification is already overlaid into inputs at finish time, so use the
    # prior understanding record to distinguish a rerun from a first specification.
    published = {'RULE': paths.unit_rules_path, 'SEC': paths.unit_findings_path, 'GAP': paths.unit_understanding_path}[kind]
    if text is None and docs and os.path.isfile(os.path.join(docs, *published(app, *item['id'].split('/')).split('/'))):
        raise DataError(f'{path}: missing allocation ledger for existing references; restore it from Git')
    return text


def read_registry(text, kind, scope):
    if text is None:
        return []
    front, body = docmd.split_front_matter(text)
    if front.get('type') != kind or front.get('scope') != scope or front.get('version') != 1:
        raise DataError(f'{kind}-{scope}: invalid allocation ledger header')
    tables = docmd.tables_in(body)
    if len(tables) != 1 or [column.lower() for column in tables[0][0]] != ['id', 'fingerprints', 'anchor', 'status']:
        raise DataError(f'{kind}-{scope}: invalid allocation ledger table')
    rows, seen_ids, seen_keys = [], set(), set()
    for row in docmd.records_in(body):
        ident = row.get('id', '')
        match = REFERENCE.fullmatch(ident)
        keys = row.get('fingerprints', '').split(',')
        anchor = row.get('anchor', '')
        if (not match or match[1] != kind or match[2] != scope or int(match[3]) < 1
                or (match and match[3] != f'{int(match[3]):04d}') or ident in seen_ids or not keys or len(set(keys)) != len(keys) or any(not FINGERPRINT.fullmatch(k) or k in seen_keys for k in keys)
                or not FINGERPRINT.fullmatch(anchor) or row.get('status') not in ('active', 'retired')):
            raise DataError(f'{kind}-{scope}: invalid or duplicate allocation ledger row')
        seen_ids.add(ident)
        seen_keys.update(keys)
        rows.append({'id': ident, 'fingerprints': keys, 'anchor': anchor, 'status': row['status']})
    if not rows and front.get('allocated') != 0:
        raise DataError(f'{kind}-{scope}: allocation ledger rows are missing')
    if front.get('allocated') != len(rows):
        raise DataError(f'{kind}-{scope}: allocation ledger count does not match its rows')
    return rows


def allocate(kind, scope, records, previous=None):
    """Records are (payload, identity fingerprint, anchor fingerprint). Exact duplicates collapse.

    Exact identities reactivate retired IDs. A unique active anchor preserves an ID when only its
    label changes. Ambiguous anchors get fresh numbers; retired numbers never go to a new identity.
    """
    if kind not in TYPES or not SCOPE.fullmatch(scope):
        raise DataError('invalid reference type or scope')
    ledger = read_registry(previous, kind, scope)
    by_key = {key: row for row in ledger for key in row['fingerprints']}
    entries = {}
    for payload, key, anchor in records:
        if key in entries:
            # Same identity with conflicting facts is unsafe to resolve by array order.
            if entries[key][0] != payload:
                raise DataError(f'{kind}-{scope}: distinct records share the same identity')
            continue
        entries[key] = (payload, anchor)
    matches = {key: by_key[key] for key in entries if key in by_key}
    claimed = {row['id'] for row in matches.values()}
    # Two historical aliases cannot claim the same ID in a single extraction.
    if len(claimed) != len(matches):
        raise DataError(f'{kind}-{scope}: historical aliases now describe distinct records')
    unmatched = {key for key in entries if key not in matches}
    for key, (_, anchor) in entries.items():
        if key in matches:
            continue
        candidates = [row for row in ledger if row['anchor'] == anchor and row['status'] == 'active' and row['id'] not in claimed]
        peers = [k for k, (_, a) in entries.items() if a == anchor and k in unmatched]
        if len(candidates) == 1 and len(peers) == 1:
            row = candidates[0]
            row['fingerprints'].append(key)
            matches[key] = row
            claimed.add(row['id'])
    number = max((int(row['id'].rsplit('-', 1)[1]) for row in ledger), default=0)
    for key in entries:
        if key not in matches:
            number += 1
            row = {'id': f'{kind}-{scope}-{number:04d}', 'fingerprints': [key], 'anchor': entries[key][1], 'status': 'active'}
            ledger.append(row)
            matches[key] = row
    current = {row['id'] for row in matches.values()}
    for row in ledger:
        row['status'] = 'active' if row['id'] in current else 'retired'
    text = docmd.front_matter({'type': kind, 'scope': scope, 'version': 1, 'allocated': len(ledger)})
    text += f'# {kind} identifier ledger\n\nGenerated allocation history. Keep retired rows; restore this file from Git if lost.\n\n'
    text += docmd.table(['ID', 'Fingerprints', 'Anchor', 'Status'], [[r['id'], ','.join(r['fingerprints']), r['anchor'], r['status']] for r in ledger])
    return [{**payload, 'id': matches[key]['id']} for key, (payload, _) in entries.items()], text
