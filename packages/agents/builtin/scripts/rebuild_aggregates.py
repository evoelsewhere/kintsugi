#!/usr/bin/env python3
"""Rebuild the whole-application views of an application from its per-item files (ADR-0033).

    python3 rebuild_aggregates.py <app> --docs DIR --out DIR

--docs is the document repository at the default branch tip (read-only): assessment/<app>/catalog.json,
the per-item files assessment/<app>/items/<module>/<item>/{topology,rules,findings}.json and
knowledge/as-is/<app>/items/<module>/<item>/{trace,meta}.json, and the specifications
knowledge/as-is/<app>/<module>/<item>.md. --out is the document-repository root the views are written
under; they are never written by a run's pull request, only by this script (auto-committed):

- assessment/<app>/generated/topology.json — the item fragments merged: a domain per catalog module,
  every leaf, every edge, every entry point;
- assessment/<app>/generated/rules_result.json, BUSINESS_RULES.md, DATA_OBJECTS.md — every item's rules
  and data objects, under their item-namespaced ids;
- assessment/<app>/generated/SECURITY_FINDINGS.md — the scorecard and every item's findings;
- knowledge/as-is/<app>/generated/traceability.json, traceability.md — one row per understood item
  (files, dependencies, rules, findings, data stores), and README.md — the index of the specifications.

Deterministic: the same inputs give the same files. Standard library only.
"""
import argparse
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import catalog_common as cc  # noqa: E402
import render_rules as rr  # noqa: E402

SEVERITIES = ('Critical', 'High', 'Medium', 'Low')


def item_json(root, *parts):
    value = cc.read_optional_json(os.path.join(root, *parts))
    return value if isinstance(value, dict) else {}


def rebuild(app, docs):
    items, catalog = cc.load_catalog(os.path.join(docs, 'assessment', app, 'catalog.json'))
    modules = {m['id']: m for m in catalog.get('modules', []) if isinstance(m, dict) and isinstance(m.get('id'), str)}
    active = [item for item in items.values() if item.get('status') != 'retired']
    domains, edges, entry_points, seen_leaves = {}, [], set(), set()
    rules, objects, findings, rows = [], [], [], []
    for item in sorted(active, key=lambda entry: entry['id']):
        item_id = item['id']
        parts = item_id.split('/')
        fragment = item_json(docs, 'assessment', app, 'items', *parts, 'topology.json')
        for domain in (fragment.get('root') or {}).get('children') or []:
            for leaf in domain.get('children') or [] if isinstance(domain, dict) else []:
                if isinstance(leaf, dict) and isinstance(leaf.get('id'), str) and leaf['id'] not in seen_leaves:
                    seen_leaves.add(leaf['id'])
                    domains.setdefault(item.get('module') or parts[0], []).append(leaf)
        edges += [{key: edge[key] for key in ('source', 'target', 'kind') if key in edge} for edge in fragment.get('edges') or [] if isinstance(edge, dict)]
        entry_points.update(value for value in fragment.get('entryPoints') or [] if isinstance(value, str))
        item_rules = item_json(docs, 'assessment', app, 'items', *parts, 'rules.json')
        rules += [{**rule, 'item': item_id} for rule in item_rules.get('rules') or [] if isinstance(rule, dict) and isinstance(rule.get('id'), str)]
        objects += [obj for obj in item_rules.get('dataObjects') or [] if isinstance(obj, dict)]
        item_findings = item_json(docs, 'assessment', app, 'items', *parts, 'findings.json')
        findings += [{**finding, 'item': item_id} for finding in item_findings.get('findings') or [] if isinstance(finding, dict) and isinstance(finding.get('id'), str)]
        meta = item_json(docs, 'knowledge', 'as-is', app, 'items', *parts, 'meta.json')
        if meta:
            trace = item_json(docs, 'knowledge', 'as-is', app, 'items', *parts, 'trace.json')
            deps = [d for d in trace.get('dependencies') or [] if isinstance(d, dict) and isinstance(d.get('target'), str)]
            stores = {}
            for dep in deps:
                if dep['target'].startswith('ds:'):
                    stores.setdefault(dep['target'], set()).add(str(dep.get('kind') or 'read'))
            # The row shape of merge_traceability.py, so the readers and the portal take both.
            rows.append({
                'id': f'{app}/{item_id}', 'item': item_id, 'module': parts[0], 'unit': parts[1], 'title': cc.clean_text(item.get('name'), cc.MAX_NAME) or item_id,
                'kind': item.get('kind') or 'module', 'loc': item.get('loc') if isinstance(item.get('loc'), int) else 0,
                'entryPoint': bool(item.get('entryPoints')),
                'spec': f'knowledge/as-is/{app}/{item_id}.md', 'files': item['files'],
                'dependsOn': sorted({f'{app}/{d["target"]}' for d in deps if d['target'] in items and d.get('direction') != 'inbound'}),
                'usedBy': sorted({f'{app}/{d["target"]}' for d in deps if d['target'] in items and d.get('direction') == 'inbound'}),
                'dataStores': [{'id': store, 'access': sorted(kinds)} for store, kinds in sorted(stores.items())],
                'externalSystems': [v for v in trace.get('externalSystems') or [] if isinstance(v, str)],
                'rules': [r for r in trace.get('rulesApplied') or [] if isinstance(r, str)],
                'findings': [f for f in trace.get('findings') or [] if isinstance(f, str)],
                'dataObjects': [v for v in trace.get('dataObjects') or [] if isinstance(v, str)],
                'entryPoints': [v for v in trace.get('entryPoints') or [] if isinstance(v, str)],
                'openQuestions': trace.get('openQuestions') if isinstance(trace.get('openQuestions'), int) else 0,
                'stale': meta.get('digest') != item.get('digest'),
                'understoodAt': meta.get('commit'),
            })
    topology = {
        'system': app,
        'generatedBy': 'rebuild_aggregates.py',
        'root': {'id': 'sys', 'name': app, 'kind': 'system', 'children': [
            {'id': f'dom:{module}', 'name': cc.clean_text((modules.get(module) or {}).get('name'), cc.MAX_NAME) or module, 'kind': 'domain', 'children': leaves}
            for module, leaves in sorted(domains.items())]},
        'edges': sorted({(e.get('source'), e.get('target'), e.get('kind')) for e in edges if all(isinstance(e.get(k), str) for k in ('source', 'target', 'kind'))}),
        'entryPoints': sorted(entry_points),
        'deadEnds': [], 'observations': [], 'flows': [],
    }
    topology['edges'] = [{'source': s, 'target': t, 'kind': k} for s, t, k in topology['edges']]
    return active, rules, objects, findings, rows, topology


