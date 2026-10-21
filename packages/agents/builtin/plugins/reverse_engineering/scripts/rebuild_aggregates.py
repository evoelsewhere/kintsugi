#!/usr/bin/env python3
"""Rebuild the whole-application views of an application from its per-unit documents (ADR-0033, ADR-0042).

    python3 rebuild_aggregates.py <app> --docs DIR --out DIR

--docs is the document repository at the default branch tip (read-only): the catalog
applications/<app>/assessment/catalog/ and, per unit, the documents of
applications/<app>/units/<module>/<unit>/understanding/ (rules.md, data-objects.md, findings.md,
trace.md, understanding.md, as-is.md). --out is the document-repository root the views are written
under; they are never written by a run's pull request, only by this script (auto-committed):

- applications/<app>/generated/BUSINESS_RULES.md, DATA_OBJECTS.md - every unit's rules and data objects,
  under their item-namespaced ids (the units' cards, joined);
- applications/<app>/generated/SECURITY_FINDINGS.md - the scorecard and every unit's findings;
- applications/<app>/generated/traceability.md - the totals (front matter) and one row per understood unit;
- applications/<app>/generated/README.md - the index of the specifications.

Deterministic: the same inputs give the same files. Standard library only.
"""
import argparse
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import catalog_common as cc  # noqa: E402
import docmd  # noqa: E402
import paths  # noqa: E402
import render_rules as rr  # noqa: E402
import split_findings as sf  # noqa: E402

SEVERITIES = ('Critical', 'High', 'Medium', 'Low')
LISTED = ('Entry points', 'Rules applied', 'Findings', 'Data objects', 'External systems', 'Files', 'Requirements', 'Pull requests', 'Tests')


def unit_text(docs, path):
    return docmd.read_optional_text(os.path.join(docs, *path.split('/')))


def trace_of(text):
    """The sections of a unit's trace.md: bullet lists by title, the dependency table, the open questions."""
    front, body = docmd.split_front_matter(text or '')
    sections = dict(docmd.sections(body, 2))
    trace = {title: docmd.bullets_in(sections.get(title, '')) for title in LISTED}
    trace['Dependencies'] = docmd.records_in(sections.get('Dependencies', ''))
    trace['openQuestions'] = docmd.as_int(front.get('openQuestions'))
    return trace


def rebuild(app, docs):
    items, catalog = cc.load_catalog(os.path.join(docs, *paths.assessment_catalog_dir(app).split('/')))
    active = [item for item in items.values() if item.get('status') != 'retired']
    rule_rows, rule_cards, objects, finding_rows, rows = [], [], [], [], []
    for item in sorted(active, key=lambda entry: entry['id']):
        item_id = item['id']
        parts = item_id.split('/')
        rules_text = unit_text(docs, paths.unit_rules_path(app, *parts))
        if rules_text:
            for row in rr.unit_rule_rows(rules_text):
                rule_rows.append({**row, 'item': item_id})
            rule_cards += rr.unit_rule_cards(rules_text)
        objects_text = unit_text(docs, paths.unit_data_objects_path(app, *parts))
        if objects_text:
            objects += [(title, body) for title, body in docmd.sections(docmd.split_front_matter(objects_text)[1], 2)]
        findings_text = unit_text(docs, paths.unit_findings_path(app, *parts))
        if findings_text:
            finding_rows += [{**row, 'item': item_id} for row in sf.finding_rows(findings_text)]
        record_text = unit_text(docs, paths.unit_understanding_path(app, *parts))
        if record_text is None:
            continue
        record = docmd.split_front_matter(record_text)[0]
        trace = trace_of(unit_text(docs, paths.unit_trace_path(app, *parts)))
        deps = [row for row in trace['Dependencies'] if row.get('target')]
        outbound = sorted({row['target'] for row in deps if row['target'] in items and row.get('direction') != 'inbound'})
        stores = sorted({row['target'] for row in deps if row['target'].startswith('ds:')})
        rows.append({
            'item': item_id, 'title': cc.clean_text(item.get('name'), cc.MAX_NAME) or item_id, 'kind': item.get('kind') or 'module',
            'spec': paths.unit_key_as_is_path(app, item_id), 'files': trace['Files'] or item['files'], 'dependsOn': outbound, 'dataStores': stores,
            'rules': trace['Rules applied'], 'findings': trace['Findings'], 'entryPoint': bool(item.get('entryPoints')),
            'requirements': trace['Requirements'], 'openQuestions': trace['openQuestions'], 'stale': record.get('digest') != item.get('digest'),
        })
    return active, rule_rows, rule_cards, objects, finding_rows, rows


def business_rules(app, rule_rows, rule_cards):
    doc = [f'# Business Rules - {rr.one_line(app, 80)}', '',
           f'Generated from the rules of {len({row["item"] for row in rule_rows})} understood item(s) ({paths.units_dir(app)}/*/*/understanding/rules.md); do not edit by hand.', '',
           '| ID | Item | Name | Category | Priority | Source | Confidence |', '|---|---|---|---|---|---|---|']
    for row in rule_rows:
        doc.append(f"| {row.get('id', '')} | {row['item']} | {rr.one_line(row.get('name'), 80)} | {rr.one_line(row.get('category'), 20)} | {rr.one_line(row.get('priority'), 4)} | {row.get('source', '')} | {rr.one_line(row.get('confidence'), 10)} |")
    doc.append('')
    if not rule_cards:
        doc += [rr.NO_RULES_MARKER, '']
    for _, card in rule_cards:
        doc += [card, '']
    return '\n'.join(doc).rstrip() + '\n'


