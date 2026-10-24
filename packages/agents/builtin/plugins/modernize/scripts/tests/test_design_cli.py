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
        shutil.copytree(os.path.join(FIXTURES, 'sets'), os.path.join(self.root, '01-standards', 'templates'))
        self.put('kintsugi.yaml', 'unitKinds: [screen, api, batch]\n')
        # The unit's card and design on the modern side, what is known about it on the legacy side.
        self.unit = os.path.join('10-applications', 'billing', '02-modern', 'payroll', 'run-period')
        self.known = os.path.join('10-applications', 'billing', '01-legacy', 'payroll', 'run-period')
        self.put(os.path.join(self.unit, 'README.md'), UNIT_MD)
        self.put(os.path.join(self.known, 'rules.md'), RULES_MD)

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
        return os.path.join(self.unit, set_id, name)

    def scaffold(self, *extra):
        return run(sd.main, ['billing', 'payroll/run-period', 'basic', '--root', self.root, *extra])

    def check(self, *extra):
        return run(cd.main, ['billing', 'payroll/run-period', '--root', self.root, *extra])


class Scaffold(Repo):
    def test_it_writes_every_file_of_the_set_with_the_rules_seeded_and_a_todo_in_what_is_left(self):
        code, out, err = self.scaffold()
        self.assertEqual((code, err), (0, ''))
        self.assertIn('created 10-applications/billing/02-modern/payroll/run-period/basic/overview.md', out)
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
        self.assertIn('created 10-applications/billing/02-modern/payroll/run-period/basic/functions.md', out)

    def test_optional_documents_are_written_only_when_asked_for(self):
        self.put(os.path.join(self.unit, 'README.md'), UNIT_MD.replace('"screen"', '"api"'))
        code, out, _ = run(sd.main, ['billing', 'payroll/run-period', 'detail', '--root', self.root])
        self.assertEqual(code, 0)
        self.assertIn('run-period/detail/logic.md', out)
        self.assertNotIn('sql.md', out)
        code, out, _ = run(sd.main, ['billing', 'payroll/run-period', 'detail', '--all', '--root', self.root])
        self.assertIn('created 10-applications/billing/02-modern/payroll/run-period/detail/sql.md', out)

    def test_a_set_that_needs_another_says_so_and_input_that_cannot_be_used_exits_two(self):
        code, out, _ = run(sd.main, ['billing', 'payroll/run-period', 'detail', '--root', self.root])
        self.assertEqual(code, 0)
        self.assertIn('the set "basic", which "detail" needs, has no', out)
        for argv in (['billing', 'payroll/run-period', 'nosuch'], ['billing', 'payroll/none', 'basic'], ['Billing', 'payroll/run-period', 'basic'],
                     ['billing', 'payroll/run-period', 'basic', '--file', 'x.md']):
            self.assertEqual(run(sd.main, argv + ['--root', self.root])[0], 2, argv)

    def test_several_units_are_written_to_another_directory_with_a_manifest_and_one_that_cannot_be_used_is_skipped(self):
        other = os.path.join('10-applications', 'billing', '02-modern', 'payroll', 'close-period')
        self.put(os.path.join(other, 'README.md'), UNIT_MD.replace('run-period', 'close-period').replace('Run period', 'Close period'))
        self.put(os.path.join('10-applications', 'billing', '01-legacy', 'payroll', 'close-period', 'rules.md'), RULES_MD)
        out = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, out, True)
        manifest = os.path.join(out, 'scratch', 'manifest.json')
        code, stdout, stderr = run(sd.main, ['billing', 'payroll/run-period,payroll/close-period,payroll/none', 'basic', '--root', self.root, '--out', out, '--manifest', manifest])
        self.assertEqual(code, 0)
        self.assertIn('payroll/none', stderr)
        # Nothing is written under --root, everything under --out.
        self.assertFalse(os.path.exists(os.path.join(self.root, self.design('basic', 'overview.md'))))
        for unit in ('run-period', 'close-period'):
            self.assertTrue(os.path.isfile(os.path.join(out, '10-applications', 'billing', '02-modern', 'payroll', unit, 'basic', 'overview.md')))
        with open(manifest, encoding='utf-8') as handle:
            data = json.load(handle)
        self.assertEqual(data['set'], 'basic')
        self.assertEqual(sorted(data['units']), ['payroll/close-period', 'payroll/none', 'payroll/run-period'])
        run_period = data['units']['payroll/run-period']
        self.assertEqual((run_period['kind'], run_period['title']), ('screen', 'Run period'))
        self.assertEqual([(f['path'].rsplit('/', 1)[1], f['required'], f['written']) for f in run_period['files']], [('overview.md', True, True), ('functions.md', True, True)])
        self.assertIn('error', data['units']['payroll/none'])

    def test_a_design_that_is_already_in_the_repository_is_not_written_again_to_another_directory(self):
        self.put(self.design('basic', 'overview.md'), 'mine' + chr(10))
        out = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, out, True)
        code, stdout, _ = self.scaffold('--out', out)
        self.assertEqual(code, 0)
        self.assertIn('overview.md exists and was left as it is', stdout)
        self.assertFalse(os.path.exists(os.path.join(out, self.design('basic', 'overview.md'))))
        self.assertTrue(os.path.exists(os.path.join(out, self.design('basic', 'functions.md'))))

    def test_when_every_unit_of_a_list_fails_it_exits_two(self):
        self.assertEqual(run(sd.main, ['billing', 'payroll/none,payroll/nope', 'basic', '--root', self.root])[0], 2)


