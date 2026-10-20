#!/usr/bin/env python3
"""Finish a scoped understand run (ADR-0033): per selected item that got its specification, the
checked traceability fragment, meta.json (what marks the item understood) and its work item.

    python3 finish_items.py <app> --catalog FILE --items ID,ID,... --inputs DIR --out DIR
        --commit SHA [--run ID] [--repo ID] [--existing DIR]

--inputs is the run's inputs root (document-repository layout): the specifications
applications/<app>/units/<module>/<unit>/as-is.md, the fragments the specification jobs returned
(applications/<app>/units/<module>/<unit>/trace.json) and the item's rules.json and
findings.json in the same unit folder. --commit is the source commit, --run the run id,
--existing the document repository's applications/<app>/units/ folder (a work item already there
is left as it is, so a person's progress is never overwritten). Writes under --out:

- applications/<app>/units/<module>/<unit>/trace.json — the fragment with only the rule and
  finding ids of that item and dependencies that name a catalog item, a data store or a system,
  carrying the requirements, pull requests and tests the specification recorded;
- applications/<app>/units/<module>/<unit>/meta.json — {item, digest, commit, runId, ...}:
  the item is `understood` once this file is on the default branch, `stale` when the catalog's
  digest moves away from it;
- applications/<app>/units/<module>/<unit>/unit.md — the work item.

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
import paths  # noqa: E402
import write_work_items as wwi  # noqa: E402

COMMIT = re.compile(r'^[0-9a-f]{40}([0-9a-f]{24})?$')
RUN = re.compile(r'^[A-Za-z0-9-]{1,80}$')


def ids_of(document, key):
    values = document.get(key) if isinstance(document, dict) else None
    return [entry['id'] for entry in values or [] if isinstance(entry, dict) and isinstance(entry.get('id'), str)]


def strings(value, limit=200):
    return [entry for entry in value if isinstance(entry, str) and entry.strip()][:limit] if isinstance(value, list) else []


def finish(app, items, chosen, inputs, commit, run, repo, existing):
    outputs, texts, done, missing = {}, {}, [], []
    for item in chosen:
        item_id = item['id']
        spec = paths.knowledge_as_is_unit_path(app, item_id)
        if not os.path.isfile(os.path.join(inputs, *spec.split('/'))):
            missing.append(item_id)
            continue
        raw = cc.read_optional_json(os.path.join(inputs, *paths.unit_trace_path(app, *item_id.split('/')).split('/')))
        trace = raw if isinstance(raw, dict) else {}
        rules = set(ids_of(cc.read_optional_json(os.path.join(inputs, *paths.unit_rules_path(app, *item_id.split('/')).split('/'))), 'rules'))
        findings = set(ids_of(cc.read_optional_json(os.path.join(inputs, *paths.unit_findings_path(app, *item_id.split('/')).split('/'))), 'findings'))
        dependencies = []
        for dep in trace.get('dependencies') or []:
            if not isinstance(dep, dict) or not isinstance(dep.get('target'), str):
                continue
            target = dep['target'].strip()
            if target in items or target.startswith('ds:') or (target and '/' not in target):
                dependencies.append({'target': target[:120], 'kind': cc.clean_text(dep.get('kind'), 20) or 'call', 'direction': 'inbound' if dep.get('direction') == 'inbound' else 'outbound'})
        checked = {
            'app': app,
            'item': item_id,
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
        outputs[paths.unit_trace_path(app, *item_id.split('/'))] = checked
        outputs[paths.unit_meta_path(app, *item_id.split('/'))] = {
            'app': app,
            'item': item_id,
            'generatedBy': 'finish_items.py',
            'digest': item.get('digest') if isinstance(item.get('digest'), str) else '',
            'commit': commit,
            **({'runId': run} if run else {}),
            'specification': spec,
            'rules': len(checked['rulesApplied']),
            'findings': len(checked['findings']),
        }
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
            texts[paths.unit_key_path(app, item_id, 'unit.md')] = '\n'.join(wwi.frontmatter(app, unit, repo)) + '\n\n' + wwi.body(app, unit) + '\n'
        done.append(item_id)
    return outputs, texts, done, missing


def main(argv):
    ap = argparse.ArgumentParser(description='Finish a scoped understand run: traces, meta.json and work items per item.')
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
        outputs, texts, done, missing = finish(args.app, items, chosen, os.path.realpath(args.inputs), args.commit, args.run, args.repo, args.existing)
        root = os.path.abspath(args.out)
        for path, value in outputs.items():
            cc.write_json(os.path.join(root, *path.split('/')), value)
        for path, text in texts.items():
            target = os.path.join(root, *path.split('/'))
            os.makedirs(os.path.dirname(target), exist_ok=True)
            if os.path.islink(target):
                raise cc.DataError(f'refusing to write through a symbolic link: {path}')
            with open(target, 'w', encoding='utf-8', newline='\n') as handle:
                handle.write(text)
    except (cc.DataError, OSError, RecursionError) as error:
        print(f'finish_items.py: {error}', file=sys.stderr)
        return 1
    print(f'{len(done)} item(s) understood, {len(texts)} work item(s) written; {len(missing)} without a specification')
    for item_id in missing[:60]:
        print(f'- no specification: {item_id}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
