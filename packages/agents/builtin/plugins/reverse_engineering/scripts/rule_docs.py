"""Business-rule documents: one small Markdown file per rule and the index that lists them.

An index (`rules.md` of a unit, `BUSINESS_RULES.md` of an application) is a table: id, name,
category, priority, confidence, version, status, source and a link to the rule's own file. Each
rule file (`rules/<id>.md`) holds the specification, parameters, evidence, edge cases, open
questions, acceptance scenarios and the version history of that one rule.

Versions are per rule and follow the content: a rerun that extracts the same rule keeps its
version, a changed rule gets the next one with a history row, a rule that is no longer extracted
is kept as a `retired` file (a tombstone) and moves to the index's retired table. Standard library only.
"""
import hashlib
import json
import re

import docmd
import render_rules as rr

RULE_ID = re.compile(r'^RULE-[A-Za-z0-9][A-Za-z0-9._-]*$')
INDEX_HEADERS = ['ID', 'Name', 'Category', 'Priority', 'Confidence', 'Version', 'Status', 'Source', 'Rule file']
HISTORY_HEADERS = ['Version', 'Date', 'Change', 'Commit']
RETIRED_HEADERS = ['ID', 'Name', 'Last version', 'Retired', 'Rule file']
GENERATED_BY = 'split_rules.py'


def file_name(rule_id):
    return f'{rule_id}.md'


def rule_digest(rule):
    """A short fingerprint of what the rule says (everything but its id), so a rerun can tell "same" from "changed"."""
    body = {key: value for key, value in rule.items() if key != 'id'}
    return hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=True, default=str).encode('utf-8')).hexdigest()[:12]


def status_of(rule, retired=False):
    if retired:
        return 'retired'
    return 'confirmed' if rr.one_line(rule.get('confidence'), 10) == 'High' else 'needs-sme'


def _texts(value, limit=200):
    return [rr.one_line(item, limit) for item in (value if isinstance(value, list) else []) if isinstance(item, str) and item.strip()]


def _dict_rows(value):
    return [item for item in (value if isinstance(value, list) else []) if isinstance(item, dict)]


def _parameters(rule):
    value = rule.get('parameters')
    rows = _dict_rows(value)
    if rows:
        body = docmd.table(['Name', 'Value', 'Where defined', 'Configurable'],
                           [[rr.one_line(r.get('name'), 80), rr.one_line(r.get('value'), 120), rr.one_line(r.get('where'), 160), rr.one_line(r.get('configurable'), 40)] for r in rows])
        return body
    if isinstance(value, str) and value.strip():
        return rr.block(value) + '\n'
    return ''


def _decision_table(rule):
    value = rule.get('decisionTable')
    if not isinstance(value, dict):
        return ''
    headers = _texts(value.get('headers'), 60)
    rows = [[rr.one_line(cell, 160) for cell in row] for row in (value.get('rows') or []) if isinstance(row, list)]
    if not headers or not rows:
        return ''
    return docmd.table(headers, [[*row, *([''] * (len(headers) - len(row)))][:len(headers)] for row in rows])


def _flow(rule):
    flow = rule.get('flow')
    if not isinstance(flow, str) or not flow.strip() or '```' in flow or '~~~' in flow:
        return ''
    return '```mermaid\n' + '\n'.join(line.rstrip() for line in flow.strip().splitlines()) + '\n```\n'


def _inputs_outputs(rule):
    labels = [('Inputs', 'inputs'), ('Reads', 'reads'), ('Writes', 'writes'), ('Success output', 'outputs'), ('Error output', 'errors')]
    rows = [[label, '; '.join(_texts(rule.get(key)))] for label, key in labels if _texts(rule.get(key))]
    return docmd.table(['Kind', 'Detail'], rows) if rows else ''


def _evidence(rule):
    source, also = rr.split_citation(rule.get('source'))
    rows = [[f'`{source.replace(chr(39), "")}`' if source else '', 'Primary citation of the rule']] if source else []
    for item in _dict_rows(rule.get('evidence')):
        place = rr.one_line(item.get('file'), 160) + (f":{rr.one_line(item.get('lines'), 20)}" if item.get('lines') else '')
        rows.append([f'`{place.replace(chr(39), "")}`' if place else '', rr.one_line(item.get('shows'), 200)])
    for cited in _texts(rule.get('alsoCited'), 160):
        rows.append([f'`{cited.replace(chr(39), "")}`', 'Also cited'])
    if also:
        rows.append([f'`{also.replace(chr(39), "")}`' if re.fullmatch(r'[^\s`]+', also) else also, 'Also cited'])
    return docmd.table(['Source', 'What it shows'], rows) if rows else ''


