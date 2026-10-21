"""Tests for the design-set command lines: scaffold_design, check_design, validate_design_templates.

Run:  python -m pytest packages/agents/builtin/plugins/modernize/scripts/tests/test_design_cli.py
Each test builds a small document repository from the shared fixtures: two sets and one unit with three rules.
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

import check_design as cd  # noqa: E402
import scaffold_design as sd  # noqa: E402
import validate_design_templates as vt  # noqa: E402

FIXTURES = os.path.join(HERE, 'fixtures', 'design')

RULES_MD = """# Rules

### R-001: Total is computed
**Priority:** P0

### R-002: Rounding
**Priority:** P1

### R-003: Date format
**Priority:** P2
"""

UNIT_MD = """---
id: "billing/payroll/run-period"
kind: "screen"
title: "Run period"
---
"""

WAIVED_UNIT_MD = """---
id: "billing/payroll/run-period"
kind: "screen"
title: "Run period"
waived:
  - "basic/functions.md: a single-function screen"
---
"""

FUNCTIONS_OK = """---
template: "basic@3"
---
# Run period: functions

## Functions

| ID | Function | Priority |
| --- | --- | --- |
| F-001 | Compute the total | high |
| F-002 | Print the report | low |
"""


def fixture(*parts):
    with open(os.path.join(FIXTURES, *parts), encoding='utf-8') as handle:
        return handle.read()


def run(fn, argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = fn(argv)
    return code, out.getvalue(), err.getvalue()


class Repo(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        shutil.copytree(os.path.join(FIXTURES, 'sets'), os.path.join(self.root, 'standards', 'design'))
        self.put('kintsugi.yaml', 'unitKinds: [screen, api]\n')
        self.unit = os.path.join('applications', 'billing', 'units', 'payroll', 'run-period')
        self.put(os.path.join(self.unit, 'unit.md'), UNIT_MD)
        self.put(os.path.join(self.unit, 'understanding', 'rules.md'), RULES_MD)

    def put(self, relative, text):
        path = os.path.join(self.root, *relative.split(os.sep))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8', newline='\n') as handle:
            handle.write(text)
        return path

    def read(self, relative):
        with open(os.path.join(self.root, *relative.split(os.sep)), encoding='utf-8') as handle:
            return handle.read()

    def design(self, set_id, name):
        return os.path.join(self.unit, 'design', set_id, name)

    def scaffold(self, *extra):
        return run(sd.main, ['billing', 'payroll/run-period', 'basic', '--root', self.root, *extra])

    def check(self, *extra):
        return run(cd.main, ['billing', 'payroll/run-period', '--root', self.root, *extra])


class Scaffold(Repo):
    def test_it_writes_every_file_of_the_set_with_the_rules_seeded_and_a_todo_in_what_is_left(self):
        code, out, err = self.scaffold()
        self.assertEqual((code, err), (0, ''))
        self.assertIn('created applications/billing/units/payroll/run-period/design/basic/overview.md', out)
        text = self.read(self.design('basic', 'overview.md'))
        self.assertTrue(text.startswith('---\ntemplate: "basic@3"\nunit: "billing/payroll/run-period"\n---\n# Run period: overview\n'))
        self.assertNotIn('<!--', text)
        self.assertNotIn('{{', text)
        self.assertIn('## Purpose\n\nTODO\n', text)
        for rule in ('R-001', 'R-002', 'R-003'):
            self.assertIn('| %s | TODO | TODO |' % rule, text)
        self.assertTrue(os.path.isfile(os.path.join(self.root, self.design('basic', 'functions.md'))))

    def test_a_file_that_exists_is_left_alone_and_one_file_can_be_asked_for(self):
        self.put(self.design('basic', 'overview.md'), 'mine\n')
        code, out, _ = self.scaffold()
        self.assertEqual(code, 0)
        self.assertIn('overview.md exists and was left as it is', out)
        self.assertEqual(self.read(self.design('basic', 'overview.md')), 'mine\n')
        os.remove(os.path.join(self.root, self.design('basic', 'functions.md')))
        code, out, _ = self.scaffold('--file', 'functions.md')
        self.assertIn('created applications/billing/units/payroll/run-period/design/basic/functions.md', out)

    def test_a_set_that_needs_another_says_so_and_input_that_cannot_be_used_exits_two(self):
        code, out, _ = run(sd.main, ['billing', 'payroll/run-period', 'detail', '--root', self.root])
        self.assertEqual(code, 0)
        self.assertIn('the set "basic", which "detail" needs, has no', out)
        for argv in (['billing', 'payroll/run-period', 'nosuch'], ['billing', 'payroll/none', 'basic'], ['Billing', 'payroll/run-period', 'basic'],
                     ['billing', 'payroll/run-period', 'basic', '--file', 'x.md']):
            self.assertEqual(run(sd.main, argv + ['--root', self.root])[0], 2, argv)


class Check(Repo):
    def test_a_fresh_scaffold_is_not_ready_and_a_written_design_is(self):
        self.scaffold()
        code, out, _ = self.check('--set', 'basic')
        self.assertEqual(code, 1)
        self.assertIn('overview.md: 2 problem(s)', out)
        self.assertIn('unfinished text left: TODO', out)
        self.put(self.design('basic', 'overview.md'), fixture('designs', 'basic-overview-ok.md'))
        self.put(self.design('basic', 'functions.md'), FUNCTIONS_OK)
        code, out, _ = self.check('--set', 'basic')
        self.assertEqual((code, out.strip().splitlines()[-1]), (0, 'ok'))

    def test_a_missing_required_file_fails_and_a_waiver_with_a_reason_accepts_it(self):
        self.put(self.design('basic', 'overview.md'), fixture('designs', 'basic-overview-ok.md'))
        code, out, _ = self.check('--set', 'basic')
        self.assertEqual(code, 1)
        self.assertIn('functions.md: missing', out)
        self.put(os.path.join(self.unit, 'unit.md'), WAIVED_UNIT_MD)
        code, out, _ = self.check('--set', 'basic')
        self.assertEqual(code, 0, out)
        self.assertIn('functions.md: waived: a single-function screen', out)

    def test_a_design_of_an_older_version_is_reported_as_stale_not_as_a_fault(self):
        self.put(self.design('basic', 'overview.md'), fixture('designs', 'basic-overview-stale.md'))
        self.put(self.design('basic', 'functions.md'), FUNCTIONS_OK)
        code, out, _ = self.check('--set', 'basic', '--json')
        self.assertEqual(code, 0)
        files = {f['path']: f for f in json.loads(out)['sets'][0]['files']}
        self.assertEqual((files['overview.md']['stale'], files['overview.md']['state']), (True, 'conformant'))

    def test_the_ids_a_design_points_to_come_from_the_repository(self):
        self.put(os.path.join('architecture', 'common', 'COM-LOG-01.md'), '# Logging\n')
        self.put(os.path.join('applications', 'billing', 'to-be', 'requirements.md'), '## REQ-01: Pay\n')
        self.put(self.design('basic', 'functions.md'), FUNCTIONS_OK)
        self.put(self.design('detail', 'logic.md'), fixture('designs', 'detail-ok.md'))
        code, out, _ = self.check('--set', 'detail')
        self.assertEqual(code, 0, out)
        self.put(self.design('detail', 'logic.md'), fixture('designs', 'detail-bad.md'))
        code, out, _ = self.check('--set', 'detail')
        self.assertEqual(code, 1)
        self.assertIn('references that do not resolve to basic: F-009', out)

    def test_input_that_cannot_be_used_exits_two(self):
        self.assertEqual(self.check('--set', 'nosuch')[0], 2)
        self.assertEqual(run(cd.main, ['billing', 'payroll', '--set', 'basic', '--root', self.root])[0], 2)
        self.assertEqual(run(cd.main, ['billing', 'payroll/run-period', '--root', os.path.join(self.root, 'none')])[0], 2)
        self.put(os.path.join(self.unit, 'unit.md'), '---\nid: x\n---\n')
        self.assertEqual(self.check('--set', 'basic')[0], 2)

    def test_a_set_with_a_fault_is_not_used_to_judge_a_design(self):
        self.put(os.path.join('standards', 'design', 'basic', 'overview.md'), '# O\n\n## One\n<!--\ncheck: bogus\n-->\n')
        code, _, err = self.check('--set', 'basic')
        self.assertEqual(code, 2)
        self.assertIn('fix the design templates first', err)


class Validate(unittest.TestCase):
    def test_good_sets_pass_and_faulty_ones_are_listed(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, True)
        shutil.copytree(os.path.join(FIXTURES, 'sets'), os.path.join(root, 'standards', 'design'))
        code, out, _ = run(vt.main, ['--root', root])
        self.assertEqual((code, out.strip()), (0, '2 design set(s), 0 problem(s)'))
        shutil.rmtree(os.path.join(root, 'standards', 'design'))
        shutil.copytree(os.path.join(FIXTURES, 'bad-sets'), os.path.join(root, 'standards', 'design'))
        code, out, _ = run(vt.main, ['--root', root])
        self.assertEqual(code, 1)
        self.assertIn('standards/design/alpha/set.md: file "a.md" is listed twice', out)
        self.assertEqual(run(vt.main, ['--root', os.path.join(root, 'none')])[0], 2)

    def test_the_starter_sets_of_the_template_are_valid(self):
        starter = os.path.join(os.path.dirname(HERE), '..', '..', '..', '..', '..', '..', 'templates', 'document-repo')
        code, out, _ = run(vt.main, ['--root', starter])
        self.assertEqual((code, out.strip()), (0, '2 design set(s), 0 problem(s)'))

    def test_a_project_with_no_sets_has_nothing_to_validate(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, True)
        self.assertEqual(run(vt.main, ['--root', root])[0], 0)


if __name__ == '__main__':
    unittest.main()