def data_objects(app, objects):
    doc = [f'# Data Objects - {rr.one_line(app, 80)}', '']
    if not objects:
        doc.append('No data objects were cataloged.')
    for title, body in sorted(objects, key=lambda entry: entry[0]):
        doc += [f'## {title}', body, '']
    return '\n'.join(doc).rstrip() + '\n'


def security_findings(app, finding_rows):
    counts = {severity: sum(1 for row in finding_rows if row.get('severity') == severity) for severity in SEVERITIES}
    doc = [f'# Security findings - {rr.one_line(app, 80)}', '', f'Generated from the findings of the understood units ({paths.units_dir(app)}/*/*/understanding/findings.md); do not edit by hand.', '',
           '## Scorecard', '', '| Severity | Count |', '|---|---|']
    doc += [f'| {severity} | {count} |' for severity, count in counts.items()]
    doc += [f'| **Total** | **{len(finding_rows)}** |', '', '## Findings by severity', '']
    if finding_rows:
        doc += ['| ID | CWE | Severity | Confidence | Location | Title | Exploit scenario |', '|---|---|---|---|---|---|---|']
        order = sorted(finding_rows, key=lambda row: (SEVERITIES.index(row['severity']) if row.get('severity') in SEVERITIES else 9, row.get('id', '')))
        doc += [f"| {row.get('id', '')} | {row.get('cwe', '')} | {row.get('severity', '')} | {row.get('confidence', '')} | {row.get('location', '')} | {row.get('title', '')} | {row.get('exploit scenario', '')} |" for row in order]
    else:
        doc.append('No confirmed findings in the understood items.')
    return '\n'.join(doc).rstrip() + '\n'


def traceability_md(app, rows, active, rule_rows, finding_rows):
    distinct = lambda key: len({value for row in rows for value in row[key]})  # noqa: E731
    front = docmd.front_matter({
        'app': app,
        'generatedBy': 'rebuild_aggregates.py',
        'items': len(active),
        'units': len(rows),
        'modules': len({row['item'].split('/')[0] for row in rows}),
        'specified': len(rows),
        'notWritten': 0,
        'entryPoints': sum(1 for row in rows if row['entryPoint']),
        'rulesCovered': distinct('rules'),
        'findingsMapped': distinct('findings'),
        'files': distinct('files'),
        'dataStores': distinct('dataStores'),
        'requirements': distinct('requirements'),
        'openQuestions': sum(row['openQuestions'] for row in rows),
        'stale': sum(1 for row in rows if row['stale']),
        'businessRules': bool(rule_rows),
        'securityFindings': bool(finding_rows),
    })
    doc = [front, f'# Traceability - {app}', '', f'{len(rows)} of {len(active)} catalog item(s) understood. Generated by rebuild_aggregates.py.', '',
           '| Item | Kind | Files | Depends on | Rules | Findings | State |', '|---|---|---|---|---|---|---|']
    for row in rows:
        doc.append(f"| [{row['title']}]({os.path.relpath(row['spec'], paths.generated_dir(app)).replace(os.sep, '/')}) `{row['item']}` | {row['kind']} | {len(row['files'])} | "
                   f"{', '.join(dep.split('/', 1)[1] for dep in row['dependsOn']) or '-'} | {len(row['rules'])} | {len(row['findings'])} | {'stale' if row['stale'] else 'understood'} |")
    return '\n'.join(doc).rstrip() + '\n'


def readme(app, active, rows):
    understood = {row['item']: row for row in rows}
    doc = [f'# {app} - AS-IS knowledge', '', f'{len(understood)} of {len(active)} catalog item(s) have an AS-IS specification. Generated by rebuild_aggregates.py.', '']
    module = None
    for item in sorted(active, key=lambda entry: (entry.get('module') or '', entry['id'])):
        if item.get('module') != module:
            module = item.get('module')
            doc += ['', f'## {module}', '', '| Item | Kind | Specification |', '|---|---|---|']
        row = understood.get(item['id'])
        doc.append(f"| {cc.clean_text(item.get('name'), cc.MAX_NAME) or item['id']} `{item['id']}` | {item.get('kind') or 'module'} | "
                   + (f"[{item['id']}](../units/{item['id']}/understanding/as-is.md)" if row else 'not understood yet') + ' |')
    return '\n'.join(doc).rstrip() + '\n'


def main(argv):
    ap = argparse.ArgumentParser(description='Rebuild the whole-application views of an application from its per-unit documents.')
    ap.add_argument('app')
    ap.add_argument('--docs', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args(argv[1:])
    try:
        if not cc.APP_RE.match(args.app):
            raise cc.DataError('the application id must be kebab-case')
        docs = os.path.realpath(args.docs)
        active, rule_rows, rule_cards, objects, finding_rows, rows = rebuild(args.app, docs)
        root = os.path.abspath(args.out)
        gen = os.path.join(root, *paths.generated_dir(args.app).split('/'))
        texts = {
            'BUSINESS_RULES.md': business_rules(args.app, rule_rows, rule_cards),
            'DATA_OBJECTS.md': data_objects(args.app, objects),
            'SECURITY_FINDINGS.md': security_findings(args.app, finding_rows),
            'traceability.md': traceability_md(args.app, rows, active, rule_rows, finding_rows),
            'README.md': readme(args.app, active, rows),
        }
        for name, text in texts.items():
            docmd.write_text(os.path.join(gen, name), text)
    except (cc.DataError, rr.DataError, OSError, RecursionError) as error:
        print(f'rebuild_aggregates.py: {error}', file=sys.stderr)
        return 1
    print(f'{len(rows)} of {len(active)} item(s) understood; {len(rule_cards)} rule(s), {len(finding_rows)} finding(s)')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
