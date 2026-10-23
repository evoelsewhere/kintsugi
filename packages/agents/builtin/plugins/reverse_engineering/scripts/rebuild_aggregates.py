#!/usr/bin/env python3
"""Rebuild the whole-application views of an application from its per-unit documents (ADR-0033, ADR-0042).

    python3 rebuild_aggregates.py <app> --docs DIR --out DIR

--docs is the document repository at the default branch tip (read-only): the catalog
10-applications/<app>/01-legacy/_catalog/ and, per unit, the documents of
10-applications/<app>/01-legacy/<module>/<unit>/ (rules.md and its rules/<id>.md files,
data-objects.md, findings.md, trace.md, understanding.md, spec.md). --out is the document-repository root the views are written
under; they are never written by a run's pull request, only by this script (auto-committed):

- 10-applications/<app>/_generated/BUSINESS_RULES.md - the index of every unit's rules (one row per rule,
  under its item-namespaced id, with its version and a link to the rule's own file); DATA_OBJECTS.md -
  every unit's data objects;
- 10-applications/<app>/_generated/SECURITY_FINDINGS.md - the scorecard and every unit's findings;
- 10-applications/<app>/_generated/GAPS.md - the gaps of every understood unit's specification (its `Gaps and questions`
  table, ADR-0057), blocking ones first, with the totals by kind and impact in the front matter;
- 10-applications/<app>/_generated/DATA_ACCESS.md - which items read and write which data store, from the catalog's links
  (the read and write edges of the topology, ADR-0060), by data store and by item;
- 10-applications/<app>/_generated/traceability.md - the totals (front matter) and one row per understood unit;
- 10-applications/<app>/_generated/README.md - the index of the specifications.

Deterministic: the same inputs give the same files. Standard library only.
"""
import argparse
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import catalog_common as cc  # noqa: E402
import docmd  # noqa: E402
import gaps_common as gc  # noqa: E402
import paths  # noqa: E402
import render_rules as rr  # noqa: E402
import rule_docs as rd  # noqa: E402
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
    rule_rows, objects, finding_rows, rows, gap_rows = [], [], [], [], []
    for item in sorted(active, key=lambda entry: entry['id']):
        item_id = item['id']
        parts = item_id.split('/')
        rules_text = unit_text(docs, paths.unit_rules_path(app, *parts))
        if rules_text:
            for row in rr.unit_rule_rows(rules_text):
                if row.get('id') and row.get('status') != 'retired':
                    rule_rows.append({**row, 'item': item_id})
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
        spec_rows = gc.spec_gaps(unit_text(docs, paths.unit_key_as_is_path(app, item_id)) or '')[0]
        # A row whose kind or impact is not one of the lists cannot be classified: finish_items.py reported it, and it stays in the specification.
        gap_rows += [{**row, 'item': item_id} for row in spec_rows or [] if row['kind'] in gc.GAP_KINDS and row['impact'] in gc.GAP_IMPACTS]
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
    return active, rule_rows, objects, finding_rows, rows, gap_rows


