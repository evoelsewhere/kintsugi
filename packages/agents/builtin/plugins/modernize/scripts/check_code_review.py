#!/usr/bin/env python3
"""Read the reviewer's notes of a build run and report their findings (ADR-0071).

    python3 check_code_review.py <app> <module/unit>[,...] [--root DIR] [--report FILE] [--json]

Run from the root of the stage's inputs (or name it with --root). For each unit the reviewer's note is
`scratch/<app>/build/review/<module>/<unit>.md`. It has the front matter `unit` and a table with the columns
`Severity | File | Where | Category | Finding | Suggestion`. A note that is missing or does not parse (no table, other columns, a
severity or category that is not one of the lists below) counts as *not reviewed*, never as clean; an empty table is a valid
review with no finding.

Severities: blocker, major, minor. Categories: fidelity, tests, failure, design, security.

--report writes the JSON `{"units": [{"unit", "reviewed", "error", "blockers", "majors", "minors", "findings"}]}`. The exit code is 0
whatever the notes say (the review advises) and 2 for input that cannot be used. Standard library only.
"""
import argparse
import json
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_lib as bl  # noqa: E402
import docmd  # noqa: E402
import paths  # noqa: E402

MAX_FINDINGS = 200


def read_note(root, app, key):
    entry = {'unit': f'{app}/{key}', 'reviewed': False, 'error': None, 'blockers': 0, 'majors': 0, 'minors': 0, 'findings': []}
    relative = paths.build_review_note_path(app, key)
    path = bl.doc_path(root, relative)
    if not bl.real_file(path):
        entry['error'] = 'no review note'
        return entry
    try:
        text = docmd.read_text(path)
        front, rows = bl.table_document(text, bl.REVIEW_COLUMNS, 'the review note')
    except (docmd.DataError, OSError) as error:
        entry['error'] = str(error)
        return entry
    if front.get('unit') != key:
        entry['error'] = f'the front matter names unit "{front.get("unit", "")}", expected "{key}"'
        return entry
    findings = []
    for number, row in enumerate(rows, 1):
        severity, category = row.get('severity', '').strip().lower(), row.get('category', '').strip().lower()
        if severity not in bl.SEVERITIES:
            entry['error'] = f'row {number}: severity "{row.get("severity", "")}" is not one of {", ".join(bl.SEVERITIES)}'
            return entry
        if category not in bl.REVIEW_CATEGORIES:
            entry['error'] = f'row {number}: category "{row.get("category", "")}" is not one of {", ".join(bl.REVIEW_CATEGORIES)}'
            return entry
        findings.append({'severity': severity, 'file': bl.plain(row.get('file', '')), 'where': bl.plain(row.get('where', '')), 'category': category,
                         'finding': row.get('finding', '').strip(), 'suggestion': row.get('suggestion', '').strip()})
    if len(findings) > MAX_FINDINGS:
        entry['error'] = f'more than {MAX_FINDINGS} findings'
        return entry
    entry['reviewed'] = True
    entry['findings'] = findings
    for severity, name in (('blocker', 'blockers'), ('major', 'majors'), ('minor', 'minors')):
        entry[name] = sum(1 for finding in findings if finding['severity'] == severity)
    return entry


def main(argv=None):
    parser = argparse.ArgumentParser(description="Read the reviewer's notes of a build run and report their findings.")
    parser.add_argument('app', help='application id (kebab-case)')
    parser.add_argument('unit', help='the units, as <module>/<unit>, comma-separated')
    parser.add_argument('--root', default='.', metavar='DIR', help='the stage inputs (default: the working directory)')
    parser.add_argument('--report', default=None, metavar='FILE')
    parser.add_argument('--json', action='store_true', help='print the report as JSON')
    args = parser.parse_args(argv)
    if not bl.APP.match(args.app):
        print('check_code_review.py: the application must be a kebab-case id', file=sys.stderr)
        return 2
    root = os.path.realpath(args.root)
    if not os.path.isdir(root):
        print('check_code_review.py: --root must be an existing directory', file=sys.stderr)
        return 2
    keys = bl.keys_of(args.unit)
    if not keys or any(not bl.UNIT_KEY.match(key) for key in keys):
        print('check_code_review.py: name units as <module>/<unit>', file=sys.stderr)
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