class Profiles(Repo):
    """A set with a profile per unit kind (ADR-0053): the template, the reference and the files depend on the kind."""

    def detail(self, *extra, unit='payroll/run-period'):
        return run(sd.main, ['billing', unit, 'detail', '--root', self.root, *extra])

    def test_a_unit_of_a_kind_with_its_own_template_is_scaffolded_from_it_and_names_it(self):
        code, out, err = self.detail()
        self.assertEqual((code, err), (0, ''))
        text = self.read(self.design('detail', 'logic.md'))
        self.assertTrue(text.startswith('---\ntemplate: "detail/screen@3"\nunit: "billing/payroll/run-period"\n---\n# Run period: screen logic\n'))
        self.assertIn('## Screen events\n\n| Event | Handler | Rule |', text)

    def test_a_kind_without_a_profile_template_is_scaffolded_from_the_set_and_names_the_set(self):
        self.put(os.path.join(self.unit, 'README.md'), UNIT_MD.replace('"screen"', '"api"'))
        self.detail('--all')
        self.assertTrue(self.read(self.design('detail', 'logic.md')).startswith('---\ntemplate: "detail@2"\n'))
        self.assertTrue(self.read(self.design('detail', 'sql.md')).startswith('---\ntemplate: "detail/api@1"\n'))

    def test_a_profile_can_remove_the_files_of_the_set_and_add_its_own(self):
        self.put(os.path.join(self.unit, 'README.md'), UNIT_MD.replace('"screen"', '"batch"'))
        code, out, _ = self.detail()
        self.assertEqual(code, 0)
        self.assertIn('run-period/detail/job.md', out)
        self.assertFalse(os.path.exists(os.path.join(self.root, self.design('detail', 'logic.md'))))

    def test_the_manifest_names_the_profile_the_template_the_reference_and_the_example(self):
        manifest = os.path.join(self.root, 'scratch', 'manifest.json')
        self.assertEqual(self.detail('--manifest', manifest)[0], 0)
        with open(manifest, encoding='utf-8') as handle:
            entry = json.load(handle)['units']['payroll/run-period']
        self.assertEqual(entry['profile'], '01-standards/templates/detail/screen/profile.md')
        self.assertEqual([(f['path'].rsplit('/', 1)[1], f['templateFile'], f['ref'], f['example']) for f in entry['files']],
                         [('logic.md', '01-standards/templates/detail/screen/logic.md', 'detail/screen@3', '01-standards/templates/detail/screen/_examples/logic.md')])
        manifest_api = os.path.join(self.root, 'scratch', 'api.json')
        self.put(os.path.join(self.unit, 'README.md'), UNIT_MD.replace('"screen"', '"other"'))
        self.assertEqual(self.detail('--manifest', manifest_api)[0], 0)
        with open(manifest_api, encoding='utf-8') as handle:
            entry = json.load(handle)['units']['payroll/run-period']
        self.assertEqual((entry['profile'], entry['files'][0]['ref'], entry['files'][0]['example']), (None, 'detail@2', '01-standards/templates/detail/_examples/logic.md'))

    def test_the_check_expects_the_template_of_the_kind_and_reports_a_design_of_an_older_profile_as_stale(self):
        self.put(self.design('basic', 'functions.md'), FUNCTIONS_OK)
        self.put(self.design('detail', 'logic.md'), fixture('designs', 'detail-screen-ok.md'))
        code, out, _ = self.check('--set', 'detail', '--json')
        self.assertEqual(code, 0, out)
        file = json.loads(out)['sets'][0]['files'][0]
        self.assertEqual((file['ref'], file['stale'], file['state']), ('detail/screen@3', False, 'conformant'))
        self.put(self.design('detail', 'logic.md'), fixture('designs', 'detail-screen-stale.md'))
        file = json.loads(self.check('--set', 'detail', '--json')[1])['sets'][0]['files'][0]
        self.assertEqual((file['stale'], file['state']), (True, 'conformant'))
        code, out, _ = self.check('--set', 'detail')
        self.assertIn('(written against an older version of the template, now detail/screen@3)', out)

    def test_a_design_that_names_the_set_where_the_kind_has_its_own_template_is_wrong(self):
        self.put(self.design('detail', 'logic.md'), fixture('designs', 'detail-ok.md'))
        code, out, _ = self.check('--set', 'detail')
        self.assertEqual(code, 1)
        self.assertIn('template reference "detail@2" does not name this template (expected detail/screen@3)', out)

    def test_a_profile_with_a_fault_blocks_the_scaffold_of_its_set(self):
        self.put(os.path.join('01-standards', 'templates', 'detail', 'screen', 'profile.md'), '---\nkind: other\nversion: 1\n---\n')
        code, _, err = self.detail()
        self.assertEqual(code, 2)
        self.assertIn('detail/screen/profile.md: kind "other" does not match its folder "screen"', err)


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
        self.put(os.path.join(self.unit, 'README.md'), WAIVED_UNIT_MD)
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
        self.put(os.path.join(self.unit, 'README.md'), UNIT_MD.replace('"screen"', '"api"'))
        self.put(os.path.join('02-architecture', 'common', 'COM-LOG-01.md'), '# Logging\n')
        self.put(os.path.join('10-applications', 'billing', '02-modern', 'requirements.md'), '## REQ-01: Pay\n')
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
        self.put(os.path.join(self.unit, 'README.md'), '---\nid: x\n---\n')
        self.assertEqual(self.check('--set', 'basic')[0], 2)

    def test_several_units_are_reported_together_and_tolerate_ignores_the_result(self):
        other = os.path.join('10-applications', 'billing', '02-modern', 'payroll', 'close-period')
        self.put(os.path.join(other, 'README.md'), UNIT_MD.replace('run-period', 'close-period'))
        self.put(os.path.join('10-applications', 'billing', '01-legacy', 'payroll', 'close-period', 'rules.md'), RULES_MD)
        self.put(self.design('basic', 'overview.md'), fixture('designs', 'basic-overview-ok.md'))
        self.put(self.design('basic', 'functions.md'), FUNCTIONS_OK)
        argv = ['billing', 'payroll/run-period,payroll/close-period,payroll/none', '--set', 'basic', '--root', self.root, '--json']
        code, out, _ = run(cd.main, argv)
        self.assertEqual(code, 1)
        report = json.loads(out)
        self.assertFalse(report['ok'])
        by_unit = {entry['unit']: entry for entry in report['units']}
        self.assertTrue(by_unit['billing/payroll/run-period']['ok'])
        self.assertFalse(by_unit['billing/payroll/close-period']['ok'])
        self.assertIn('error', by_unit['billing/payroll/none'])
        self.assertEqual(run(cd.main, argv + ['--tolerate'])[0], 0)
        self.assertEqual(self.check('--set', 'basic', '--tolerate')[0], 0)
        single = os.path.join(self.root, 'scratch', 'single.json')
        self.assertEqual(self.check('--set', 'basic', '--tolerate', '--report', single)[0], 0)
        with open(single, encoding='utf-8') as handle:
            self.assertEqual([entry['unit'] for entry in json.load(handle)['units']], ['billing/payroll/run-period'])
        report_path = os.path.join(self.root, 'scratch', 'report.json')
        self.assertEqual(run(cd.main, argv[:-1] + ['--tolerate', '--report', report_path])[0], 0)
        with open(report_path, encoding='utf-8') as handle:
            self.assertEqual(sorted(entry['unit'] for entry in json.load(handle)['units']), ['billing/payroll/close-period', 'billing/payroll/none', 'billing/payroll/run-period'])

    def test_a_set_with_a_fault_is_not_used_to_judge_a_design(self):
        self.put(os.path.join('01-standards', 'templates', 'basic', 'overview.md'), '# O\n\n## One\n<!--\ncheck: bogus\n-->\n')
        code, _, err = self.check('--set', 'basic')
        self.assertEqual(code, 2)
        self.assertIn('fix the design templates first', err)