def business_rules(app, rules):
    doc = [f'# Business Rules — {rr.one_line(app, 80)}', '',
           f'Generated from the rules of {len({r["item"] for r in rules})} understood item(s) (assessment/{app}/items/*/rules.json); do not edit by hand.', '',
           '| ID | Item | Name | Category | Priority | Source | Confidence |', '|---|---|---|---|---|---|---|']
    for rule in rules:
        doc.append(f"| {rule['id']} | {rule['item']} | {rr.one_line(rule.get('name'), 80)} | {rr.one_line(rule.get('category'), 20)} | {rr.one_line(rule.get('priority'), 4)} | "
                   f"`{rr.split_citation(rule.get('source'))[0][:80].replace(chr(39), '')}` | {rr.one_line(rule.get('confidence'), 10)} |")
    doc.append('')
    if not rules:
        doc += [rr.NO_RULES_MARKER, '']
    for rule in rules:
        doc += [rr.render_rule(0, rule, rid=rule['id'])[1], '']
    return '\n'.join(doc).rstrip() + '\n'


def data_objects(app, objects):
    doc = [f'# Data Objects — {rr.one_line(app, 80)}', '']
    if not objects:
        doc.append('No data objects were cataloged.')
    for obj in sorted(objects, key=lambda o: str(o.get('name'))):
        doc += [f"## {rr.one_line(obj.get('name'), 100)}", f"Source: `{rr.one_line(obj.get('source'), 160).replace(chr(39), '')}`", '', '| Field | Type | Note |', '|---|---|---|']
        for field in obj.get('fields') or []:
            if isinstance(field, dict):
                doc.append(f"| {rr.one_line(field.get('name'), 80)} | {rr.one_line(field.get('type'), 60)} | {rr.one_line(field.get('note'), 160)} |")
        doc.append('')
    return '\n'.join(doc).rstrip() + '\n'


def security_findings(app, findings):
    counts = {severity: sum(1 for f in findings if f.get('severity') == severity) for severity in SEVERITIES}
    doc = [f'# Security findings — {rr.one_line(app, 80)}', '', f'Generated from the findings of the understood items (assessment/{app}/items/*/findings.json); do not edit by hand.', '',
           '## Scorecard', '', '| Severity | Count |', '|---|---|']
    doc += [f'| {severity} | {count} |' for severity, count in counts.items()]
    doc += [f'| **Total** | **{len(findings)}** |', '', '## Findings by severity', '']
    if findings:
        doc += ['| ID | CWE | Severity | Confidence | Location | Title | Exploit scenario |', '|---|---|---|---|---|---|---|']
        order = sorted(findings, key=lambda f: (SEVERITIES.index(f['severity']) if f.get('severity') in SEVERITIES else 9, f['id']))
        doc += [f"| {f['id']} | {rr.one_line(f.get('cwe'), 20)} | {rr.one_line(f.get('severity'), 10)} | {rr.one_line(f.get('confidence'), 10)} | `{rr.one_line(f.get('source'), 120)}` | "
                f"{rr.one_line(f.get('title'), 120)} | {rr.one_line(f.get('exploitScenario'), 200)} |" for f in order]
    else:
        doc.append('No confirmed findings in the understood items.')
    return '\n'.join(doc).rstrip() + '\n'


