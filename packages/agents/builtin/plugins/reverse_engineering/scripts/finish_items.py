#!/usr/bin/env python3
"""Finish a scoped understand run (ADR-0033): per selected item that got its specification, the
checked traceability record, the understanding record (what marks the item understood) and its work item.

    python3 finish_items.py <app> --catalog DIR --items ID,ID,... --inputs DIR --out DIR
        --commit SHA [--run ID] [--repo ID] [--existing DIR]

--inputs is the run's inputs root (document-repository layout): the specifications
applications/<app>/units/<module>/<unit>/understanding/as-is.md, the item's rules.md and findings.md in the
same folder, and the fragments the specification jobs returned (scratch/<app>/understand/trace/<module>/<unit>.json).
--commit is the source commit, --run the run id, --existing the document repository's
applications/<app>/units/ folder (a work item already there is left as it is, so a person's progress is never
overwritten). Writes under --out, in applications/<app>/units/<module>/<unit>/:

- understanding/trace.md - the fragment with only the rule and finding ids of that item and dependencies
  that name a catalog item, a data store or a system, with the sections the later phases fill in
  (requirements, pull requests, tests);
- understanding/understanding.md - digest, commit, run, counts: the item is `understood` once this file is
  on the default branch, `stale` when the catalog's digest moves away from it;
- unit.md - the work item (frontmatter = state).

An item without its specification gets none of these (it shows as failed or not analysed).
Standard library only.
"""
import argparse
import os
import re
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import catalog_common as cc  # noqa: E402
import docmd  # noqa: E402
import paths  # noqa: E402
import render_rules as rr  # noqa: E402
import split_findings as sf  # noqa: E402

COMMIT = re.compile(r'^[0-9a-f]{40}([0-9a-f]{24})?$')
RUN = re.compile(r'^[A-Za-z0-9-]{1,80}$')


def strings(value, limit=200):
    return [entry for entry in value if isinstance(entry, str) and entry.strip()][:limit] if isinstance(value, list) else []


def complexity(loc):
    if not isinstance(loc, int) or isinstance(loc, bool):
        return None
    return 'low' if loc < 500 else 'medium' if loc < 2000 else 'high'


def work_item(app, unit, repo):
    """unit.md: frontmatter (the unit's state, docs/reference/document-repo-unit-files.md) and a one-paragraph body."""
    q = docmd.scalar
    lines = [
        '---',
        f'id: {q(unit["id"])}',
        f'application: {q(app)}',
        f'module: {q(unit["module"])}',
        f'kind: {q(unit["kind"] or "module")}',
        f'title: {q(unit["title"])}',
        'phase: discover-assess',
        'stage: understand',
        'status: pending',
    ]
    level = complexity(unit.get('loc'))
    if level:
        lines.append(f'complexity: {level}')
    lines.append('dependsOn: ' + (docmd.scalar_list(unit['dependsOn'])))
    if unit['files']:
        lines += ['source:', f'  - {{repo: {q(repo)}, paths: {docmd.scalar_list(unit["files"])}}}']
    links = [f'  asIs: {q(unit["spec"])}']
    if unit['rules']:
        links.append(f'  businessRules: {docmd.scalar_list(unit["rules"])}')
    lines += ['links:'] + links + ['---']
    text = [f'{unit["title"]}: proposed by the understand stage from the catalog of {app}.', f'AS-IS specification: `{unit["spec"]}`.']
    if unit['findings']:
        text.append(f'Security findings: {", ".join(unit["findings"])} ({paths.unit_key_understanding_path(app, unit["id"].split("/", 1)[1], "findings.md")}).')
    if unit['entryPoint']:
        text.append('This unit holds an entry point of the application.')
    return '\n'.join(lines) + '\n\n' + ' '.join(text) + '\n'


def render_trace(app, item_id, checked):
    def section(title, body):
        return [f'## {title}', '', body if body else '']

    out = [
        docmd.front_matter({'app': app, 'item': item_id, 'generatedBy': 'finish_items.py', 'openQuestions': checked['openQuestions']}),
        f'# Traceability - {item_id}', '',
        *section('Entry points', docmd.bullet_list(checked['entryPoints'])),
        *section('Rules applied', docmd.bullet_list(checked['rulesApplied'])),
        *section('Findings', docmd.bullet_list(checked['findings'])),
        *section('Dependencies', docmd.table(['Target', 'Kind', 'Direction'], [[dep['target'], dep['kind'], dep['direction']] for dep in checked['dependencies']])),
        *section('Data objects', docmd.bullet_list(checked['dataObjects'], coded=False)),
        *section('External systems', docmd.bullet_list(checked['externalSystems'], coded=False)),
        *section('Files', docmd.bullet_list(checked['files'])),
        *section('Requirements', docmd.bullet_list(checked['requirements'])),
        *section('Pull requests', docmd.bullet_list(checked['pullRequests'])),
        *section('Tests', docmd.bullet_list(checked['tests'])),
    ]
    return '\n'.join(out).rstrip() + '\n'