class ApplicationScope(Repo):
    """A design set of the application (ADR-0050): written and checked for `@app`, under 10-applications/<app>/02-modern/_design/<set>/."""

    def setUp(self):
        super().setUp()
        shutil.copytree(os.path.join(FIXTURES, 'app-sets', 'arch'), os.path.join(self.root, '01-standards', 'templates', 'arch'))
        shutil.copytree(os.path.join(FIXTURES, 'app-sets', 'dbunit'), os.path.join(self.root, '01-standards', 'templates', 'dbunit'))
        self.put(os.path.join('10-applications', 'billing', '02-modern', 'requirements.md'), '## REQ-01: Pay\n')
        self.put(os.path.join('02-architecture', 'common', 'COM-LOG-01.md'), '# Logging\n')
        self.put(os.path.join('02-architecture', 'common', 'COM-AUTH-01.md'), '# Authentication\n')
        self.arch = os.path.join('10-applications', 'billing', '02-modern', '_design', 'arch', 'overview.md')

    def test_it_writes_the_documents_of_an_application_set_without_a_unit(self):
        code, out, err = run(sd.main, ['billing', '@app', 'arch', '--root', self.root])
        self.assertEqual((code, err), (0, ''))
        self.assertIn('created 10-applications/billing/02-modern/_design/arch/overview.md', out)
        text = self.read(self.arch)
        self.assertTrue(text.startswith('---\ntemplate: "arch@1"\n---\n# billing: architecture overview\n'))
        self.assertNotIn('unit:', text)
        self.assertIn('## Context\n\nTODO\n', text)
        self.assertIn('| TODO | TODO | TODO | TODO |', text)

    def test_the_manifest_names_the_scope_and_what_the_designer_also_reads(self):
        manifest = os.path.join(self.root, 'scratch', 'manifest.json')
        code, _, _ = run(sd.main, ['billing', '@app,payroll/run-period', 'basic', '--root', self.root, '--manifest', manifest])
        self.assertEqual(code, 0)
        code, _, _ = run(sd.main, ['billing', '@app', 'arch', '--root', self.root, '--out', os.path.join(self.root, 'out'), '--manifest', manifest])
        self.assertEqual(code, 0)
        with open(manifest, encoding='utf-8') as handle:
            data = json.load(handle)
        entry = data['units']['@app']
        self.assertEqual((entry['scope'], entry['kind'], entry['reads']), ('application', None, ['10-applications/{app}/01-legacy/', '02-architecture/']))
        self.assertEqual([(f['path'].rsplit('/', 1)[1], f['written']) for f in entry['files']], [('overview.md', True)])

    def test_a_set_is_never_written_for_the_wrong_subject(self):
        self.assertEqual(run(sd.main, ['billing', '@app', 'basic', '--root', self.root])[0], 2)
        code, _, err = run(sd.main, ['billing', 'payroll/run-period', 'arch', '--root', self.root])
        self.assertEqual(code, 2)
        self.assertIn('is for the application', err)

    def test_the_check_reads_the_application_design_against_its_own_ids(self):
        run(sd.main, ['billing', '@app', 'arch', '--root', self.root])
        code, out, _ = run(cd.main, ['billing', '@app', '--root', self.root])
        self.assertEqual(code, 1)
        self.assertIn('billing/@app (application)', out)
        self.assertIn('unfinished text left: TODO', out)
        self.put(self.arch, fixture('designs', 'arch-ok.md'))
        code, out, _ = run(cd.main, ['billing', '@app', '--root', self.root])
        self.assertEqual((code, out.strip().splitlines()[-1]), (0, 'ok'))
        self.put(self.arch, fixture('designs', 'arch-bad.md'))
        code, out, _ = run(cd.main, ['billing', '@app', '--root', self.root])
        self.assertEqual(code, 1)
        self.assertIn('references that do not resolve to requirements: REQ-99', out)
        self.assertIn('references that do not resolve to components: COM-MAIL-01', out)

    def test_a_unit_set_that_needs_an_application_set_resolves_its_items(self):
        unit = os.path.join('10-applications', 'billing', '02-modern', 'payroll', 'run-period', 'dbunit', 'data.md')
        code, out, _ = run(sd.main, ['billing', 'payroll/run-period', 'dbunit', '--root', self.root])
        self.assertEqual(code, 0)
        self.assertIn('the set "arch", which "dbunit" needs, has no 10-applications/billing/02-modern/_design/arch/overview.md yet', out)
        self.put(self.arch, fixture('designs', 'arch-ok.md'))
        self.put(unit, fixture('designs', 'dbunit-ok.md'))
        code, out, _ = run(cd.main, ['billing', 'payroll/run-period', '--root', self.root, '--set', 'dbunit'])
        self.assertEqual((code, out.strip().splitlines()[-1]), (0, 'ok'))
        self.put(unit, fixture('designs', 'dbunit-bad.md'))
        code, out, _ = run(cd.main, ['billing', 'payroll/run-period', '--root', self.root, '--set', 'dbunit'])
        self.assertEqual(code, 1)
        self.assertIn('references that do not resolve to arch: A-009', out)

    def test_a_unit_check_does_not_list_the_sets_of_the_application(self):
        code, out, _ = run(cd.main, ['billing', 'payroll/run-period', '--root', self.root, '--json'])
        report = json.loads(out)
        self.assertEqual([entry['set'] for entry in report['sets']], ['basic', 'dbunit', 'detail'])


