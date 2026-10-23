"""Tests for the review scripts of a design run (ADR-0054): check_review and render_design_review.

Run:  python -m pytest packages/agents/builtin/plugins/design/scripts/tests/test_design_review.py
"""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import check_review as cr  # noqa: E402
import paths  # noqa: E402
import render_design_review as rr  # noqa: E402

NOTE = """---
unit: "payroll/run-period"
---
# Review of payroll/run-period

| Severity | Document | Section | Category | Finding | Suggestion |
| --- | --- | --- | --- | --- | --- |
| minor | logic.md | Error handling | clarity | The message of ERR-0001 is not worded. | Write the text. |
| blocker | logic.md | Business rules | fidelity | RULE-004 is in the specification but no row applies it. | Add a row with the fee formula. |
| major | logic.md | Business rules | coverage | R-002 says "as the legacy code" \\| nothing more. | State the rounding. |
"""

CLEAN = "---\nunit: \"payroll/close-period\"\n---\n# Review\n\n| Severity | Document | Section | Category | Finding | Suggestion |\n| --- | --- | --- | --- | --- | --- |\n"


def run(fn, argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = fn(argv)
    return code, out.getvalue(), err.getvalue()


class Repo(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)

    def put(self, relative, text):
        path = os.path.join(self.root, *relative.split('/'))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8', newline='\n') as handle:
            handle.write(text)

    def note(self, key, text):
        self.put(paths.design_review_path('billing', key), text)


class CheckReview(Repo):
    def test_a_note_is_read_into_counts_and_findings(self):
        self.note('payroll/run-period', NOTE)
        entry = cr.read_note(self.root, 'billing', 'payroll/run-period')
        self.assertEqual((entry['reviewed'], entry['error'], entry['blockers'], entry['majors'], entry['minors']), (True, None, 1, 1, 1))
        self.assertEqual(entry['unit'], 'billing/payroll/run-period')
        self.assertEqual(entry['findings'][1]['finding'], 'RULE-004 is in the specification but no row applies it.')
        self.assertIn('|', entry['findings'][2]['finding'])

    def test_an_empty_table_is_a_review_with_no_finding(self):
        self.note('payroll/close-period', CLEAN)
        entry = cr.read_note(self.root, 'billing', 'payroll/close-period')
        self.assertEqual((entry['reviewed'], entry['findings']), (True, []))

    def test_a_note_that_does_not_parse_is_not_reviewed_never_clean(self):
        self.assertEqual(cr.read_note(self.root, 'billing', 'payroll/none')['error'], 'no review note')
        self.note('payroll/a', '# nothing here\n')
        self.assertIn('no findings table', cr.read_note(self.root, 'billing', 'payroll/a')['error'])
        self.note('payroll/b', NOTE.replace('| blocker |', '| critical |'))
        entry = cr.read_note(self.root, 'billing', 'payroll/b')
        self.assertEqual((entry['reviewed'], entry['findings']), (False, []))
        self.assertIn('severity "critical"', entry['error'])
        self.note('payroll/c', NOTE.replace('| fidelity |', '| taste |'))
        self.assertIn('category "taste"', cr.read_note(self.root, 'billing', 'payroll/c')['error'])

    def test_the_command_line_writes_the_report_and_exits_zero_whatever_the_notes_say(self):
        self.note('payroll/run-period', NOTE)
        report = os.path.join(self.root, 'out', 'review-report.json')
        code, out, _ = run(cr.main, ['billing', 'payroll/run-period,payroll/none', '--root', self.root, '--report', report])
        self.assertEqual(code, 0)
        self.assertIn('billing/payroll/run-period: 1 blocker(s), 1 major(s), 1 minor(s)', out)
        self.assertIn('billing/payroll/none: not reviewed: no review note', out)
        with open(report, encoding='utf-8') as handle:
            self.assertEqual([entry['reviewed'] for entry in json.load(handle)['units']], [True, False])
        for argv in (['Billing', 'a/b'], ['billing', 'not a key'], ['billing', ',']):
            self.assertEqual(run(cr.main, argv + ['--root', self.root])[0], 2, argv)


class Render(Repo):
    def reports(self, check_units, review_units):
        self.put(paths.design_report_path('billing'), json.dumps({'units': check_units, 'ok': True}))
        self.put(paths.design_review_report_path('billing'), json.dumps({'units': review_units}))

    def test_the_summary_gives_each_unit_a_state_and_lists_what_is_open(self):
        self.note('payroll/run-period', NOTE)
        self.note('payroll/close-period', CLEAN)
        self.note('payroll/audit', CLEAN)
        review = [cr.read_note(self.root, 'billing', key) for key in ('payroll/run-period', 'payroll/close-period', 'payroll/audit', 'payroll/lost')]
        failing = {'path': 'logic.md', 'required': True, 'state': 'problems', 'problems': [{'code': 'placeholder', 'section': 'Business rules', 'message': 'unfinished text left: TODO'}]}
        self.reports([
            {'unit': 'billing/payroll/run-period', 'kind': 'screen', 'ok': True, 'sets': []},
            {'unit': 'billing/payroll/close-period', 'kind': 'batch-job', 'ok': True, 'sets': []},
            {'unit': 'billing/payroll/audit', 'kind': 'screen', 'ok': False, 'sets': [{'set': 'detail', 'files': [failing]}]},
            {'unit': 'billing/payroll/lost', 'error': 'no card', 'ok': False},
        ], review)
        out = os.path.join(self.root, 'review.md')
        code, _, _ = run(rr.main, ['billing', 'payroll/run-period,payroll/close-period,payroll/audit,payroll/lost', '--set', 'detail', '--root', self.root, '--out', out])
        self.assertEqual(code, 0)
        with open(out, encoding='utf-8') as handle:
            text = handle.read()
        self.assertIn('4 unit(s): 1 ready, 1 ready with findings, 2 incomplete.', text)
        self.assertIn('| payroll/run-period | screen | ready-with-findings | 1 | 1 | 1 |', text)
        self.assertIn('| payroll/close-period | batch-job | ready | 0 | 0 | 0 |', text)
        self.assertIn('| payroll/audit | screen | incomplete | 0 | 0 | 0 |', text)
        self.assertIn('| payroll/lost | - | incomplete | - | - | - |', text)
        self.assertIn('Not reviewed: no review note.', text)
        self.assertIn('- detail/logic.md: [Business rules] unfinished text left: TODO', text)
        # The blocker is listed before the major and the minor.
        self.assertLess(text.index('| blocker |'), text.index('| major |'))
        self.assertLess(text.index('| major |'), text.index('| minor |'))
        self.assertNotIn('### payroll/close-period', text)

    def test_a_missing_report_is_not_an_error_the_units_are_incomplete(self):
        out = os.path.join(self.root, 'review.md')
        self.assertEqual(run(rr.main, ['billing', 'payroll/run-period', '--set', 'detail', '--root', self.root, '--out', out])[0], 0)
        with open(out, encoding='utf-8') as handle:
            self.assertIn('0 ready, 0 ready with findings, 1 incomplete', handle.read())

    def test_input_that_cannot_be_used_exits_two(self):
        out = os.path.join(self.root, 'review.md')
        self.assertEqual(run(rr.main, ['Billing', 'a/b', '--set', 'detail', '--root', self.root, '--out', out])[0], 2)
        self.assertEqual(run(rr.main, ['billing', ',', '--set', 'detail', '--root', self.root, '--out', out])[0], 2)


if __name__ == '__main__':
    unittest.main()