def traceability_md(app, rows, total):
    doc = [f'# Traceability — {app}', '', f'{len(rows)} of {total} catalog item(s) understood. Generated by rebuild_aggregates.py.', '',
           '| Item | Kind | Files | Depends on | Rules | Findings | State |', '|---|---|---|---|---|---|---|']
    for row in rows:
        doc.append(f"| [{row['title']}](../{row['item']}.md) `{row['item']}` | {row['kind']} | {len(row['files'])} | {', '.join(d.split('/', 1)[1] for d in row['dependsOn']) or '—'} | "
                   f"{len(row['rules'])} | {len(row['findings'])} | {'stale' if row['stale'] else 'understood'} |")
    return '\n'.join(doc).rstrip() + '\n'


def readme(app, active, rows):
    understood = {row['item']: row for row in rows}
    doc = [f'# {app} — AS-IS knowledge', '', f'{len(understood)} of {len(active)} catalog item(s) have an AS-IS specification. Generated by rebuild_aggregates.py.', '']
    module = None
    for item in sorted(active, key=lambda entry: (entry.get('module') or '', entry['id'])):
        if item.get('module') != module:
            module = item.get('module')
            doc += ['', f'## {module}', '', '| Item | Kind | Specification |', '|---|---|---|']
        row = understood.get(item['id'])
        doc.append(f"| {cc.clean_text(item.get('name'), cc.MAX_NAME) or item['id']} `{item['id']}` | {item.get('kind') or 'module'} | "
                   + (f"[{item['id']}.md](../{item['id']}.md)" if row else 'not understood yet') + ' |')
    return '\n'.join(doc).rstrip() + '\n'


def main(argv):
    ap = argparse.ArgumentParser(description='Rebuild the whole-application views of an application from its per-item files.')
    ap.add_argument('app')
    ap.add_argument('--docs', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args(argv[1:])
    try:
        if not cc.APP_RE.match(args.app):
            raise cc.DataError('the application id must be kebab-case')
        docs = os.path.realpath(args.docs)
        active, rules, objects, findings, rows, topology = rebuild(args.app, docs)
        root = os.path.abspath(args.out)
        gen = os.path.join(root, 'assessment', args.app, 'generated')
        know = os.path.join(root, 'knowledge', 'as-is', args.app, 'generated')
        cc.write_json(os.path.join(gen, 'topology.json'), topology)
        cc.write_json(os.path.join(gen, 'rules_result.json'), {'generatedBy': 'rebuild_aggregates.py', 'confirmedRules': rules, 'dataObjects': objects})
        texts = {
            os.path.join(gen, 'BUSINESS_RULES.md'): business_rules(args.app, rules),
            os.path.join(gen, 'DATA_OBJECTS.md'): data_objects(args.app, objects),
            os.path.join(gen, 'SECURITY_FINDINGS.md'): security_findings(args.app, findings),
            os.path.join(know, 'traceability.md'): traceability_md(args.app, rows, len(active)),
            os.path.join(know, 'README.md'): readme(args.app, active, rows),
        }
        index = lambda key: {value: sorted(row['id'] for row in rows if value in row[key]) for value in sorted({v for row in rows for v in row[key]})}  # noqa: E731
        cc.write_json(os.path.join(know, 'traceability.json'), {
            'app': args.app, 'generatedBy': 'rebuild_aggregates.py', 'items': len(active),
            'inputs': {'businessRules': bool(rules), 'securityFindings': bool(findings)},
            'units': rows, 'rules': index('rules'), 'findings': index('findings'), 'files': index('files'),
            'dataStores': {store: sorted(row['id'] for row in rows if any(entry['id'] == store for entry in row['dataStores'])) for store in sorted({entry['id'] for row in rows for entry in row['dataStores']})},
            'unmappedRules': [], 'unmappedFindings': [], 'cycles': [], 'notes': {},
        })
        for path, text in texts.items():
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'w', encoding='utf-8', newline='\n') as handle:
                handle.write(text)
    except (cc.DataError, rr.DataError, OSError, RecursionError) as error:
        print(f'rebuild_aggregates.py: {error}', file=sys.stderr)
        return 1
    print(f'{len(rows)} of {len(active)} item(s) understood; {len(rules)} rule(s), {len(findings)} finding(s), {sum(len(c["children"]) for c in topology["root"]["children"])} leaves')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
