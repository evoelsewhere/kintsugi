#!/usr/bin/env python3
"""Render the extract-rules workflow's result into BUSINESS_RULES.md, one file per rule, and DATA_OBJECTS.md.

    python3 render_rules.py <app> --out DIR --assessment DIR [--date YYYY-MM-DD] [--sources SPEC]

Reads rules_result.json (the object the workflow returned, saved by the orchestrator: --result,
else <assessment>/rules_result.json, where --assessment is the folder holding it: the document
repository's 10-applications/<app>/01-legacy/understand/ folder) and writes BUSINESS_RULES.md and
DATA_OBJECTS.md to --out (the step's
output folder; a member may give the application's _generated/ folder itself). BUSINESS_RULES.md is
the index: a table of the rules with their version and a link to each rule's own file
(rules/RULE-NNN.md, see rule_docs.py), then the lists that belong to the whole run (SME questions,
instruction-shaped content, folded rules, coverage gaps). Rules are numbered RULE-001, RULE-002, ...
in the order they appear (by category, then priority). Every value comes from analysis of
untrusted code, so it is written as plain text on one line where it is a heading or a table cell.
Standard library only.
"""
import argparse
import json
import os
import re
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import docmd  # noqa: E402
import paths  # noqa: E402

MAX_RESULT_BYTES = 5_000_000
MAX_RECORDS = 10_000


class DataError(ValueError):
    """Invalid or unsafe workflow result."""


# Written when no rule was confirmed; hooks/job_output.py accepts a rules index without rows only with this line.
NO_RULES_MARKER = '_No business rules were confirmed in this run._'


def within(root, path):
    root = os.path.realpath(root)
    real = os.path.realpath(path)
    try:
        return os.path.commonpath((root, real)) == root
    except ValueError:
        return False


CATEGORIES = ['Calculation', 'Validation', 'Lifecycle', 'Policy']
PRIORITY = {'P0': 0, 'P1': 1, 'P2': 2}


def one_line(value, limit=300):
    text = ' '.join(str(value if value is not None else '').split())
    text = text.replace('|', '/').replace('`', "'")
    return text if len(text) <= limit else text[: limit - 1].rstrip() + '…'


CITATION = re.compile(r'^\s*`?([^\s`:,;()]+):(\d+)(?:\s*[-\u2013]\s*(\d+))?')


def split_citation(value):
    """One citation per rule: the first path:line[-line] in the text is it, and whatever follows
    (a second file, a note) comes back separately so later tools can rely on the citation alone."""
    text = ' '.join(str(value if value is not None else '').split())
    m = CITATION.match(text)
    if not m:
        return one_line(text, 200), ''
    primary = f'{m.group(1)}:{m.group(2)}' + (f'-{m.group(3)}' if m.group(3) else '')
    rest = re.sub(r'\s*;\s*also\s+', '; ', text[m.end():], flags=re.I)       # citations a consolidation appended
    rest = re.sub(r'^[\s;,.\-\u2013\u2014`]*(?:also\s+)?', '', rest, flags=re.I)
    return one_line(primary, 200), one_line(rest.strip(' \t;,.-\u2013\u2014`'), 300)


def block(value):
    """Multi-line text: keep the lines, but never let a value open a heading or a fence."""
    lines = []
    for raw in str(value if value is not None else '').splitlines():
        line = raw.rstrip()
        if line.lstrip().startswith(('#', '```', '~~~')):
            line = '\\' + line.lstrip()
        lines.append(line)
    return '\n'.join(lines).strip()


