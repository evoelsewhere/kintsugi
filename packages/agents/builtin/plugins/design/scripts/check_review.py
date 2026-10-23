#!/usr/bin/env python3
"""Read the reviewer's notes of a design run and report their findings (ADR-0054).

    python3 check_review.py <app> <module/unit | @app>[,...] [--root DIR] [--report FILE] [--json]

Run from the root of the stage's inputs (or name it with --root). For each unit, the reviewer's note is
`scratch/<app>/design/review/<module>/<unit>.md`: front matter `unit`, and a table with the columns
`Severity | Document | Section | Category | Finding | Suggestion`. A note that is missing or does not parse (no table, other
columns, a severity or category that is not one of the lists below) counts as *not reviewed*, never as clean; an empty table is a
valid review with no finding.

Severities: blocker, major, minor. Categories: fidelity, coverage, consistency, clarity, convention, id.

--report writes the JSON `{"units": [{"unit", "reviewed", "error", "blockers", "majors", "minors", "findings"}]}`. The exit code is 0 whatever the
notes say (the review advises, only the design check can fail a file) and 2 for input that cannot be used. Standard library only.
"""
import argparse
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
CATEGORIES = ('fidelity', 'coverage', 'consistency', 'clarity', 'convention', 'id')
COLUMNS = ['severity', 'document', 'section', 'category', 'finding', 'suggestion']
MAX_FINDINGS = 200


def read_note(root, app, unit_key):
    """{'unit', 'reviewed', 'error', 'blockers', 'majors', 'minors', 'findings'} for one unit."""
    entry = {'unit': f'{app}/{unit_key}', 'reviewed': False, 'error': None, 'blockers': 0, 'majors': 0, 'minors': 0, 'findings': []}
    path = os.path.join(root, *paths.design_review_path(app, unit_key).split('/'))
    if not os.path.isfile(path) or os.path.islink(path):
        entry['error'] = 'no review note'
        return entry
    try:
        text = docmd.read_text(path)
    except (docmd.DataError, OSError) as error:
        entry['error'] = str(error)
        return entry
    _, body = docmd.split_front_matter(text)
    tables = docmd.tables_in(body)
    if not tables or [cell.strip().lower() for cell in tables[0][0]] != COLUMNS:
        entry['error'] = 'no findings table with the columns ' + ' | '.join(name.capitalize() for name in COLUMNS)
        return entry
    findings = []
    for number, row in enumerate(docmd.records_in(body), 1):
        severity, category = row.get('severity', '').strip().lower(), row.get('category', '').strip().lower()
        if severity not in SEVERITIES:
            entry['error'] = f'row {number}: severity "{row.get("severity", "")}" is not one of {", ".join(SEVERITIES)}'
            return entry
        if category not in CATEGORIES:
            entry['error'] = f'row {number}: category "{row.get("category", "")}" is not one of {", ".join(CATEGORIES)}'
            return entry
        findings.append({'severity': severity, 'document': row.get('document', '').strip(), 'section': row.get('section', '').strip(), 'category': category,
                         'finding': row.get('finding', '').strip(), 'suggestion': row.get('suggestion', '').strip()})
    if len(findings) > MAX_FINDINGS:
        entry['error'] = f'more than {MAX_FINDINGS} findings'
        return entry
    entry['reviewed'] = True
    entry['findings'] = findings
    entry['blockers'] = sum(1 for f in findings if f['severity'] == 'blocker')
    entry['majors'] = sum(1 for f in findings if f['severity'] == 'major')
    entry['minors'] = sum(1 for f in findings if f['severity'] == 'minor')
    return entry


def main(argv=None):
    parser = argparse.ArgumentParser(description="Read the reviewer's notes of a design run and report their findings.")
    parser.add_argument('app', help='application id (kebab-case)')
    parser.add_argument('unit', help='the unit, as <module>/<unit> (or @app); several, comma-separated')
    parser.add_argument('--root', default='.', metavar='DIR', help='the stage inputs (default: the working directory)')
    parser.add_argument('--report', metavar='FILE', help='also write the JSON report to this file')
    parser.add_argument('--json', action='store_true', help='print the report as JSON')
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
    report = {'units': [read_note(root, args.app, key) for key in keys]}
    if args.report is not None:
        docmd.write_text(os.path.abspath(args.report), json.dumps(report, indent=1, ensure_ascii=False))
    if args.json:
        print(json.dumps(report, indent=1, ensure_ascii=False))
    else:
        for entry in report['units']:
            state = f'{entry["blockers"]} blocker(s), {entry["majors"]} major(s), {entry["minors"]} minor(s)' if entry['reviewed'] else f'not reviewed: {entry["error"]}'
            print(f'{entry["unit"]}: {state}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
