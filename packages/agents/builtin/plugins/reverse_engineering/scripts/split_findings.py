#!/usr/bin/env python3
"""Split a scoped run's security scan into one findings file per selected item (ADR-0033).

    python3 split_findings.py <app> --scan FILE --catalog FILE --items ID,ID,... --out DIR

--scan is the object the harden-scan workflow returned for the run's files (findings, coverage,
toolsNotRun, ...); --catalog applications/<app>/assessment/catalog.json; --items the run's items.
--out is the document-repository root. Each finding goes to the item that owns the file of its
`source` (file:line); a finding outside the selected items is left out and counted. Writes
applications/<app>/units/<module>/<unit>/findings.json per item:

    {"app", "item", "generatedBy", "findings": [{"id": "SEC-<module>.<item>-NN", ...}], "filesReviewed", "toolsNotRun", "deadFinders"}

Ids are numbered inside the item by (severity, file:line). Credential details (`credentialMeta`)
never go into the file: they belong to the restricted record. Standard library only.
"""
import argparse
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import catalog_common as cc  # noqa: E402
import paths  # noqa: E402

SEVERITY = {'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3}
KEPT = ('cwe', 'severity', 'confidence', 'source', 'title', 'exploitScenario', 'recommendedFix', 'maskedEvidence', 'isCredential', 'class')
MAX_FINDINGS = 500


def split(app, scan, chosen):
    owner = cc.owner_of(chosen)
    per_item = {item['id']: [] for item in chosen}
    unplaced = 0
    findings = scan.get('findings') if isinstance(scan.get('findings'), list) else []
    for finding in findings[:MAX_FINDINGS * 10]:
        if not isinstance(finding, dict):
            continue
        item_id = owner.get(cc.norm_path(str(finding.get('source') or '').split(':', 1)[0]) or '')
        if item_id is None:
            unplaced += 1
            continue
        per_item[item_id].append({key: finding[key] for key in KEPT if key in finding and isinstance(finding[key], (str, bool))})
    coverage = scan.get('coverage') if isinstance(scan.get('coverage'), dict) else {}
    reviewed = {cc.norm_path(value) for value in coverage.get('filesReviewed') or [] if isinstance(value, str)}
    tools = [tool for tool in scan.get('toolsNotRun') or [] if isinstance(tool, dict)]
    dead = [value for value in scan.get('deadFinders') or [] if isinstance(value, str)]
    outputs = {}
    for item in chosen:
        ordered = sorted(per_item[item['id']], key=lambda f: (SEVERITY.get(f.get('severity'), 4), str(f.get('source')), str(f.get('cwe'))))[:MAX_FINDINGS]
        outputs[paths.unit_findings_path(app, *item['id'].split('/'))] = {
            'app': app,
            'item': item['id'],
            'generatedBy': 'split_findings.py',
            'findings': [{'id': cc.namespaced('SEC', item['id'], number), **finding} for number, finding in enumerate(ordered, start=1)],
            'filesReviewed': sorted(rel for rel in item['files'] if rel in reviewed),
            'toolsNotRun': tools,
            'deadFinders': dead,
        }
    return outputs, unplaced


def main(argv):
    ap = argparse.ArgumentParser(description='Split a scoped security scan into per-item findings files.')
    ap.add_argument('app')
    ap.add_argument('--scan', required=True)
    ap.add_argument('--catalog', required=True)
    ap.add_argument('--items', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args(argv[1:])
    try:
        if not cc.APP_RE.match(args.app):
            raise cc.DataError('the application id must be kebab-case')
        items, _ = cc.load_catalog(args.catalog)
        chosen = cc.selected(items, args.items)
        scan = cc.read_optional_json(args.scan)
        outputs, unplaced = split(args.app, scan if isinstance(scan, dict) else {}, chosen)
        root = os.path.abspath(args.out)
        for path, value in outputs.items():
            cc.write_json(os.path.join(root, *path.split('/')), value)
    except (cc.DataError, OSError, RecursionError) as error:
        print(f'split_findings.py: {error}', file=sys.stderr)
        return 1
    total = sum(len(value['findings']) for value in outputs.values())
    print(f'{total} finding(s) split over {len(outputs)} item(s); {unplaced} left out (outside the selected items)')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
