#!/usr/bin/env python3
"""Write the review of a design run, the description of its pull request (ADR-0054).

    python3 render_design_review.py <app> <module/unit | @app>[,...] --set SET [--root DIR] --out FILE

Reads, under --root (the stage inputs), the check report of the run (`scratch/<app>/design/report.json`, written by
`check_design.py --report`), the findings of the last review round (`scratch/<app>/design/review-report.json`, by `check_review.py`: the
reviewers' and the contract reviewer's) and, when they exist, the requirement coverage (`coverage.json`), and writes a Markdown summary:
how the verify loop ended (ADR-0083), the state of each unit, then the findings still open for a person, the largest first.

A unit is
  ready                 the final check passes and the review found nothing;
  ready-with-findings   the final check passes and the last review round still reported findings (the minors a person reads, or
                        the blockers and majors a stalled or interrupted loop could not clear);
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


def read_top(root, relative):
    """The report as a whole (not per unit): {} when it is missing or unreadable."""
    path = os.path.join(root, *relative.split('/'))
    if not os.path.isfile(path):
        return {}
    try:
        data = docmd.read_json(path)
    except (docmd.DataError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def loop_lines(top):
    """How the verify loop ended, as plain sentences for the pull request."""
    if not top or not isinstance(top.get('round'), int):
        return []
    rounds = top['round']
    fixed = top.get('resolvedTotal', 0)
    if top.get('open', 0) == 0:
        end = f'The last review round ({rounds}) found no blocker, no major and no failing check: the design was verified after its fixes.'
    elif top.get('stalled'):
        end = f'The loop stopped after round {rounds}: the same {top.get("open")} blocker(s), major(s) or failing check(s) came back without improvement. A person has to decide them.'
    else:
        end = f'The loop stopped after round {rounds} with {top.get("open")} blocker(s), major(s) or failing check(s) open (the stage budget ran out or the run was interrupted); the last fix was not reviewed again.'
    lines = [end]
    if fixed:
        lines.append(f'{fixed} finding(s) were fixed and checked again during the run.')
    return lines


def coverage_lines(report):
    if not report or not isinstance(report.get('total'), int) or report['total'] == 0:
        return []
    uncovered = [str(ident) for ident in report.get('uncovered', [])]
    lines = ['', '## Requirement coverage', '',
             f'{report.get("covered", 0)} of {report["total"]} requirement(s) are referred to by a design of the set "{report.get("set", "")}", counting the merged designs and this run. '
             'A requirement a later unit will take shows as not covered until then.']
    if uncovered:
        lines += ['', 'Not referred to yet: ' + ', '.join(f'`{cell(ident)}`' for ident in uncovered[:30]) + (f' and {len(uncovered) - 30} more.' if len(uncovered) > 30 else '.')]
    return lines


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
    top = read_top(root, paths.design_review_report_path(app))
    covered = read_top(root, paths.design_coverage_path(app))
    manifest = {}
    try:
        manifest = docmd.read_json(os.path.join(root, *paths.design_manifest_path(app).split('/')))
    except (docmd.DataError, OSError):
        pass
    entries = manifest.get('units', {}) if isinstance(manifest, dict) else {}
    rows, sections, totals = [], [], {'ready': 0, 'ready-with-findings': 0, 'incomplete': 0, 'draft': 0}
    for key in keys:
        name = f'{app}/{key}'
        check, review = checks.get(name), reviews.get(name)
        draft = entries.get(key, {}).get('draft') is True
        state = 'draft' if draft else state_of(check, review)
        totals[state] += 1
        counts = (review['blockers'], review['majors'], review['minors']) if review and review.get('reviewed') else ('-', '-', '-')
        rows.append([key, (check or {}).get('kind', '-'), state, *counts])
        lines = []
        if draft:
            lines.append('**Draft only.** Resolve and merge the input evidence, then regenerate a final design. This design does not satisfy downstream prerequisites.')
            lines.extend('- ' + cell(reason) for reason in entries.get(key, {}).get('blockers', []))
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
           'An independent reviewer read each unit against its specification of the old system, and a contract reviewer read the units that share interfaces together '
           '(ADR-0054, ADR-0083). Blockers and majors went to the designer and the fixed units were reviewed again, round after round.',
           *(['', *loop_lines(top)] if loop_lines(top) else []), '',
           docmd.table(['Unit', 'Kind', 'State', 'Blockers', 'Majors', 'Minors'], rows).rstrip('\n')]
    if sections:
        out += ['', '## Findings', '', *('\n\n'.join(sections).split('\n'))]
    out += coverage_lines(covered)
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
