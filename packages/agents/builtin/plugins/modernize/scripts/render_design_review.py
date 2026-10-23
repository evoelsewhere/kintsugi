#!/usr/bin/env python3
"""Write the review of a design run, the description of its pull request (ADR-0054).

    python3 render_design_review.py <app> <module/unit | @app>[,...] --set SET [--root DIR] --out FILE

Reads, under --root (the stage inputs), the check report of the run (`scratch/<app>/design/report.json`, written by
`check_design.py --report`) and the reviewer's findings (`scratch/<app>/design/review-report.json`, by `check_review.py`), and writes a
Markdown summary: the state of each unit, then the findings still open for a person, the largest first.

A unit is
  ready                 the final check passes and the review found nothing;
  ready-with-findings   the final check passes and the review reported findings: the blockers and majors went to the designer's fix
                        round and are not reviewed again, the minors are left for the person;
  incomplete            the final check does not pass, or the unit was not reviewed.

The exit code is 0, or 2 for input that cannot be used. Standard library only.
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
SET_ID = re.compile(r'^[a-z0-9][a-z0-9_-]{0,62}$')
RANK = {'blocker': 0, 'major': 1, 'minor': 2}
MAX_ROWS_PER_UNIT = 25
MAX_PROBLEMS_PER_UNIT = 6


def cell(value):
    """One table cell: one line, pipes escaped."""
    return re.sub(r'\s+', ' ', str(value)).replace('|', '\\|').strip()


def read_report(root, relative):
    path = os.path.join(root, *relative.split('/'))
    if not os.path.isfile(path):
        return {}
    try:
        data = docmd.read_json(path)
    except (docmd.DataError, OSError):
        return {}
    return {entry.get('unit'): entry for entry in data.get('units', []) if isinstance(entry, dict)} if isinstance(data, dict) else {}


def state_of(check, review):
    if review is None or not review.get('reviewed') or check is None or check.get('ok') is not True:
        return 'incomplete'
    return 'ready' if not review['findings'] else 'ready-with-findings'


def problems_of(check):
    """['<set>/<file>: <message>'] still open in the final check of a unit."""
    out = []
    for entry in (check or {}).get('sets', []):
        for file in entry.get('files', []):
            if file.get('state') == 'missing' and file.get('required'):
                out.append(f'{entry["set"]}/{file["path"]}: missing')
            for problem in file.get('problems', []):
                where = f'[{problem["section"]}] ' if problem.get('section') else ''
                out.append(f'{entry["set"]}/{file["path"]}: {where}{problem["message"]}')
    return out


def render(app, keys, set_id, root):
    checks = read_report(root, paths.design_report_path(app))
    reviews = read_report(root, paths.design_review_report_path(app))
    rows, sections, totals = [], [], {'ready': 0, 'ready-with-findings': 0, 'incomplete': 0}
    for key in keys:
        name = f'{app}/{key}'
        check, review = checks.get(name), reviews.get(name)
        state = state_of(check, review)
        totals[state] += 1
        counts = (review['blockers'], review['majors'], review['minors']) if review and review.get('reviewed') else ('-', '-', '-')
        rows.append([key, (check or {}).get('kind', '-'), state, *counts])
        lines = []
        if review is None or not review.get('reviewed'):
            lines.append(f'Not reviewed: {cell((review or {}).get("error") or "no review note")}.')
        findings = sorted((review or {}).get('findings', []), key=lambda f: RANK.get(f['severity'], 3))
        if findings:
            shown = findings[:MAX_ROWS_PER_UNIT]
            lines.append(docmd.table(['Severity', 'Document', 'Section', 'Category', 'Finding', 'Suggestion'],
                                     [[f['severity'], f['document'], f['section'], f['category'], f['finding'], f['suggestion']] for f in shown]).rstrip('\n'))
            if len(findings) > len(shown):
                lines.append(f'... and {len(findings) - len(shown)} more finding(s) not listed.')
        open_problems = problems_of(check)
        if check is not None and 'error' in check:
            open_problems = [f'cannot be checked: {check["error"]}']
        if open_problems:
            lines.append('Still failing the template check:')
            lines.extend(f'- {cell(problem)}' for problem in open_problems[:MAX_PROBLEMS_PER_UNIT])
            if len(open_problems) > MAX_PROBLEMS_PER_UNIT:
                lines.append(f'- ... and {len(open_problems) - MAX_PROBLEMS_PER_UNIT} more')
        if lines:
            sections.append(f'### {key}: {state}\n\n' + '\n\n'.join(lines))
    out = [f'## Review of the design run: {set_id}', '',
           f'{len(keys)} unit(s): {totals["ready"]} ready, {totals["ready-with-findings"]} ready with findings, {totals["incomplete"]} incomplete.', '',
           'An independent reviewer read each unit against its specification of the old system (ADR-0054). Blockers and majors were sent to the designer for a fix round; '
           'they are not reviewed again, so read the units with findings first.', '',
           docmd.table(['Unit', 'Kind', 'State', 'Blockers', 'Majors', 'Minors'], rows).rstrip('\n')]
    if sections:
        out += ['', '## Findings', '', *('\n\n'.join(sections).split('\n'))]
    return '\n'.join(out) + '\n'


def main(argv=None):
    parser = argparse.ArgumentParser(description='Write the review of a design run, the description of its pull request.')
    parser.add_argument('app', help='application id (kebab-case)')
    parser.add_argument('unit', help='the units of the run, as <module>/<unit> (or @app), comma-separated')
    parser.add_argument('--set', dest='set_id', required=True, metavar='SET', help='the design set of the run')
    parser.add_argument('--root', default='.', metavar='DIR', help='the stage inputs (default: the working directory)')
    parser.add_argument('--out', required=True, metavar='FILE', help='the summary to write')
    args = parser.parse_args(argv)
    if not APP.match(args.app) or not SET_ID.match(args.set_id):
        print('render_design_review.py: the application and the set must be kebab-case ids', file=sys.stderr)
        return 2
    root = os.path.realpath(args.root)
    if not os.path.isdir(root):
        print('render_design_review.py: --root must be an existing directory', file=sys.stderr)
        return 2
    keys = [key.strip() for key in args.unit.split(',') if key.strip()]
    if not keys:
        print('render_design_review.py: name at least one unit', file=sys.stderr)
        return 2
    try:
        docmd.write_text(os.path.abspath(args.out), render(args.app, keys, args.set_id, root))
    except (docmd.DataError, OSError) as error:
        print(f'render_design_review.py: {error}', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