def _edge_cases(rule):
    cases = rule.get('edgeCases') or []
    rows = _dict_rows(cases)
    if rows:
        return docmd.table(['Case', 'Behaviour', 'Evidence'], [[rr.one_line(r.get('case'), 160), rr.one_line(r.get('behaviour'), 240), rr.one_line(r.get('evidence'), 160)] for r in rows])
    return ''.join(f'- {text}\n' for text in _texts(cases, 240))


def _acceptance(rule):
    rows = _dict_rows(rule.get('acceptance'))
    if not rows:
        return ''
    return docmd.table(['#', 'Given', 'When', 'Then'], [[index + 1, rr.one_line(r.get('given'), 200), rr.one_line(r.get('when'), 200), rr.one_line(r.get('then'), 200)] for index, r in enumerate(rows)])


def render_rule_file(app, item_id, rule, version, history, status=None, digest=None, commit=''):
    """The Markdown file of one rule. `rule` carries its stable `id`; `history` is [[version, date, change, commit], ...]."""
    rule_id = rule['id']
    source, _ = rr.split_citation(rule.get('source'))
    name = rr.one_line(rule.get('name'), 120)
    front = {
        'id': rule_id, 'name': name, 'app': app, **({'item': item_id} if item_id else {}),
        'category': rr.one_line(rule.get('category'), 20), 'priority': rr.one_line(rule.get('priority'), 4), 'confidence': rr.one_line(rule.get('confidence'), 10),
        'status': status or status_of(rule), 'version': version, 'digest': digest or rule_digest(rule), 'sourceCommit': commit or '',
        'source': [source.replace(chr(39), '')] if source else [],
        'dataObjects': _texts(rule.get('dataObjects'), 80), 'config': _texts(rule.get('config'), 120), 'tags': _texts(rule.get('tags'), 40),
        'generatedBy': GENERATED_BY,
    }
    doc = [docmd.front_matter(front), f'# {rule_id}: {name}', '', '## Summary', '', rr.one_line(rule.get('plainEnglish'), 400), '', '## Specification', '', '```text',
           f"Given {rr.block(rule.get('given'))}", f"When  {rr.block(rule.get('when'))}", f"Then  {rr.block(rule.get('then'))}"]
    if rule.get('and'):
        doc.append(f"And   {rr.block(rule['and'])}")
    doc += ['```', '']
    for title, text in (('Decision table', _decision_table(rule)), ('Flow', _flow(rule)), ('Parameters', _parameters(rule)), ('Inputs and outputs', _inputs_outputs(rule)),
                        ('Evidence', _evidence(rule)), ('Edge cases', _edge_cases(rule))):
        if text:
            doc += [f'## {title}', '', text.rstrip('\n'), '']
    if rule.get('suspectedDefect'):
        doc += ['## Suspected defects', '', rr.block(rule['suspectedDefect']), '']
    question = rule.get('smeQuestion')
    doc += ['## Open questions', '', rr.one_line(question, 400) if question and rr.one_line(rule.get('confidence'), 10) != 'High' else 'None.', '']
    acceptance = _acceptance(rule)
    if acceptance:
        doc += ['## Acceptance scenarios', '', acceptance.rstrip('\n'), '']
    doc += ['## Version history', '', docmd.table(HISTORY_HEADERS, history).rstrip('\n'), '']
    return '\n'.join(doc).rstrip() + '\n'


def read_rule_file(text):
    """What a later run needs from an existing rule file: version, digest, status, history rows, or None when it is not one."""
    if not text:
        return None
    front, body = docmd.split_front_matter(text)
    if not front.get('id'):
        return None
    sections = dict(docmd.sections(body, 2))
    history = [[row.get('version', ''), row.get('date', ''), row.get('change', ''), row.get('commit', '')] for row in docmd.records_in(sections.get('Version history', ''))]
    return {'id': front['id'], 'name': front.get('name', ''), 'version': docmd.as_int(front.get('version'), 1), 'digest': front.get('digest', ''), 'status': front.get('status', 'confirmed'), 'history': history, 'text': text}