def business_rules(app, rule_rows):
    """The application's rules index: the units' rows joined, each linking the rule's file in its unit."""
    ordered = sorted(rule_rows, key=lambda row: (row['item'], row.get('id', '')))
    rows = []
    for row in ordered:
        module, unit = row['item'].split('/')
        link = os.path.relpath(paths.unit_rule_file_path(app, module, unit, row.get('id', '')), paths.generated_dir(app)).replace(os.sep, '/')
        rows.append([row.get('id', ''), row['item'], row.get('name', ''), row.get('category', ''), row.get('priority', ''), row.get('confidence', ''), row.get('version', ''),
                     row.get('status', ''), row.get('source', ''), f"[{row.get('id', '')}]({link})"])
    doc = [docmd.front_matter({'app': app, 'generatedBy': 'rebuild_aggregates.py', 'rules': len(ordered), 'p0': sum(1 for row in ordered if row.get('priority') == 'P0'), 'units': len({row['item'] for row in ordered})}),
           f'# Business Rules - {rr.one_line(app, 80)}', '',
           f'Generated from the rules indexes of {len({row["item"] for row in ordered})} understood item(s) ({paths.legacy_dir(app)}/*/*/rules.md); do not edit by hand. '
           "Each row links to the rule's own file, which holds the specification, evidence and version history.", '',
           docmd.table(rd.index_headers(with_item=True), rows).rstrip('\n'), '']
    if not ordered:
        doc += [rr.NO_RULES_MARKER, '']
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
    doc = [f'# Security findings - {rr.one_line(app, 80)}', '', f'Generated from the findings of the understood units ({paths.legacy_dir(app)}/*/*/findings.md); do not edit by hand.', '',
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


def gaps_md(app, gap_rows):
    """The application's gaps: every understood unit's `Gaps and questions` rows, blocking first (ADR-0057)."""
    ordered = sorted(gap_rows, key=lambda row: (gc.GAP_IMPACTS.index(row['impact']) if row['impact'] in gc.GAP_IMPACTS else len(gc.GAP_IMPACTS), row['item'], row['id']))
    by_kind = {kind: sum(1 for row in ordered if row['kind'] == kind) for kind in gc.GAP_KINDS}
    by_impact = {impact: sum(1 for row in ordered if row['impact'] == impact) for impact in gc.GAP_IMPACTS}
    front = docmd.front_matter({'app': app, 'generatedBy': 'rebuild_aggregates.py', 'gaps': len(ordered), 'units': len({row['item'] for row in ordered}),
                                **{impact: count for impact, count in by_impact.items()}, 'missingSource': by_kind['missing-source'], 'unresolved': by_kind['unresolved'],
                                'ambiguous': by_kind['ambiguous'], 'unverified': by_kind['unverified']})
    doc = [front, f'# Gaps and questions - {rr.one_line(app, 80)}', '',
           f'Generated from the `Gaps and questions` tables of the understood units ({paths.legacy_dir(app)}/*/*/spec.md); do not edit by hand. '
           "An answer is written in the unit's specification, in the pull request that carries it.", '']
    if ordered:
        table = docmd.table(['Item', 'ID', 'Kind', 'Impact', 'Question', 'Where'], [[row['item'], row['id'], row['kind'], row['impact'], row.get('question', ''), row.get('where', '')] for row in ordered])
        doc.append(table.rstrip('\n'))
    else:
        doc.append('No gaps were recorded in the understood items.')
    return '\n'.join(doc).rstrip() + '\n'


def data_access_md(app, active):
    """Which items read and write which data store, from the catalog's `dataStores` links (the topology's read and write edges).
    Every active item counts, understood or not. The edges say read or write, not create, update or delete, so this is the
    read/write matrix, by data store and by item (ADR-0060)."""
    by_store, by_item = {}, []
    for item in sorted(active, key=lambda entry: entry['id']):
        stores = [store for store in item.get('dataStores') or [] if isinstance(store, dict) and store.get('id')]
        if not stores:
            continue
        kind = item.get('kind') or 'module'
        by_item.append([f"{item['id']}", kind, ', '.join(sorted(s['id'] for s in stores if 'read' in (s.get('access') or []))) or '-', ', '.join(sorted(s['id'] for s in stores if 'write' in (s.get('access') or []))) or '-'])
        for store in stores:
            entry = by_store.setdefault(store['id'], {'read': [], 'write': []})
            for access in ('read', 'write'):
                if access in (store.get('access') or []):
                    entry[access].append(f"{item['id']} ({kind})")
    front = docmd.front_matter({'app': app, 'generatedBy': 'rebuild_aggregates.py', 'stores': len(by_store), 'items': len(by_item),
                                'writtenByMany': sum(1 for entry in by_store.values() if len(entry['write']) > 1),
                                'neverWritten': sum(1 for entry in by_store.values() if not entry['write'])})
    doc = [front, f'# Data access - {rr.one_line(app, 80)}', '',
           f'Which items read and write which data store, from the links of the catalog ({paths.assessment_catalog_dir(app)}/): the read and write edges of the topology. '
           'The edges do not say create, update or delete, so this is a read/write matrix. Generated by rebuild_aggregates.py; do not edit by hand.', '']
    if by_store:
        doc += ['## By data store', '', docmd.table(['Data store', 'Written by', 'Read by'], [
            [store, ', '.join(entry['write']) or '-', ', '.join(entry['read']) or '-'] for store, entry in sorted(by_store.items())]).rstrip('\n'), '',
            '## By item', '', docmd.table(['Item', 'Kind', 'Reads', 'Writes'], by_item).rstrip('\n')]
    else:
        doc.append('The catalog records no data store access.')
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
                   + (f"[{item['id']}]({os.path.relpath(row['spec'], paths.generated_dir(app)).replace(os.sep, '/')})" if row else 'not understood yet') + ' |')
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
        active, rule_rows, objects, finding_rows, rows, gap_rows = rebuild(args.app, docs)
        root = os.path.abspath(args.out)
        gen = os.path.join(root, *paths.generated_dir(args.app).split('/'))
        texts = {
            'BUSINESS_RULES.md': business_rules(args.app, rule_rows),
            'DATA_OBJECTS.md': data_objects(args.app, objects),
            'SECURITY_FINDINGS.md': security_findings(args.app, finding_rows),
            'GAPS.md': gaps_md(args.app, gap_rows),
            'DATA_ACCESS.md': data_access_md(args.app, active),
            'traceability.md': traceability_md(args.app, rows, active, rule_rows, finding_rows),
            'README.md': readme(args.app, active, rows),
        }
        for name, text in texts.items():
            docmd.write_text(os.path.join(gen, name), text)
    except (cc.DataError, rr.DataError, OSError, RecursionError) as error:
        print(f'rebuild_aggregates.py: {error}', file=sys.stderr)
        return 1
    print(f'{len(rows)} of {len(active)} item(s) understood; {len(rule_rows)} rule(s), {len(finding_rows)} finding(s), {len(gap_rows)} gap(s)')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