def validate_result(result):
    if not isinstance(result, dict):
        raise DataError('rules_result.json must contain a JSON object')
    list_fields = ('confirmedRules', 'rejectedRules', 'unverifiedRules', 'foldedRules', 'dataObjects', 'injectionFlags', 'rerunModules')
    for field in list_fields:
        value = result.get(field, [])
        if value is not None and not isinstance(value, list):
            raise DataError(f'rules_result.json field {field} must be an array')
        if len(value or []) > MAX_RECORDS:
            raise DataError(f'rules_result.json field {field} exceeds the {MAX_RECORDS}-entry limit')
    for field in ('confirmedRules', 'rejectedRules', 'unverifiedRules', 'dataObjects'):
        if any(not isinstance(item, dict) for item in (result.get(field) or [])):
            raise DataError(f'rules_result.json field {field} must contain objects')
    for rule in result.get('confirmedRules') or []:
        for field in ('category', 'priority', 'source'):
            if rule.get(field) is not None and not isinstance(rule[field], str):
                raise DataError(f'confirmed rule field {field} must be a string')
        for field in ('edgeCases', 'alsoCited', 'inputs', 'reads', 'writes', 'outputs', 'errors', 'dataObjects', 'config', 'tags', 'evidence', 'acceptance'):
            if rule.get(field) is not None and not isinstance(rule[field], list):
                raise DataError(f'confirmed rule field {field} must be an array')
        for field in ('alsoCited', 'inputs', 'reads', 'writes', 'outputs', 'errors', 'dataObjects', 'config', 'tags'):
            if any(not isinstance(item, str) for item in (rule.get(field) or [])):
                raise DataError(f'confirmed rule field {field} must contain strings')
        for field in ('evidence', 'acceptance'):
            if any(not isinstance(item, dict) for item in (rule.get(field) or [])):
                raise DataError(f'confirmed rule field {field} must contain objects')
        if any(not isinstance(item, (str, dict)) for item in (rule.get('edgeCases') or [])):
            raise DataError('confirmed rule field edgeCases must contain strings or objects')
        if rule.get('parameters') is not None and not isinstance(rule['parameters'], (str, list)):
            raise DataError('confirmed rule field parameters must be a string or an array')
        if any(not isinstance(item, dict) for item in (rule['parameters'] if isinstance(rule.get('parameters'), list) else [])):
            raise DataError('confirmed rule field parameters must contain objects')
        if rule.get('decisionTable') is not None and not (isinstance(rule['decisionTable'], dict) and isinstance(rule['decisionTable'].get('headers', []), list) and isinstance(rule['decisionTable'].get('rows', []), list)):
            raise DataError('confirmed rule field decisionTable must be {headers, rows}')
        if rule.get('flow') is not None and not isinstance(rule['flow'], str):
            raise DataError('confirmed rule field flow must be a string')
    if any(not isinstance(item, str) for item in (result.get('injectionFlags') or [])):
        raise DataError('rules_result.json field injectionFlags must contain strings')
    # The extract-rules workflow returns the gap list ready to be passed back as `modules`: entries
    # {name, domain?, files, loc?}. A bare module name is accepted too.
    for item in result.get('rerunModules') or []:
        if isinstance(item, str):
            continue
        if not isinstance(item, dict) or not isinstance(item.get('name'), str):
            raise DataError('rules_result.json field rerunModules must contain module names or {name, files} entries')
        if item.get('files') is not None and (not isinstance(item['files'], list) or any(not isinstance(path, str) for path in item['files'])):
            raise DataError('rules_result.json field rerunModules entry files must be an array of strings')
    for obj in result.get('dataObjects') or []:
        if obj.get('fields') is not None and not isinstance(obj['fields'], list):
            raise DataError('data object fields must be an array')
        if any(not isinstance(field, dict) for field in (obj.get('fields') or [])):
            raise DataError('data object fields must contain objects')
        if obj.get('consumedBy') is not None and not isinstance(obj['consumedBy'], list):
            raise DataError('data object consumedBy must be an array')
        if any(not isinstance(item, str) for item in (obj.get('consumedBy') or [])):
            raise DataError('data object consumedBy must contain strings')
    stats = result.get('stats', {})
    if not isinstance(stats, dict):
        raise DataError('rules_result.json field stats must be an object')
    for field in ('skippedModules', 'failedModules', 'droppedModules', 'skippedPhases'):
        if stats.get(field) is not None and not isinstance(stats[field], list):
            raise DataError(f'stats.{field} must be an array')
    return result


def render_unit_data_objects(app, item_id, objects):
    """The data-objects.md of one unit: front matter and one section per object, as DATA_OBJECTS.md has them."""
    doc = [docmd.front_matter({'app': app, 'item': item_id, 'generatedBy': 'split_rules.py', 'dataObjects': len(objects)}), f'# Data objects - {one_line(item_id, 100)}', '']
    if not objects:
        doc.append('No data objects were cataloged.')
    for obj in sorted(objects, key=lambda o: str(o.get('name'))):
        doc += [f"## {one_line(obj.get('name'), 100)}", f"Source: `{one_line(obj.get('source'), 160).replace(chr(39), '')}`", '', '| Field | Type | Note |', '|---|---|---|']
        for field in obj.get('fields') or []:
            if isinstance(field, dict):
                doc.append(f"| {one_line(field.get('name'), 80)} | {one_line(field.get('type'), 60)} | {one_line(field.get('note'), 160)} |")
        used = obj.get('consumedBy') or []
        if used:
            doc += ['', 'Used by: ' + ', '.join(one_line(u, 80) for u in used)]
        doc.append('')
    return '\n'.join(doc).rstrip() + '\n'


def unit_rule_rows(text):
    """The rows of the rules table of a unit's rules.md as dicts keyed by the lower-cased header."""
    return docmd.records_in(docmd.split_front_matter(text)[1])


