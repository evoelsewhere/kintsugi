#!/usr/bin/env python3
"""Read the reviewers' notes of a design run and report their findings (ADR-0054, ADR-0083).

    python3 check_review.py <app> <module/unit | @app>[,...] [--root DIR] [--report FILE] [--json]
                            [--design-report FILE] [--history FILE] [--history-out FILE]

Run from the root of the stage's inputs (or name it with --root). For each unit, the reviewer's note is
`scratch/<app>/design/review/<module>/<unit>.md`: front matter `unit`, and a table with the columns
`Severity | Document | Section | Category | Finding | Suggestion`. A note that is missing or does not parse (no table, other
columns, a severity or category that is not one of the lists below) counts as *not reviewed*, never as clean; an empty table is a
valid review with no finding.

When the run has clusters of units that share interfaces (`scratch/<app>/design/map.json`, written by `map_design.py`), the
contract reviewer's note of each cluster, `scratch/<app>/design/contract/<cluster>.md`, has the same table; its `Document` cell is the
document-repository path of the document to change, which names the unit the finding belongs to. Its findings join that unit's.

Severities: blocker, major, minor. Categories: fidelity, coverage, consistency, clarity, convention, id, contract, architecture.

The verify loop (ADR-0083) runs this once per round. A finding has a `fingerprint` (the unit, document, section, category and
wording, normalised), so a later round can tell a finding that was fixed from one that is still there. With --history, the report
of the earlier rounds is read from that file; with --history-out, this round is added and written:

  open      blockers + majors + the units whose structural check (--design-report) still fails + the notes that could not be read
  fix       the units the next fix round works on: they have a blocker, a major or a failing structural check
  rereview  the units the next round reviews again: the `fix` ones and the units with no usable note
  stalled   true when open > 0 and two rounds in a row did not lower the lowest `open` seen, or the same findings came back

--report writes the JSON `{"round", "open", "blockers", "majors", "minors", "structural", "stalled", "streak", "resolved",
"resolvedTotal", "fix", "rereview", "unreviewed", "unreviewedClusters", "units": [{"unit", "reviewed", "error", "blockers", "majors", "minors", "findings"}], "clusters": [...]}`.
The exit code is 0 whatever the notes say (the review advises, only the design check can fail a file) and 2 for input that
cannot be used. Standard library only.
"""
import argparse
import hashlib
import json
import os
import re
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import docmd  # noqa: E402
import paths  # noqa: E402

APP = re.compile(r'^[a-z0-9][a-z0-9-]{0,62}$')
UNIT_KEY = re.compile(r'^(?:@app|[A-Za-z0-9][A-Za-z0-9._-]{0,63}/[A-Za-z0-9][A-Za-z0-9._-]{0,63})$')
SEVERITIES = ('blocker', 'major', 'minor')
CATEGORIES = ('fidelity', 'coverage', 'consistency', 'clarity', 'convention', 'id', 'contract', 'architecture')
COLUMNS = ['severity', 'document', 'section', 'category', 'finding', 'suggestion']
MAX_FINDINGS = 200
MAX_ROUNDS_KEPT = 200


def fingerprint(unit, finding):
    """A short stable id of a finding: the same wording in the same place is the same finding in the next round."""
    words = re.sub(r'[^a-z0-9]+', ' ', finding['finding'].lower()).strip()
    text = '|'.join([unit, finding['document'].lower(), finding['section'].lower(), finding['category'], words])
    return hashlib.sha1(text.encode('utf-8')).hexdigest()[:12]


def read_table(path, missing):
    """(findings, error) of a note: every row parsed, or the reason the note cannot be used."""
    if not os.path.isfile(path) or os.path.islink(path):
        return [], missing
    try:
        text = docmd.read_text(path)
    except (docmd.DataError, OSError) as error:
        return [], str(error)
    _, body = docmd.split_front_matter(text)
    tables = docmd.tables_in(body)
    if not tables or [cell.strip().lower() for cell in tables[0][0]] != COLUMNS:
        return [], 'no findings table with the columns ' + ' | '.join(name.capitalize() for name in COLUMNS)
    findings = []
    for number, row in enumerate(docmd.records_in(body), 1):
        severity, category = row.get('severity', '').strip().lower(), row.get('category', '').strip().lower()
        if severity not in SEVERITIES:
            return [], f'row {number}: severity "{row.get("severity", "")}" is not one of {", ".join(SEVERITIES)}'
        if category not in CATEGORIES:
            return [], f'row {number}: category "{row.get("category", "")}" is not one of {", ".join(CATEGORIES)}'
        findings.append({'severity': severity, 'document': docmd.uncode(row.get('document', '')).strip(), 'section': row.get('section', '').strip(), 'category': category,
                         'finding': row.get('finding', '').strip(), 'suggestion': row.get('suggestion', '').strip()})
    if len(findings) > MAX_FINDINGS:
        return [], f'more than {MAX_FINDINGS} findings'
    return findings, None


