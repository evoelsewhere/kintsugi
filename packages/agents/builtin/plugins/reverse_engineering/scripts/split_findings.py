#!/usr/bin/env python3
"""Split a scoped run's security scan into one findings file per selected item (ADR-0033).

    python3 split_findings.py <app> --scan FILE --catalog FILE --items ID,ID,... --out DIR

--scan is the object the harden-scan workflow returned for the run's files (findings, coverage,
toolsNotRun, ...; scratch); --catalog 10-applications/<app>/01-legacy/_catalog/; --items the run's items.
--out is the document-repository root. Each finding goes to the item that owns the file of its
`source` (file:line); a finding outside the selected items is left out and counted. Writes
10-applications/<app>/01-legacy/<module>/<unit>/findings.md per item: the scorecard, the table of
findings (ids `SEC-<scope>-0001`), a card per finding for its fix and masked evidence, the tools
that did not run and the files reviewed.

IDs come from the per-unit identifiers/findings-ids.md ledger, independently of severity ordering. Credential details (`credentialMeta`)
never go into the file: they belong to the restricted record. Standard library only.
"""
import argparse
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import catalog_common as cc  # noqa: E402
import docmd  # noqa: E402
import paths  # noqa: E402

SEVERITY = {'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3}
KEPT = ('cwe', 'severity', 'confidence', 'source', 'title', 'exploitScenario', 'recommendedFix', 'maskedEvidence', 'isCredential', 'class')
MAX_FINDINGS = 500


SEVERITIES = ('Critical', 'High', 'Medium', 'Low')


def split(app, scan, chosen, docs=''):
    owner = cc.owner_of(chosen)
    per_item = {item['id']: [] for item in chosen}
    unplaced = 0
    findings = scan.get('findings') if isinstance(scan.get('findings'), list) else []
    for finding in findings[:MAX_FINDINGS * 10]:
        if not isinstance(finding, dict):
            continue
        item_id = owner.item_of(cc.norm_path(str(finding.get('source') or '').split(':', 1)[0]))
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
        records = [(finding, cc.refs.fingerprint(cc.canonical_citation(finding.get('source')), cc.refs.normalized(finding.get('cwe')), cc.refs.normalized(finding.get('title'))), cc.refs.fingerprint(cc.canonical_citation(finding.get('source')), cc.refs.normalized(finding.get('cwe')))) for finding in ordered]
        numbered, ledger = cc.refs.allocate('SEC', cc.refs.scope_of(item), records, cc.refs.prior_registry(docs, app, item, 'SEC'))
        outputs[cc.refs.registry_path(app, item, 'SEC')] = {'item': item['id'], 'ids': [], 'text': ledger}
        outputs[paths.unit_findings_path(app, *item['id'].split('/'))] = {
            'item': item['id'],
            'ids': [finding['id'] for finding in numbered],
            'text': render_findings(app, item['id'], numbered, sorted(rel for rel in item['files'] if rel in reviewed), tools, dead),
        }
    return outputs, unplaced


def one_line(value, limit=200):
    return docmd.clean_text(value, limit) if isinstance(value, str) else ''


def render_findings(app, item_id, findings, reviewed, tools, dead):
    """The findings.md of one unit (ADR-0042): the table SECURITY_FINDINGS.md has, plus a short card per
    finding for the fix and the masked evidence. Credential details never go in: they belong to the restricted record."""
    counts = {severity: sum(1 for finding in findings if finding.get('severity') == severity) for severity in SEVERITIES}
    doc = [
        docmd.front_matter({'app': app, 'item': item_id, 'generatedBy': 'split_findings.py', 'findings': len(findings), **{severity.lower(): counts[severity] for severity in SEVERITIES}, 'filesReviewed': len(reviewed)}),
        f'# Security findings - {item_id}', '',
        '## Scorecard', '', docmd.table(['Severity', 'Count'], [*[[severity, counts[severity]] for severity in SEVERITIES], ['**Total**', f'**{len(findings)}**']]),
        f'**Review coverage:** manual review by the finder jobs of {len(reviewed)} file(s) of the item; no SAST, dependency-audit or secret-scanning tool ran.', '',
        '## Findings by severity', '',
    ]
    if findings:
        doc.append(docmd.table(['ID', 'CWE', 'Severity', 'Confidence', 'Location', 'Title', 'Exploit scenario'], [
            [finding['id'], one_line(finding.get('cwe'), 20), one_line(finding.get('severity'), 10), one_line(finding.get('confidence'), 10), f"`{one_line(finding.get('source'), 120).replace(chr(96), '')}`", one_line(finding.get('title')), one_line(finding.get('exploitScenario'))]
            for finding in findings
        ]))
    else:
        doc.append('No confirmed findings in this item.\n')
    details = [finding for finding in findings if finding.get('recommendedFix') or finding.get('maskedEvidence')]
    if details:
        doc += ['## Details', '']
        for finding in details:
            doc += [docmd.heading(3, finding['id']), '', docmd.field_lines({'recommended fix': one_line(finding.get('recommendedFix'), 600), 'evidence (masked)': one_line(finding.get('maskedEvidence'), 300)})]
    if tools:
        doc += ['## Tools not run', '', docmd.table(['Tool', 'Why'], [[one_line(tool.get('tool') or tool.get('name'), 80), one_line(tool.get('reason') or tool.get('why'), 200)] for tool in tools])]
    if dead:
        doc += ['## Dead finders', '', docmd.bullet_list([one_line(value, 120) for value in dead], coded=False)]
    if reviewed:
        doc += ['## Files reviewed', '', docmd.bullet_list(reviewed)]
    return '\n'.join(doc).rstrip() + '\n'


def finding_rows(text):
    """The rows of the 'Findings by severity' table of a unit's findings.md, keyed by the lower-cased header."""
    section = dict(docmd.sections(docmd.split_front_matter(text)[1], 2)).get('Findings by severity', '')
    return docmd.records_in(section)


def main(argv):
    ap = argparse.ArgumentParser(description='Split a scoped security scan into per-item findings documents.')
    ap.add_argument('app')
    ap.add_argument('--scan', required=True)
    ap.add_argument('--catalog', required=True)
    ap.add_argument('--items', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--docs', default='', help='read-only document repository holding the allocation history')
    args = ap.parse_args(argv[1:])
    try:
        if not cc.APP_RE.match(args.app):
            raise cc.DataError('the application id must be kebab-case')
        items, _ = cc.load_catalog(args.catalog)
        chosen = cc.selected(items, args.items)
        scan = cc.read_optional_json(args.scan)
        outputs, unplaced = split(args.app, scan if isinstance(scan, dict) else {}, chosen, args.docs or args.out)
        root = os.path.abspath(args.out)
        for path, value in outputs.items():
            docmd.write_text(os.path.join(root, *path.split('/')), value['text'])
    except (cc.DataError, OSError, RecursionError) as error:
        print(f'split_findings.py: {error}', file=sys.stderr)
        return 1
    total = sum(len(value['ids']) for value in outputs.values())
    print(f'{total} finding(s) split over {len(chosen)} item(s); {unplaced} left out (outside the selected items)')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