def next_version(prior, rule, date, commit):
    """(version, history, changed) of a rule this run extracted, given its existing file (or None)."""
    digest = rule_digest(rule)
    if prior is None:
        return 1, [[1, date, 'Rule extracted', commit]], True
    if prior['digest'] == digest and prior['status'] != 'retired':
        return prior['version'], prior['history'], False
    version = prior['version'] + 1
    change = 'Rule extracted again after being retired' if prior['status'] == 'retired' else 'Rule changed'
    return version, [*prior['history'], [version, date, change, commit]], True


def retire(prior, date, commit):
    """The text of a rule file whose rule is no longer extracted: same file, status `retired`, next version, one more history row."""
    front, body = docmd.split_front_matter(prior['text'])
    version = prior['version'] + 1
    front.update({'status': 'retired', 'version': version, 'sourceCommit': commit or front.get('sourceCommit', '')})
    history = [*prior['history'], [version, date, 'Rule retired: no longer extracted from the source', commit]]
    head = body.split('\n## Version history')[0].rstrip('\n')
    lines = head.split('\n')
    note = f'> Retired {date}: the rule is no longer extracted from the source. This file is kept for history.'
    if lines and lines[0].startswith('# ') and note not in head:
        head = '\n'.join([lines[0], '', note, *lines[1:]])
    return docmd.front_matter(front) + head + '\n\n## Version history\n\n' + docmd.table(HISTORY_HEADERS, history) .rstrip('\n') + '\n'


def index_row(rule_id, name, category, priority, confidence, version, status, source, link, item=None):
    row = [rule_id, *([item] if item is not None else []), rr.one_line(name, 80), rr.one_line(category, 20), rr.one_line(priority, 4), rr.one_line(confidence, 10), version, status,
           f'`{rr.one_line(source, 80).replace(chr(39), "")}`' if source else '', f'[{rule_id}]({link})']
    return row


def index_headers(with_item=False):
    return [INDEX_HEADERS[0], *(['Item'] if with_item else []), *INDEX_HEADERS[1:]]


def render_unit_index(app, item_id, entries, retired, catalog_version):
    """The unit's rules.md: front matter, the table of its rules (each linking its file under rules/) and the retired ones.
    `entries` are dicts {rule, version}; `retired` rows are [id, name, last version, date]."""
    ordered = sorted(entries, key=lambda e: (rr.CATEGORIES.index(e['rule']['category']) if e['rule'].get('category') in rr.CATEGORIES else 9, str(e['rule'].get('name')), str(e['rule'].get('source'))))
    rows = [index_row(e['rule']['id'], e['rule'].get('name'), e['rule'].get('category'), e['rule'].get('priority'), e['rule'].get('confidence'), e['version'], status_of(e['rule']),
                      rr.split_citation(e['rule'].get('source'))[0], f"rules/{file_name(e['rule']['id'])}") for e in ordered]
    doc = [docmd.front_matter({'app': app, 'item': item_id, 'generatedBy': GENERATED_BY, 'catalogVersion': catalog_version, 'rules': len(ordered), 'p0': sum(1 for e in ordered if e['rule'].get('priority') == 'P0')}),
           f'# Business rules - {rr.one_line(item_id, 100)}', '',
           'Each row links to the rule\'s own file, which holds the specification, evidence and version history.', '', docmd.table(INDEX_HEADERS, rows).rstrip('\n'), '']
    if not ordered:
        doc += [rr.NO_RULES_MARKER, '']
    if retired:
        doc += ['## Retired rules', '', docmd.table(RETIRED_HEADERS, [[rid, rr.one_line(name, 80), version, date, f'[{rid}](rules/{file_name(rid)})'] for rid, name, version, date in retired]).rstrip('\n'), '']
    return '\n'.join(doc).rstrip() + '\n'


def unit_index_state(text):
    """(catalogVersion, retired rows [id, name, last version, date]) of an existing unit index."""
    if not text:
        return 0, []
    front, body = docmd.split_front_matter(text)
    retired_text = dict(docmd.sections(body, 2)).get('Retired rules', '')
    retired = [[row.get('id', ''), row.get('name', ''), docmd.as_int(row.get('last version'), 1), row.get('retired', '')] for row in docmd.records_in(retired_text) if row.get('id')]
    return docmd.as_int(front.get('catalogVersion')), retired


def link_target(cell):
    """The target of a Markdown link cell `[text](target)`, '' when the cell is no link."""
    match = re.match(r'^\[[^\]]*\]\(([^)\s]+)\)$', cell.strip())
    return match.group(1) if match else ''