def counted(entry):
    for severity, name in (('blocker', 'blockers'), ('major', 'majors'), ('minor', 'minors')):
        entry[name] = sum(1 for f in entry['findings'] if f['severity'] == severity)
    return entry


def read_note(root, app, unit_key):
    """{'unit', 'reviewed', 'error', 'blockers', 'majors', 'minors', 'findings'} for one unit."""
    entry = {'unit': f'{app}/{unit_key}', 'reviewed': False, 'error': None, 'blockers': 0, 'majors': 0, 'minors': 0, 'findings': []}
    findings, error = read_table(os.path.join(root, *paths.design_review_path(app, unit_key).split('/')), 'no review note')
    if error is not None:
        entry['error'] = error
        return entry
    entry['reviewed'] = True
    entry['findings'] = [{**f, 'source': 'review', 'fingerprint': fingerprint(unit_key, f), 'status': 'open'} for f in findings]
    return counted(entry)


def unit_of_document(app, document):
    """The unit key a document-repository path of a unit's design belongs to, or None."""
    prefix = paths.modern_dir(app) + '/'
    if not document.startswith(prefix):
        return None
    parts = document[len(prefix):].split('/')
    return f'{parts[0]}/{parts[1]}' if len(parts) > 2 and paths.is_unit_segment(parts[0]) and paths.is_unit_segment(parts[1]) else None


def read_contract(root, app, cluster, keys):
    """{'cluster', 'units', 'reviewed', 'error', 'findings'} of one cluster; each finding carries the `unit` it belongs to."""
    entry = {'cluster': cluster['id'], 'units': cluster['units'], 'reviewed': False, 'error': None, 'findings': []}
    findings, error = read_table(os.path.join(root, *paths.design_contract_path(app, cluster['id']).split('/')), 'no contract note')
    if error is None:
        for number, finding in enumerate(findings, 1):
            unit = unit_of_document(app, finding['document'])
            if unit is None or unit not in keys:
                error = f'row {number}: the document "{finding["document"]}" is not a document of a unit of this run; name the document of the run that has to change'
                break
            entry['findings'].append({**finding, 'unit': unit, 'source': 'contract', 'fingerprint': fingerprint(unit, finding), 'status': 'open'})
    if error is not None:
        entry['error'] = error
        entry['findings'] = []
        return entry
    entry['reviewed'] = True
    return entry


def read_clusters(root, app):
    path = os.path.join(root, *paths.design_map_path(app).split('/'))
    if not os.path.isfile(path):
        return []
    try:
        data = docmd.read_json(path)
    except (docmd.DataError, OSError):
        return []
    clusters = data.get('clusters') if isinstance(data, dict) else None
    return [c for c in clusters if isinstance(c, dict) and isinstance(c.get('id'), str) and isinstance(c.get('units'), list)] if isinstance(clusters, list) else []


def structural_units(root, app, relative, keys):
    """The units of `keys` (`<module>/<unit>`) whose design check still fails in the report at `relative`."""
    if relative is None:
        return []
    path = os.path.join(root, *relative.split('/'))
    if not os.path.isfile(path):
        return []
    try:
        data = docmd.read_json(path)
    except (docmd.DataError, OSError):
        return []
    prefix = f'{app}/'
    return sorted(e['unit'][len(prefix):] for e in (data.get('units', []) if isinstance(data, dict) else [])
                  if isinstance(e, dict) and e.get('ok') is False and isinstance(e.get('unit'), str) and e['unit'].startswith(prefix) and e['unit'][len(prefix):] in keys)


def read_history(root, relative):
    if relative is None:
        return []
    path = os.path.join(root, *relative.split('/'))
    if not os.path.isfile(path):
        return []
    try:
        data = docmd.read_json(path)
    except (docmd.DataError, OSError):
        return []
    rounds = data.get('rounds') if isinstance(data, dict) else None
    return [r for r in rounds if isinstance(r, dict) and isinstance(r.get('open'), int)] if isinstance(rounds, list) else []