class Validate(unittest.TestCase):
    def test_good_sets_pass_and_faulty_ones_are_listed(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, True)
        shutil.copytree(os.path.join(FIXTURES, 'sets'), os.path.join(root, '01-standards', 'templates'))
        code, out, _ = run(vt.main, ['--root', root])
        self.assertEqual((code, out.strip()), (0, '2 design set(s), 0 problem(s)'))
        shutil.rmtree(os.path.join(root, '01-standards', 'templates'))
        shutil.copytree(os.path.join(FIXTURES, 'bad-sets'), os.path.join(root, '01-standards', 'templates'))
        code, out, _ = run(vt.main, ['--root', root])
        self.assertEqual(code, 1)
        self.assertIn('01-standards/templates/alpha/set.md: file "a.md" is listed twice', out)
        self.assertIn('01-standards/templates/omega/screen/stray.md: is not used by any file of the kind "screen"', out)
        self.assertEqual(run(vt.main, ['--root', os.path.join(root, 'none')])[0], 2)

    def test_the_starter_sets_of_the_template_are_valid(self):
        starter = os.path.join(os.path.dirname(HERE), '..', '..', '..', '..', '..', '..', 'templates', 'document-repo')
        code, out, _ = run(vt.main, ['--root', starter])
        # basic, detail, api and test (ADR-0051).
        self.assertEqual((code, out.strip()), (0, '6 design set(s), 0 problem(s)'))

    def test_a_project_with_no_sets_has_nothing_to_validate(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, True)
        self.assertEqual(run(vt.main, ['--root', root])[0], 0)


if __name__ == '__main__':
    unittest.main()
