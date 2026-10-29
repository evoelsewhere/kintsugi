#!/usr/bin/env python3
"""The parity of a reviewed merge request with the rules of its units (ADR-0088).

    python3 parity.py --manifest FILE --changes FILE --report FILE --tobe DIR [--tests JSON] --out FILE

For every rule of every unit of the manifest, what supports the claim that the new code does what the rule says, each at its
own level of evidence, and never more than it shows:

- **code** and **tests**: the files the merge request changes (`changes.json`) that name the rule id: code files, where the
  build method has the code say which rule it decides, and test files, where a test names the rule it checks. Read by this
  script at the reviewed commit (`--tobe`, the target repository's checkout): static, nothing was run.
- **member's run**: what the member's `build` command reported of its test run at that commit (`--tests`, the run's
  `scope.mr.tests`): the rules whose tests passed or failed (`rulesPassed` `["*"]`: every rule a test names passed, except
  the failed ones). Kintsugi ran none of it.
- **reviewer**: the blockers and majors of the independent review (`review-report.json`) that name the rule.

A rule's level is the strongest that holds, a contradiction first: `failed` (the member reported a failing test), `disputed`
(a blocker or major of the reviewer names it), `reported` (named in code and tests, and the member reported its tests passed),
`static` (named in code and tests), `untested` (in code only), `missing` (no changed file names it). A unit is `reported` only
when every rule is; `partial` when some rule is at least `static`; `none` otherwise; `unknown` when the changed files are not
known. The legacy comparison the member reported (`legacyCases`, `legacyMatched`) is kept as it came. Writes the JSON report to
--out (scratch). The exit code is 0, or 2 for input that cannot be used. Standard library only.
"""
import argparse
import json
import os
import re
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_lib as bl  # noqa: E402
import docmd  # noqa: E402

# A test file, by its path. Keep in sync with classifyItem in packages/domain/src/catalog.ts (and plan_graph.py's TEST_PATH).
TEST_PATH = re.compile(r'(^|/)(tests?|__tests__|spec|specs|testing|testdata|fixtures)/|\.(test|spec)\.[a-z0-9]+$|(Tests?|IT)\.(java|kt|cs|scala|groovy)$|_test\.(go|py|rb|rs)$|(^|/)test_[^/]+\.py$', re.IGNORECASE)
MAX_FILE_BYTES = 2 * 1024 * 1024
LEVELS = ('failed', 'disputed', 'reported', 'static', 'untested', 'missing')
DISPUTING = ('blocker', 'major')


def rule_pattern(rule_id):
    return re.compile(rf'(?<![A-Za-z0-9._-]){re.escape(rule_id)}(?![A-Za-z0-9_-])')


def changed_texts(tobe, changes):
    """{path: text} of the files the merge request adds or modifies, read at the reviewed commit (binary and large ones skipped)."""
    texts = {}
    for entry in changes.get('files', []):
        if not isinstance(entry, dict) or entry.get('status') == 'D' or not isinstance(entry.get('path'), str):
            continue
        path = os.path.realpath(os.path.join(tobe, *entry['path'].split('/')))
        if not path.startswith(os.path.realpath(tobe) + os.sep) or not os.path.isfile(path) or os.path.getsize(path) > MAX_FILE_BYTES:
            continue
        with open(path, 'rb') as handle:
            data = handle.read()
        if b'\0' in data[:8192]:
            continue
        texts[entry['path']] = data.decode('utf-8', errors='replace')
    return texts


def level_of(rule):
    if rule['reported'] == 'failed':
        return 'failed'
    if rule['reviewer']:
        return 'disputed'
    if rule['code'] and rule['tests']:
        return 'reported' if rule['reported'] == 'passed' else 'static'
    return 'untested' if rule['code'] else 'missing'


ALL_TESTED = '*'