def build(root, app, keys, design_report=None, history=None):
    units = {key: read_note(root, app, key) for key in keys}
    clusters = [read_contract(root, app, cluster, set(keys)) for cluster in read_clusters(root, app)]
    for cluster in clusters:
        for finding in cluster['findings']:
            entry = units[finding['unit']]
            entry['findings'].append({k: v for k, v in finding.items() if k != 'unit'})
    for entry in units.values():
        counted(entry)
    structural = structural_units(root, app, design_report, set(keys))
    open_fingerprints = sorted(f['fingerprint'] for e in units.values() for f in e['findings'] if f['severity'] in ('blocker', 'major'))
    fix = sorted(set(structural) | {key for key in keys if units[key]['blockers'] + units[key]['majors'] > 0})
    blockers, majors = sum(e['blockers'] for e in units.values()), sum(e['majors'] for e in units.values())
    minors = sum(e['minors'] for e in units.values())
    unreviewed = sorted(key for key in keys if not units[key]['reviewed'])
    missing_clusters = sorted(cluster['cluster'] for cluster in clusters if not cluster['reviewed'])
    # A note that could not be read is a review that did not happen: it stays open so the next round asks again, and a reviewer
    # that never produces a usable note ends the loop as a stall, not as a clean design.
    open_count = blockers + majors + len(structural) + len(unreviewed) + len(missing_clusters)
    rounds = read_history(root, history)
    previous = rounds[-1] if rounds else None
    improved = previous is None or open_count < min(r['open'] for r in rounds)
    streak = 0 if improved else int(previous.get('streak', 0)) + 1
    if previous is not None and not improved and open_fingerprints == previous.get('fingerprints'):
        streak = max(streak, 2)
    resolved = len(set(previous.get('fingerprints', [])) - set(open_fingerprints)) if previous else 0
    resolved_total = (int(previous.get('resolvedTotal', 0)) if previous else 0) + resolved
    number = len(rounds) + 1
    report = {'round': number, 'open': open_count, 'blockers': blockers, 'majors': majors, 'minors': minors, 'structural': len(structural),
              'stalled': open_count > 0 and streak >= 2, 'streak': streak, 'resolved': resolved, 'resolvedTotal': resolved_total, 'fix': fix,
              'unreviewed': unreviewed, 'rereview': sorted(set(fix) | set(unreviewed)), 'unreviewedClusters': missing_clusters,
              'units': [units[key] for key in keys], 'clusters': clusters}
    record = {'round': number, 'open': open_count, 'streak': streak, 'fingerprints': open_fingerprints, 'fix': fix, 'resolvedTotal': resolved_total}
    return report, record, rounds


def main(argv=None):
    parser = argparse.ArgumentParser(description="Read the reviewers' notes of a design run and report their findings.")
    parser.add_argument('app', help='application id (kebab-case)')
    parser.add_argument('unit', help='the unit, as <module>/<unit> (or @app); several, comma-separated')
    parser.add_argument('--root', default='.', metavar='DIR', help='the stage inputs (default: the working directory)')
    parser.add_argument('--report', metavar='FILE', help='also write the JSON report to this file')
    parser.add_argument('--json', action='store_true', help='print the report as JSON')
    parser.add_argument('--design-report', metavar='PATH', help='the check report of the design (a path under --root): units that still fail it count as open')
    parser.add_argument('--history', metavar='PATH', help='the rounds so far (a path under --root), to tell progress from a stall')
    parser.add_argument('--history-out', metavar='FILE', help='write the rounds so far, with this one added, to this file')
    args = parser.parse_args(argv)
    if not APP.match(args.app):
        print('check_review.py: the application must be a kebab-case id', file=sys.stderr)
        return 2
    root = os.path.realpath(args.root)
    if not os.path.isdir(root):
        print('check_review.py: --root must be an existing directory', file=sys.stderr)
        return 2
    keys = [key.strip() for key in args.unit.split(',') if key.strip()]
    if not keys or any(not UNIT_KEY.match(key) for key in keys):
        print('check_review.py: name units as <module>/<unit>, or @app', file=sys.stderr)
        return 2
    for relative in (args.design_report, args.history):
        if relative is not None and (relative.startswith('/') or '..' in relative.split('/')):
            print('check_review.py: --design-report and --history are paths under --root', file=sys.stderr)
            return 2
    report, record, rounds = build(root, args.app, keys, args.design_report, args.history)
    if args.report is not None:
        docmd.write_text(os.path.abspath(args.report), json.dumps(report, indent=1, ensure_ascii=False))
    if args.history_out is not None:
        docmd.write_text(os.path.abspath(args.history_out), json.dumps({'rounds': [*rounds, record][-MAX_ROUNDS_KEPT:]}, indent=1, ensure_ascii=False))
    if args.json:
        print(json.dumps(report, indent=1, ensure_ascii=False))
    else:
        for entry in report['units']:
            state = f'{entry["blockers"]} blocker(s), {entry["majors"]} major(s), {entry["minors"]} minor(s)' if entry['reviewed'] else f'not reviewed: {entry["error"]}'
            print(f'{entry["unit"]}: {state}')
        for cluster in report['clusters']:
            state = f'{len(cluster["findings"])} finding(s)' if cluster['reviewed'] else f'not reviewed: {cluster["error"]}'
            print(f'cluster {cluster["cluster"]} ({", ".join(cluster["units"])}): {state}')
        print(f'round {report["round"]}: {report["open"]} open' + (' (stalled)' if report['stalled'] else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
