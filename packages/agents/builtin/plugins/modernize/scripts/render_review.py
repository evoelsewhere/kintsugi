#!/usr/bin/env python3
"""Write the review of a member's merge request as documents (ADR-0071).

    python3 render_review.py <app> <module/unit>[,...] --manifest FILE [--root DIR] --scratch DIR --out DIR --summary FILE

Reads the manifest (the units and the merge request), the files the merge request changes (`changes.json`) and the findings
of the reviewer's notes (`review-report.json`, written by `check_code_review.py`) from --scratch (`scratch/<app>/build/` of
the stage inputs), and writes, under --out at their document-repository paths, `_build/review.md` for each unit, and to
--summary the description of the pull request on the document repository.

A unit's document has the front matter `unit`, `reviewed`, `blockers`, `majors`, `minors`, the merge request and its commit,
then every finding of the reviewer, largest first. Nothing is resolved here: the reviewer found what it found, and the member
fixes the merge request and asks for another review. A unit the reviewer did not review (no note, or a note that does not read)
says so and is never shown as clean. The documents hold no timestamp, so the same inputs give the same documents. The exit code
is 0, or 2 for input that cannot be used. Standard library only.
"""
import argparse
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_lib as bl  # noqa: E402
import docmd  # noqa: E402
import paths  # noqa: E402

RANK = {'blocker': 0, 'major': 1, 'minor': 2}
MAX_ROWS = 40


def render_unit(key, manifest, review):
    mr = manifest.get('mr', {})
    reviewed = bool(review and review.get('reviewed'))
    findings = sorted((review or {}).get('findings', []), key=lambda f: RANK.get(f['severity'], 3))
    fields = {
        'unit': key,
        'stage': 'review',
        'reviewed': 'true' if reviewed else 'false',
        'blockers': (review or {}).get('blockers', 0),
        'majors': (review or {}).get('majors', 0),
        'minors': (review or {}).get('minors', 0),
        'mr': mr.get('url', ''),
        'commit': mr.get('commit', ''),
    }
    lines = [docmd.front_matter(fields).rstrip('\n'), '', f'# Review: {key}', '']
    if not reviewed:
        lines.append(f'Not reviewed: {docmd.clean_text((review or {}).get("error") or "no review note", 200)}.')
    else:
        lines.append(f'An independent reviewer read the merge request at commit {mr.get("commit", "")[:12]} and reported {fields["blockers"]} blocker(s), {fields["majors"]} major(s) and {fields["minors"]} minor(s).'
                     + (' Fix the blockers and majors in the merge request, then ask for the review again.' if fields['blockers'] or fields['majors'] else ''))
        if findings:
            rows = [[f['severity'], f['file'], f['where'], f['category'], f['finding'], f['suggestion']] for f in findings[:MAX_ROWS]]
            lines += ['', docmd.table(['Severity', 'File', 'Where', 'Category', 'Finding', 'Suggestion'], rows).rstrip('\n')]
            if len(findings) > MAX_ROWS:
                lines.append(f'... and {len(findings) - MAX_ROWS} more finding(s) not listed.')
    return '\n'.join(lines) + '\n', reviewed


def main(argv=None):
    parser = argparse.ArgumentParser(description="Write the review of a member's merge request as documents.")
    parser.add_argument('app', help='application id (kebab-case)')
    parser.add_argument('unit', help='the units, as <module>/<unit>, comma-separated')
    parser.add_argument('--manifest', required=True, metavar='FILE')
    parser.add_argument('--root', default='.', metavar='DIR', help='the stage inputs (default: the working directory)')
    parser.add_argument('--scratch', required=True, metavar='DIR', help='the scratch/<app>/build folder of the stage inputs')
    parser.add_argument('--out', required=True, metavar='DIR', help='the output folder (document-repository paths)')
    parser.add_argument('--summary', required=True, metavar='FILE')
    args = parser.parse_args(argv)
    keys = bl.keys_of(args.unit)
    if not bl.APP.match(args.app) or not keys or any(not bl.UNIT_KEY.match(key) for key in keys):
        print('render_review.py: the application is a kebab-case id and units are named <module>/<unit>', file=sys.stderr)
        return 2
    try:
        manifest = docmd.read_json(os.path.abspath(args.manifest))
    except (docmd.DataError, OSError) as error:
        print(f'render_review.py: {error}', file=sys.stderr)
        return 2
    units = manifest.get('units', {}) if isinstance(manifest, dict) else {}
    scratch = os.path.realpath(args.scratch)
    reviews = bl.by_unit(bl.read_report(os.path.join(scratch, 'review-report.json')))
    changes = bl.read_report(os.path.join(scratch, 'changes.json')) or {}
    rows, counts = [], {}
    for key in keys:
        unit = units.get(key)
        if unit is None or unit.get('error'):
            rows.append([key, 'not reviewed', (unit or {}).get('error', 'not in the manifest'), '-'])
            counts['not reviewed'] = counts.get('not reviewed', 0) + 1
            continue
        text, reviewed = render_unit(key, manifest, reviews.get(key))
        docmd.write_text(os.path.join(os.path.abspath(args.out), *paths.unit_code_review_path(args.app, key).split('/')), text)
        review = reviews.get(key) or {}
        state = 'not reviewed' if not reviewed else ('findings to fix' if review.get('blockers') or review.get('majors') else 'clear')
        rows.append([key, state, f'{review.get("blockers", 0)}/{review.get("majors", 0)}/{review.get("minors", 0)}', len(review.get('findings', []))])
        counts[state] = counts.get(state, 0) + 1
    mr = manifest.get('mr', {})
    summary = ['## Review of a merge request', '', f'Merge request: {mr.get("url", "")} at commit `{mr.get("commit", "")[:12]}`' + (f' (branch `{mr["branch"]}`)' if mr.get('branch') else '') + '.', '',
               f'{len(keys)} unit(s): ' + ', '.join(f'{number} {name}' for name, number in sorted(counts.items())) + '.',
               f'{len(changes.get("files", []))} file(s) changed by the merge request' + (f' ({changes["note"]})' if changes.get('note') else '') + '.', '',
               'An independent reviewer who did not write the code read it against the rules and design of each unit. The member who built it fixes the findings in the merge request and asks for another review.', '',
               docmd.table(['Unit', 'State', 'Blockers/majors/minors', 'Findings'], rows).rstrip('\n')]
    docmd.write_text(os.path.abspath(args.summary), '\n'.join(summary) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