def unit_parity(entry, texts, known, tests, review):
    passed, failed = set(tests.get('rulesPassed') or []), set(tests.get('rulesFailed') or [])
    findings = [finding for finding in (review or {}).get('findings', []) if finding.get('severity') in DISPUTING]
    rules = []
    for rule in entry.get('rules', []):
        rule_id = rule.get('id', '')
        pattern = rule_pattern(rule_id)
        named = sorted(path for path, text in texts.items() if pattern.search(text))
        row = {
            'id': rule_id,
            'name': docmd.clean_text(rule.get('name'), 120),
            'code': [path for path in named if not TEST_PATH.search(path)],
            'tests': [path for path in named if TEST_PATH.search(path)],
            'reported': None,
            'reviewer': sorted({finding['severity'] for finding in findings if pattern.search(f"{finding.get('finding', '')} {finding.get('suggestion', '')} {finding.get('where', '')}")}),
        }
        if rule_id in failed:
            row['reported'] = 'failed'
        elif rule_id in passed or (ALL_TESTED in passed and row['tests']):
            row['reported'] = 'passed'
        row['level'] = level_of(row)
        rules.append(row)
    counts = {level: sum(1 for rule in rules if rule['level'] == level) for level in LEVELS}
    if not known:
        verdict = 'unknown'
    elif rules and counts['reported'] == len(rules):
        verdict = 'reported'
    elif counts['reported'] + counts['static'] > 0:
        verdict = 'partial'
    else:
        verdict = 'none'
    return {'verdict': verdict, 'counts': counts, 'rules': rules}


def parity(manifest, changes, review_report, tobe, tests):
    texts = changed_texts(tobe, changes) if tobe else {}
    known = bool(changes.get('files'))
    reviews = bl.by_unit(review_report)
    units = {key: unit_parity(entry, texts, known, tests, reviews.get(key))
             for key, entry in (manifest.get('units') or {}).items() if isinstance(entry, dict) and not entry.get('error')}
    legacy = {key: tests[key] for key in ('legacyCases', 'legacyMatched') if key in tests}
    return {'commit': (manifest.get('mr') or {}).get('commit', ''), 'filesKnown': known, 'note': changes.get('note', ''), 'tests': tests, 'legacy': legacy, 'units': units}


def main(argv=None):
    parser = argparse.ArgumentParser(description='The parity of a reviewed merge request with the rules of its units.')
    parser.add_argument('--manifest', required=True, metavar='FILE')
    parser.add_argument('--changes', required=True, metavar='FILE')
    parser.add_argument('--report', required=True, metavar='FILE', help='review-report.json, written by check_code_review.py')
    parser.add_argument('--tobe', required=True, metavar='DIR', help='the checkout of the target repository at the reviewed commit')
    parser.add_argument('--tests', default='{}', metavar='JSON', help="what the member's command reported of its test run (scope.mr.tests)")
    parser.add_argument('--out', required=True, metavar='FILE')
    args = parser.parse_args(argv)
    manifest = bl.read_report(os.path.abspath(args.manifest))
    if manifest is None:
        print('parity.py: --manifest is not a readable manifest', file=sys.stderr)
        return 2
    try:
        tests = json.loads(args.tests)
    except json.JSONDecodeError:
        tests = None
    if not isinstance(tests, dict):
        print('parity.py: --tests must be a JSON object', file=sys.stderr)
        return 2
    changes = bl.read_report(os.path.abspath(args.changes)) or {}
    tobe = os.path.realpath(args.tobe) if os.path.isdir(args.tobe) else ''
    report = parity(manifest, changes, bl.read_report(os.path.abspath(args.report)), tobe, tests)
    docmd.write_text(os.path.abspath(args.out), json.dumps(report, indent=1, ensure_ascii=False))
    for key, unit in report['units'].items():
        counts = unit['counts']
        print(f"{key}: {unit['verdict']} ({', '.join(f'{count} {level}' for level, count in counts.items() if count)})")
    return 0


if __name__ == '__main__':
    sys.exit(main())