def write_text(root, name, text):
    if os.path.islink(root):
        raise DataError(f'refusing to write through a symbolic link: {root}')
    os.makedirs(root, exist_ok=True)
    real_root = os.path.realpath(root)
    path = os.path.join(real_root, name)
    temporary = path + '.tmp'
    if not within(real_root, path) or os.path.islink(path) or os.path.islink(temporary):
        raise DataError(f'refusing to write outside --out or through a symbolic link: {path}')
    with open(temporary, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write(text)
    os.replace(temporary, path)


def main(argv):
    ap = argparse.ArgumentParser(description="Render the extract-rules workflow's result into BUSINESS_RULES.md, one file per rule, and DATA_OBJECTS.md.")
    ap.add_argument('app', help='the application id from kintsugi.yaml (used in the headings)')
    ap.add_argument('--assessment', required=True, help='the 10-applications/<app>/01-legacy/understand/ folder of the document repository (rules_result.json is read from it)')
    ap.add_argument('--out', required=True, help='the folder BUSINESS_RULES.md, rules/ and DATA_OBJECTS.md are written to')
    ap.add_argument('--date', default='', help='the date written in the version history (default: today, UTC)')
    ap.add_argument('--sources', default='', help='the legacy repositories and their commits (`id@commit,id@commit`), written in the version history')
    args = ap.parse_args(argv[1:])
    if not args.assessment.strip() or not args.out.strip():
        print('render_rules.py: --assessment and --out must be non-empty explicit paths', file=sys.stderr)
        return 1
    try:
        revision = paths.sources_spec(paths.parse_sources(args.sources)) if args.sources else ''
    except ValueError as error:
        print(f'render_rules.py: --sources: {error}', file=sys.stderr)
        return 1
    system = args.app
    assessment = os.path.realpath(os.path.expanduser(args.assessment))
    result_path = os.path.join(assessment, 'rules_result.json')
    base = os.path.abspath(os.path.expanduser(args.out))
    try:
        if not os.path.isdir(assessment):
            raise DataError(f'not an assessment directory: {args.assessment}')
        if not within(assessment, result_path):
            raise DataError('rules_result.json escapes the assessment directory')
        if os.path.getsize(result_path) > MAX_RESULT_BYTES:
            raise DataError(f'rules_result.json exceeds the {MAX_RESULT_BYTES}-byte limit')
        with open(result_path, 'rb') as handle:
            raw = handle.read(MAX_RESULT_BYTES + 1)
        if len(raw) > MAX_RESULT_BYTES:
            raise DataError(f'rules_result.json exceeds the {MAX_RESULT_BYTES}-byte limit')
        try:
            result = validate_result(json.loads(raw.decode('utf-8-sig')))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise DataError(f'rules_result.json is not valid UTF-8 JSON: {error}') from error
        if os.path.islink(base):
            raise DataError(f'refusing to write through a symbolic link: {base}')
    except (DataError, OSError, RecursionError) as error:
        print(f'render_rules.py: {error}', file=sys.stderr)
        return 1

    # Numbered in the order they appear in the document (by category, then priority), so RULE-001.. read in sequence.
    rules = sorted(result.get('confirmedRules') or [],
                   key=lambda r: (CATEGORIES.index(r['category']) if r.get('category') in CATEGORIES else 9,
                                  PRIORITY.get(r.get('priority'), 1),
                                  str(r.get('source'))))
    import datetime
    import rule_docs  # noqa: E402 - imports this module, so it is loaded here
    date = args.date or datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')
    numbered = [(i + 1, {**r, 'id': f'RULE-{i + 1:03d}'}) for i, r in enumerate(rules)]
    stats = result.get('stats') or {}
    rule_files = {}
    rows = []
    for _, r in numbered:
        history = [[1, date, 'Rule extracted', revision]]
        rule_files[f"rules/{rule_docs.file_name(r['id'])}"] = rule_docs.render_rule_file(system, None, r, 1, history, commit=revision)
        rows.append(rule_docs.index_row(r['id'], r.get('name'), r.get('category'), r.get('priority'), r.get('confidence'), 1, rule_docs.status_of(r), split_citation(r.get('source'))[0], f"rules/{rule_docs.file_name(r['id'])}"))

    doc = [docmd.front_matter({'app': system, 'generatedBy': 'render_rules.py', 'catalogVersion': 1, 'rules': len(rules), 'p0': sum(1 for r in rules if r.get('priority') == 'P0')}),
           f'# Business Rules — {one_line(system, 80)}', '',
           f"At extraction: {len(rules)} confirmed rules ({sum(1 for r in rules if r.get('priority') == 'P0')} P0); "
           f"later steps may add or correct rules in their files. "
           f"Each citation was checked by a second agent that read the cited lines; "
           f"{len(result.get('rejectedRules') or [])} candidate rules were refuted and left out. "
           f"Each row links to the rule's own file, which holds the specification, evidence and version history.", '',
           docmd.table(rule_docs.INDEX_HEADERS, rows).rstrip('\n'), '']
    if not numbered:
        # An empty catalog is a real outcome (a tiny or rule-free estate); say so in a line the JobOutput hook accepts.
        doc += [NO_RULES_MARKER, '']
    sme = [(n, r) for n, r in numbered if r.get('confidence') != 'High']
    doc += ['## Rules requiring SME confirmation', '']
    if sme:
        for n, r in sme:
            doc.append(f"- **RULE-{n:03d}** ({one_line(r.get('confidence'), 10)}): "
                       f"{one_line(r.get('smeQuestion') or 'Confirm this rule with someone who knows the system.', 400)}")
    else:
        doc.append('None: every confirmed rule has High confidence.')
    doc.append('')

    flags = result.get('injectionFlags') or []
    if flags:
        doc += ['## ⚠ Instruction-shaped content found in source', '',
                'These lines of the source tried to steer automated analysis. A person should look at them.', '']
        doc += [f'- {one_line(f, 300)}' for f in flags]
        doc.append('')

    folded = [f for f in (result.get('foldedRules') or []) if isinstance(f, dict)]
    if folded:
        doc += ['## Rules folded into another', '',
                'These rules described the same behavior as another rule in a different place, so they were merged into it '
                '(the kept rule lists their locations under "Also cited"):', '']
        doc += [f"- {one_line(f.get('name'), 100)} ({one_line(f.get('source'), 100)}) into {one_line(f.get('into'), 100)}" for f in folded[:100]]
        if len(folded) > 100:
            doc.append(f'- … and {len(folded) - 100} more')
        doc.append('')

    gaps = [('never attempted (token budget or agent cap)', stats.get('skippedModules')),
            ('extractor returned nothing', stats.get('failedModules')),
            ('malformed entries, fix by hand', stats.get('droppedModules')),
            ('phases cut short', stats.get('skippedPhases')),
            ('candidate rules no referee judged (not in the catalog)',
             [f"{one_line(u.get('name'), 80)} ({one_line(u.get('source'), 80)})" for u in (result.get('unverifiedRules') or [])])]
    gaps = [(label, items) for label, items in gaps if items]
    if gaps:
        doc += ['## Coverage gaps', '', 'These parts were NOT fully mined:', '']
        for label, items in gaps:
            doc.append(f"- **{len(items)} {label}:** " + ', '.join(one_line(i, 100) for i in items[:30]) + (' …' if len(items) > 30 else ''))
        if result.get('rerunModules'):
            doc.append(f"\nA follow-up run for the {len(result['rerunModules'])} affected shard(s) covers them.")
        doc.append('')

    business_rules = '\n'.join(doc).rstrip() + '\n'

    objects = result.get('dataObjects') or []
    dto = [f'# Data Objects — {one_line(system, 80)}', '']
    if not objects:
        dto.append('No data objects were cataloged.')
    for obj in objects:
        dto += [f"## {one_line(obj.get('name'), 100)}", f"Source: `{one_line(obj.get('source'), 160).replace(chr(39), '')}`", '',
                '| Field | Type | Note |', '|---|---|---|']
        for field in obj.get('fields') or []:
            dto.append(f"| {one_line(field.get('name'), 80)} | {one_line(field.get('type'), 60)} | {one_line(field.get('note'), 160)} |")
        used = obj.get('consumedBy') or []
        if used:
            dto += ['', 'Used by: ' + ', '.join(one_line(u, 80) for u in used)]
        dto.append('')
    try:
        for relative, text in rule_files.items():
            write_text(os.path.join(base, 'rules'), relative.split('/', 1)[1], text)
        write_text(base, 'BUSINESS_RULES.md', business_rules)
        write_text(base, 'DATA_OBJECTS.md', '\n'.join(dto).rstrip() + '\n')
    except (DataError, OSError) as error:
        print(f'render_rules.py: {error}', file=sys.stderr)
        return 1

    p0 = sum(1 for r in rules if r.get('priority') == 'P0')
    print(f"BUSINESS_RULES.md: {len(rules)} rules ({p0} P0, {len(sme)} need SME review); DATA_OBJECTS.md: {len(objects)} objects; "
          f"rejected {len(result.get('rejectedRules') or [])}, unverified {len(result.get('unverifiedRules') or [])}")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
