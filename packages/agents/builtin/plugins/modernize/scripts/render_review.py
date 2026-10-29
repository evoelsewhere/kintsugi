#!/usr/bin/env python3
"""Write the review of a member's merge request as documents (ADR-0071).

    python3 render_review.py <app> <module/unit>[,...] --manifest FILE [--root DIR] --scratch DIR --out DIR --summary FILE

Reads the manifest (the units and the merge request), the files the merge request changes (`changes.json`), the findings
of the reviewer's notes (`review-report.json`, written by `check_code_review.py`) and the parity of the merge request with the
rules (`parity.json`, written by `parity.py`, ADR-0088) from --scratch (`scratch/<app>/build/` of the stage inputs), and writes, under --out at their document-repository paths, `_build/review.md` for each unit, and to
--summary the description of the pull request on the document repository.

A unit's document has the front matter `unit`, `reviewed`, `blockers`, `majors`, `minors`, the merge request and its commit,
and `parity` with the number of rules and of those at each level, then every finding of the reviewer, largest first, then the
parity table: per rule, the changed files that name it, what the member's run reported and what the reviewer disputes. Nothing is resolved here: the reviewer found what it found, and the member
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
MAX_RULE_ROWS = 200
PARITY_NOTE = {
    'reported': 'every rule is named by the code and by a test, and the member reported its tests passed',
    'partial': 'some rules are not named by both the code and a test, not reported passing, or disputed',
    'none': 'no rule is named by both the code and a test of the merge request',
    'unknown': 'the files the merge request changes are not known, so the parity was not read',
}


def files_cell(names):
    if not names:
        return '-'
    return ', '.join(f'`{name}`' for name in names[:3]) + (f' +{len(names) - 3}' if len(names) > 3 else '')


def parity_section(parity, report):
    """The parity of the unit with its rules (ADR-0088): what each level rests on, then one row per rule."""
    tests = report.get('tests') or {}
    run = f"The member's command reported {tests['cases']} case(s), {tests.get('failed', 0)} failed" if 'cases' in tests else "The member's command reported no test counts"
    if 'rulesPassed' in tests or 'rulesFailed' in tests:
        run += f", with the tests of {len(tests.get('rulesPassed') or [])} rule(s) passing and {len(tests.get('rulesFailed') or [])} failing."
    else:
        run += ', and no result per rule.'
    lines = ['', '## Parity with the rules', '',
             f"Parity: **{parity['verdict']}**: {PARITY_NOTE.get(parity['verdict'], '')}. Kintsugi ran nothing: the code and tests columns are the changed "
             "files that name the rule at the reviewed commit, the member's run is their report, and a blocker or major of the reviewer that names a rule disputes it.",
             '', run]
    legacy = report.get('legacy') or {}
    if 'legacyCases' in legacy:
        lines.append(f"The member also reported {legacy['legacyCases']} case(s) run on both the legacy system and the new code, "
                     f"{legacy.get('legacyMatched', 'an unknown number of them')} with the same result.")
    rules = parity.get('rules', [])
    if rules:
        rows = [[rule['id'], rule['name'], rule['level'], files_cell(rule['code']), files_cell(rule['tests']), rule['reported'] or '-', ', '.join(rule['reviewer']) or '-']
                for rule in rules[:MAX_RULE_ROWS]]
        lines += ['', docmd.table(['Rule', 'Name', 'Level', 'Code', 'Tests', "Member's run", 'Reviewer'], rows).rstrip('\n')]
        if len(rules) > MAX_RULE_ROWS:
            lines.append(f'... and {len(rules) - MAX_RULE_ROWS} more rule(s) not listed.')
    return lines


def render_unit(key, manifest, review, report=None):
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
    parity = ((report or {}).get('units') or {}).get(key)
    if parity is not None:
        fields.update({'parity': parity['verdict'], 'parityRules': len(parity['rules']), **{f'parity{level.capitalize()}': count for level, count in parity['counts'].items()}})
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
    if parity is not None:
        lines += parity_section(parity, report)
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
    parity = bl.read_report(os.path.join(scratch, 'parity.json'))
    rows, counts = [], {}
    for key in keys:
        unit = units.get(key)
        if unit is None or unit.get('error'):
            rows.append([key, 'not reviewed', (unit or {}).get('error', 'not in the manifest'), '-', '-'])
            counts['not reviewed'] = counts.get('not reviewed', 0) + 1
            continue
        text, reviewed = render_unit(key, manifest, reviews.get(key), parity)
        docmd.write_text(os.path.join(os.path.abspath(args.out), *paths.unit_code_review_path(args.app, key).split('/')), text)
        review = reviews.get(key) or {}
        state = 'not reviewed' if not reviewed else ('findings to fix' if review.get('blockers') or review.get('majors') else 'clear')
        rows.append([key, state, f'{review.get("blockers", 0)}/{review.get("majors", 0)}/{review.get("minors", 0)}', len(review.get('findings', [])),
                     (((parity or {}).get('units') or {}).get(key) or {}).get('verdict', '-')])
        counts[state] = counts.get(state, 0) + 1
    mr = manifest.get('mr', {})
    summary = ['## Review of a merge request', '', f'Merge request: {mr.get("url", "")} at commit `{mr.get("commit", "")[:12]}`' + (f' (branch `{mr["branch"]}`)' if mr.get('branch') else '') + '.', '',
               f'{len(keys)} unit(s): ' + ', '.join(f'{number} {name}' for name, number in sorted(counts.items())) + '.',
               f'{len(changes.get("files", []))} file(s) changed by the merge request' + (f' ({changes["note"]})' if changes.get('note') else '') + '.', '',
               'An independent reviewer who did not write the code read it against the rules and design of each unit. The member who built it fixes the findings in the merge request and asks for another review.', '',
               docmd.table(['Unit', 'State', 'Blockers/majors/minors', 'Findings', 'Parity'], rows).rstrip('\n')]
    docmd.write_text(os.path.abspath(args.summary), '\n'.join(summary) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
