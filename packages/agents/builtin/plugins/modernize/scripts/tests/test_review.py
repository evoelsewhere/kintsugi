"""Tests for the scripts that review a member's merge request (ADR-0071): prepare_review, mr_changes, check_code_review and render_review.

Run:  python -m pytest packages/agents/builtin/plugins/modernize/scripts/tests/test_review.py
"""
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import check_code_review as ccr  # noqa: E402
import mr_changes as mc  # noqa: E402
import prepare_review as pr  # noqa: E402
import render_review as rr  # noqa: E402

RULES = """# Rules

| ID | Name | Status |
| --- | --- | --- |
| RULE-001 | Total is computed | active |
| RULE-002 | Total is rounded to cents | active |
"""
COMMIT = 'a' * 40
HEAD = '| Severity | File | Where | Category | Finding | Suggestion |\n| --- | --- | --- | --- | --- | --- |\n'


def run(fn, argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = fn(argv)
    return code, out.getvalue(), err.getvalue()


class World(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.base, True)
        self.root = os.path.join(self.base, 'in')
        self.scratch = os.path.join(self.root, 'scratch', 'app', 'build')
        self.manifest = os.path.join(self.scratch, 'manifest.json')
        os.makedirs(self.root)

    def put(self, relative, text):
        path = os.path.join(self.root, *relative.split('/'))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8', newline='\n') as handle:
            handle.write(text)

    def unit(self, key='pay/run', rules=RULES, design=True):
        module, unit = key.split('/')
        self.put(f'10-applications/app/02-modern/{module}/{unit}/README.md', '---\nkind: "api"\ntitle: "Run"\n---\n# Run\n')
        self.put(f'10-applications/app/01-legacy/{module}/{unit}/rules.md', rules)
        if design:
            self.put(f'10-applications/app/02-modern/{module}/{unit}/detail/logic.md', '# Logic\n')

    def prepare(self, units='pay/run'):
        code, out, err = run(pr.main, ['app', units, '--target', 'api', '--mr-url', 'https://git.example/org/api/pull/7', '--mr-commit', COMMIT, '--mr-branch', 'feature/pay', '--root', self.root, '--manifest', self.manifest])
        self.assertEqual(code, 0, err)
        with open(self.manifest, encoding='utf-8') as handle:
            return json.load(handle)

    def note(self, key, rows=''):
        self.put(f'scratch/app/build/review/{key}.md', f'---\nunit: "{key}"\n---\n# Review\n\n{HEAD}{rows}')

    def report(self, name='review-report.json'):
        code, out, err = run(ccr.main, ['app', 'pay/run', '--root', self.root, '--report', os.path.join(self.scratch, name)])
        self.assertEqual(code, 0, err)
        with open(os.path.join(self.scratch, name), encoding='utf-8') as handle:
            return json.load(handle)['units'][0]


class Prepare(World):
    def test_a_designed_unit_with_rules_is_reviewed_and_the_merge_request_is_recorded(self):
        self.unit()
        manifest = self.prepare()
        entry = manifest['units']['pay/run']
        self.assertIsNone(entry['error'])
        self.assertEqual([rule['id'] for rule in entry['rules']], ['RULE-001', 'RULE-002'])
        self.assertEqual(entry['design'], ['10-applications/app/02-modern/pay/run/detail/logic.md'])
        self.assertEqual(manifest['mr'], {'url': 'https://git.example/org/api/pull/7', 'commit': COMMIT, 'branch': 'feature/pay'})
        self.assertEqual(manifest['target'], 'api')

    def test_a_unit_without_design_rules_or_card_is_left_out_with_a_reason(self):
        self.unit('pay/nodesign', design=False)
        self.unit('pay/norules', rules='# Rules\n')
        manifest = self.prepare('pay/nodesign,pay/norules,pay/nocard')
        self.assertIn('no merged design', manifest['units']['pay/nodesign']['error'])
        self.assertIn('no rules', manifest['units']['pay/norules']['error'])
        self.assertIn('does not exist', manifest['units']['pay/nocard']['error'])

    def test_the_build_folder_of_a_unit_is_not_a_design_set(self):
        self.unit(design=False)
        self.put('10-applications/app/02-modern/pay/run/_build/review.md', '# an earlier review\n')
        self.assertIn('no merged design', self.prepare()['units']['pay/run']['error'])

    def test_rejects_bad_arguments(self):
        self.unit()
        base = ['--target', 'api', '--mr-url', 'u', '--mr-commit', COMMIT, '--root', self.root, '--manifest', self.manifest]
        for argv in (['Bad App', 'pay/run'], ['app', 'payrun']):
            self.assertEqual(run(pr.main, [*argv, *base])[0], 2, argv)
        self.assertEqual(run(pr.main, ['app', 'pay/run', '--target', 'api', '--mr-url', 'u', '--mr-commit', 'not-a-commit', '--root', self.root, '--manifest', self.manifest])[0], 2)


class Notes(World):
    def test_counts_the_findings_by_severity(self):
        self.note('pay/run', '| blocker | `src/calc.py` | total | fidelity | Rounds down. | Round half up. |\n| minor | `src/calc.py` | total | design | A name. | Rename. |\n')
        entry = self.report()
        self.assertTrue(entry['reviewed'])
        self.assertEqual((entry['blockers'], entry['majors'], entry['minors']), (1, 0, 1))
        self.assertEqual(entry['findings'][0]['file'], 'src/calc.py')

    def test_an_empty_table_is_a_clean_review_and_a_missing_or_malformed_note_is_not(self):
        self.assertEqual(self.report()['error'], 'no review note')
        self.note('pay/run')
        self.assertTrue(self.report()['reviewed'])
        self.note('pay/run', '| blocker | f | w | style | x | y |\n')
        self.assertIn('category "style"', self.report()['error'])
        self.put('scratch/app/build/review/pay/run.md', '---\nunit: "pay/run"\n---\n| Severity | Document |\n| --- | --- |\n')
        self.assertIn('no table with the columns', self.report()['error'])

    def test_the_note_must_be_for_the_unit(self):
        self.put('scratch/app/build/review/pay/run.md', f'---\nunit: "pay/other"\n---\n{HEAD}')
        self.assertIn('names unit "pay/other"', self.report()['error'])


class Render(World):
    def render(self):
        out, summary = os.path.join(self.base, 'out'), os.path.join(self.base, 'summary.md')
        self.report()
        code, _, err = run(rr.main, ['app', 'pay/run', '--manifest', self.manifest, '--root', self.root, '--scratch', self.scratch, '--out', out, '--summary', summary])
        self.assertEqual(code, 0, err)
        with open(os.path.join(out, '10-applications', 'app', '02-modern', 'pay', 'run', '_build', 'review.md'), encoding='utf-8') as handle:
            document = handle.read()
        with open(summary, encoding='utf-8') as handle:
            return document, handle.read()

    def test_writes_every_finding_largest_first_and_names_the_merge_request(self):
        self.unit()
        self.prepare()
        self.note('pay/run', '| minor | `a` | b | design | Name. | Rename. |\n| blocker | `src/calc.py` | total | fidelity | Rounds down. | Round half up. |\n')
        document, summary = self.render()
        self.assertIn('reviewed: "true"', document)
        self.assertIn('blockers: 1', document)
        self.assertIn('mr: "https://git.example/org/api/pull/7"', document)
        self.assertLess(document.index('Rounds down.'), document.index('Name.'))
        self.assertIn('Fix the blockers and majors in the merge request', document)
        self.assertIn('https://git.example/org/api/pull/7', summary)
        self.assertIn('findings to fix', summary)

    def test_a_unit_that_was_not_reviewed_is_never_shown_as_clean(self):
        self.unit()
        self.prepare()
        document, summary = self.render()
        self.assertIn('reviewed: "false"', document)
        self.assertIn('Not reviewed: no review note', document)
        self.assertIn('not reviewed', summary)

    def test_a_clean_review_says_so(self):
        self.unit()
        self.prepare()
        self.note('pay/run')
        document, summary = self.render()
        self.assertIn('0 blocker(s), 0 major(s) and 0 minor(s)', document)
        self.assertIn('clear', summary)


class Changes(unittest.TestCase):
    def git(self, cwd, *args):
        subprocess.run(['git', '-c', 'user.name=T', '-c', 'user.email=t@example.invalid', '-c', 'core.autocrlf=false', *args], cwd=cwd, check=True, capture_output=True)

    def test_lists_the_files_between_the_merge_base_and_the_head(self):
        base = tempfile.mkdtemp()
        self.addCleanup(lambda: shutil.rmtree(base, onexc=lambda f, p, e: (os.chmod(p, 0o700), f(p))))
        work = os.path.join(base, 'work')
        os.makedirs(os.path.join(work, 'src'))
        with open(os.path.join(work, 'src', 'a.py'), 'w') as handle:
            handle.write('a = 1\n')
        self.git(work, 'init', '-q', '-b', 'main')
        self.git(work, 'add', '-A')
        self.git(work, 'commit', '-q', '-m', 'base')
        bare = os.path.join(base, 'repo.git')
        self.git(base, 'clone', '-q', '--bare', work, bare)
        self.git(work, 'checkout', '-q', '-b', 'feature')
        with open(os.path.join(work, 'src', 'b.py'), 'w') as handle:
            handle.write('b = 2\n')
        with open(os.path.join(work, 'src', 'a.py'), 'w') as handle:
            handle.write('a = 2\n')
        self.git(work, 'add', '-A')
        self.git(work, 'commit', '-q', '-m', 'feature')
        self.git(work, 'push', '-q', bare, 'feature')
        head = subprocess.run(['git', 'rev-parse', 'feature'], cwd=work, check=True, capture_output=True, text=True).stdout.strip()
        tobe = os.path.join(base, 'to-be')
        self.git(bare, 'worktree', 'add', '--detach', tobe, head)
        report = mc.changes(tobe, head)
        self.assertEqual(sorted((entry['status'], entry['path']) for entry in report['files']), [('A', 'src/b.py'), ('M', 'src/a.py')])
        self.assertEqual(report['note'], '')
        out = os.path.join(base, 'changes.json')
        code, stdout, _ = run(mc.main, ['--tobe', tobe, '--commit', head, '--out', out])
        self.assertEqual(code, 0)
        self.assertIn('2 file(s) changed', stdout)

    def test_a_folder_that_is_not_a_worktree_gives_an_empty_list_with_the_reason(self):
        folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, folder, True)
        report = mc.changes(folder, COMMIT)
        self.assertEqual(report['files'], [])
        self.assertTrue(report['note'])

    def test_rejects_a_bad_commit(self):
        self.assertEqual(run(mc.main, ['--tobe', '.', '--commit', 'nope', '--out', 'x.json'])[0], 2)


if __name__ == '__main__':
    unittest.main()