def finish(app, items, chosen, inputs, commit, run, repo, existing):
    texts, done, missing, new_units = {}, [], [], 0
    for item in chosen:
        item_id = item['id']
        spec = paths.unit_key_as_is_path(app, item_id)
        if not os.path.isfile(os.path.join(inputs, *spec.split('/'))):
            missing.append(item_id)
            continue
        raw = cc.read_optional_json(os.path.join(inputs, *paths.understand_trace_draft_path(app, item_id).split('/')))
        trace = raw if isinstance(raw, dict) else {}
        rules_text = docmd.read_optional_text(os.path.join(inputs, *paths.unit_rules_path(app, *item_id.split('/')).split('/')))
        findings_text = docmd.read_optional_text(os.path.join(inputs, *paths.unit_findings_path(app, *item_id.split('/')).split('/')))
        rules = {row['id'] for row in rr.unit_rule_rows(rules_text) if row.get('id') and row.get('status') != 'retired'} if rules_text else set()
        findings = {row.get('id', '') for row in sf.finding_rows(findings_text)} if findings_text else set()
        dependencies = []
        for dep in trace.get('dependencies') or []:
            if not isinstance(dep, dict) or not isinstance(dep.get('target'), str):
                continue
            target = dep['target'].strip()
            if target in items or target.startswith('ds:') or (target and '/' not in target):
                dependencies.append({'target': target[:120], 'kind': cc.clean_text(dep.get('kind'), 20) or 'call', 'direction': 'inbound' if dep.get('direction') == 'inbound' else 'outbound'})
        checked = {
            'entryPoints': strings(trace.get('entryPoints')),
            'rulesApplied': sorted(set(strings(trace.get('rulesApplied'))) & rules),
            'findings': sorted(set(strings(trace.get('findings'))) & findings),
            'dependencies': dependencies,
            'dataObjects': strings(trace.get('dataObjects')),
            'externalSystems': strings(trace.get('externalSystems')),
            'requirements': strings(trace.get('requirements')),
            'pullRequests': strings(trace.get('pullRequests')),
            'tests': strings(trace.get('tests')),
            'files': sorted({rel for rel in (cc.norm_path(value) for value in strings(trace.get('files'))) if rel}),
            'openQuestions': trace.get('openQuestions') if isinstance(trace.get('openQuestions'), int) and not isinstance(trace.get('openQuestions'), bool) else 0,
        }
        texts[paths.unit_trace_path(app, *item_id.split('/'))] = render_trace(app, item_id, checked)
        record = {
            'app': app,
            'item': item_id,
            'generatedBy': 'finish_items.py',
            'status': 'understood',
            'digest': item.get('digest') if isinstance(item.get('digest'), str) else '',
            'commit': commit,
            'runId': run or '',
            'specification': spec,
            'rules': len(checked['rulesApplied']),
            'findings': len(checked['findings']),
        }
        texts[paths.unit_understanding_path(app, *item_id.split('/'))] = (
            docmd.front_matter(record) + f'# Understanding record - {item_id}\n\nThe specification of this item was written at `{commit}`. '
            'Its presence on the default branch marks the item understood; a changed catalog digest marks it stale.\n'
        )
        module, name = item_id.split('/', 1)
        if not (existing and os.path.exists(os.path.join(existing, module, name, 'unit.md'))):
            unit = {
                'id': f'{app}/{item_id}',
                'module': module,
                'kind': cc.clean_text(item.get('kind'), 40) or 'module',
                'title': cc.clean_text(item.get('name'), cc.MAX_NAME) or item_id,
                'loc': item.get('loc') if isinstance(item.get('loc'), int) else None,
                'dependsOn': sorted({f'{app}/{dep["target"]}' for dep in dependencies if dep['target'] in items and dep['direction'] == 'outbound' and dep['target'] != item_id}),
                'files': item['files'],
                'spec': spec,
                'rules': checked['rulesApplied'],
                'findings': checked['findings'],
                'entryPoint': bool(item.get('entryPoints')),
            }
            texts[paths.unit_key_path(app, item_id, 'unit.md')] = work_item(app, unit, repo)
            new_units += 1
        done.append(item_id)
    return texts, done, missing, new_units


def main(argv):
    ap = argparse.ArgumentParser(description='Finish a scoped understand run: traces, understanding records and work items per item.')
    ap.add_argument('app')
    ap.add_argument('--catalog', required=True)
    ap.add_argument('--items', required=True)
    ap.add_argument('--inputs', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--commit', required=True)
    ap.add_argument('--run', default='')
    ap.add_argument('--repo', default='legacy')
    ap.add_argument('--existing')
    args = ap.parse_args(argv[1:])
    try:
        if not cc.APP_RE.match(args.app):
            raise cc.DataError('the application id must be kebab-case')
        if not COMMIT.match(args.commit):
            raise cc.DataError('--commit must be a commit id')
        if args.run and not RUN.match(args.run):
            raise cc.DataError('--run must be a run id')
        items, _ = cc.load_catalog(args.catalog)
        chosen = cc.selected(items, args.items)
        texts, done, missing, new_units = finish(args.app, items, chosen, os.path.realpath(args.inputs), args.commit, args.run, args.repo, args.existing)
        root = os.path.abspath(args.out)
        for path, text in texts.items():
            docmd.write_text(os.path.join(root, *path.split('/')), text)
    except (cc.DataError, OSError, RecursionError) as error:
        print(f'finish_items.py: {error}', file=sys.stderr)
        return 1
    print(f'{len(done)} item(s) understood, {new_units} work item(s) written; {len(missing)} without a specification')
    for item_id in missing[:60]:
        print(f'- no specification: {item_id}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
