"""Tests for the verify loop of a design run (ADR-0083): map_design, check_coverage, the rounds of check_review and the summary.

Run:  python -m pytest packages/agents/builtin/plugins/modernize/scripts/tests/test_design_loop.py
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

import check_coverage as cc  # noqa: E402
import check_review as cr  # noqa: E402
import map_design as md  # noqa: E402
import paths  # noqa: E402
import render_design_review as rr  # noqa: E402

APP = 'billing'
HEADER = '| Severity | Document | Section | Category | Finding | Suggestion |\n| --- | --- | --- | --- | --- | --- |\n'


def card(item, depends=(), used_by=()):
    lines = [f'## {item}: {item.split("/")[1]}', '', '- **kind:** screen', '- **status:** active', '']
    if depends:
        lines += ['### Depends on', '', '| Item | Kinds | Edges |', '| --- | --- | --- |', *(f'| {d} | call | 1 |' for d in depends), '']
    if used_by:
        lines += ['### Used by', '', *(f'- {u}' for u in used_by), '']
    return '\n'.join(lines)


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

    def catalog(self, module, *cards):
        self.put(paths.assessment_catalog_module_path(APP, module), f'---\nmodule: {module}\n---\n# {module}\n\n' + '\n'.join(cards))

    def read(self, relative):
        with open(os.path.join(self.root, *relative.split('/')), encoding='utf-8') as handle:
            return handle.read()


class Map(Repo):
    def build(self, keys, designed=()):
        for key in designed:
            module, unit = key.split('/')
            self.put(paths.unit_design_file_path(APP, module, unit, 'detail', 'logic.md'), '# Logic\n')
        return md.build(self.root, APP, keys, 'detail')

    def test_a_callee_is_designed_before_its_caller(self):
        self.catalog('pay', card('pay/run', depends=['pay/rates']), card('pay/rates', used_by=['pay/run']), card('pay/audit'))
        result = self.build(['pay/audit', 'pay/rates', 'pay/run'])
        self.assertEqual(result['waves'], [['pay/audit', 'pay/rates'], ['pay/run']])
        self.assertEqual(result['units']['pay/run']['dependsOn'], ['pay/rates'])
        self.assertEqual([c['units'] for c in result['clusters']], [['pay/rates', 'pay/run']])
        self.assertEqual(result['units']['pay/audit']['cluster'], None)

    def test_units_that_call_each_other_share_a_wave_and_a_cluster(self):
        self.catalog('pay', card('pay/a', depends=['pay/b']), card('pay/b', depends=['pay/a']))
        result = self.build(['pay/a', 'pay/b'])
        self.assertEqual(result['waves'], [['pay/a', 'pay/b']])
        self.assertEqual(result['units']['pay/a']['cycle'], ['pay/a', 'pay/b'])

    def test_a_lone_unit_next_to_a_designed_unit_outside_the_run_still_gets_a_cluster(self):
        self.catalog('pay', card('pay/run', depends=['pay/rates']))
        result = self.build(['pay/run'], designed=['pay/rates'])
        self.assertEqual(len(result['clusters']), 1)
        self.assertEqual(result['clusters'][0]['peers'][0]['unit'], 'pay/rates')
        self.assertTrue(result['clusters'][0]['peers'][0]['documents'][0].endswith('/detail/logic.md'))
        os.remove(os.path.join(self.root, *paths.unit_design_file_path(APP, 'pay', 'rates', 'detail', 'logic.md').split('/')))
        self.assertEqual(md.build(self.root, APP, ['pay/run'], 'detail')['clusters'], [])

    def test_the_application_is_one_wave_without_clusters(self):
        result = self.build(['@app'])
        self.assertEqual((result['waves'], result['clusters']), ([['@app']], []))
        with self.assertRaises(md.docmd.DataError):
            self.build(['@app', 'pay/a'])

    def test_the_command_line_writes_the_map_and_refuses_bad_input(self):
        self.catalog('pay', card('pay/run', depends=['pay/rates']), card('pay/rates'))
        out = os.path.join(self.root, 'out', 'map.json')
        self.assertEqual(run(md.main, [APP, 'pay/run,pay/rates', '--set', 'detail', '--root', self.root, '--out', out])[0], 0)
        with open(out, encoding='utf-8') as handle:
            self.assertEqual(json.load(handle)['waves'], [['pay/rates'], ['pay/run']])
        self.assertEqual(run(md.main, ['Billing', 'pay/run', '--set', 'detail', '--root', self.root, '--out', out])[0], 2)
        self.assertEqual(run(md.main, [APP, 'nonsense', '--set', 'detail', '--root', self.root, '--out', out])[0], 2)


class Coverage(Repo):
    def test_requirements_no_design_names_are_reported_not_failed(self):
        self.put(paths.application_requirements_path(APP), '# Requirements\n\n## REQ-1: Charge tax\n\ntext\n\n## REQ-2: Print invoice\n\ntext\n')
        self.put(paths.unit_design_file_path(APP, 'pay', 'run', 'detail', 'logic.md'), 'Implements REQ-1.\n')
        report = cc.coverage(self.root, APP, 'detail')
        self.assertEqual((report['total'], report['covered'], report['uncovered']), (2, 1, ['REQ-2']))
        self.assertEqual(report['requirements'][0]['units'], ['pay/run'])
        out = os.path.join(self.root, 'coverage.json')
        self.assertEqual(run(cc.main, [APP, '--set', 'detail', '--root', self.root, '--report', out])[0], 0)
        self.assertEqual(run(cc.main, ['Billing', '--set', 'detail', '--root', self.root])[0], 2)


def note(rows):
    return '---\nunit: "x"\n---\n# Review\n\n' + HEADER + ''.join(f'| {r} |\n' for r in rows)


class Rounds(Repo):
    def review(self, key, rows):
        self.put(paths.design_review_path(APP, key), note(rows))

    def contract(self, cluster, rows):
        self.put(paths.design_contract_path(APP, cluster), note(rows))

    def report(self, keys, history=None):
        self.put(paths.design_map_path(APP), json.dumps({'clusters': [{'id': 'c1', 'units': ['pay/run', 'pay/rates'], 'peers': []}]}))
        if not os.path.exists(os.path.join(self.root, *paths.design_contract_path(APP, 'c1').split('/'))):
            self.contract('c1', [])
        if history is not None:
            self.put('history.json', json.dumps({'rounds': history}))
        return cr.build(self.root, APP, keys, history=None if history is None else 'history.json')

    DOC = '10-applications/billing/02-modern/pay/run/detail/logic.md'

    def test_a_contract_finding_joins_the_unit_whose_document_has_to_change(self):
        self.review('pay/run', [])
        self.review('pay/rates', [])
        self.contract('c1', [f'major | {self.DOC} | Calls | contract | The call to rates passes a date, rates takes a period. | Pass the period.'])
        report, _, _ = self.report(['pay/run', 'pay/rates'])
        run_entry = next(e for e in report['units'] if e['unit'] == 'billing/pay/run')
        self.assertEqual((run_entry['majors'], run_entry['findings'][0]['source']), (1, 'contract'))
        self.assertEqual((report['open'], report['fix']), (1, ['pay/run']))

    def test_a_contract_note_that_names_a_document_outside_the_run_is_not_reviewed(self):
        self.review('pay/run', [])
        self.contract('c1', ['major | logic.md | Calls | contract | x | y'])
        report, _, _ = self.report(['pay/run'])
        self.assertFalse(report['clusters'][0]['reviewed'])
        self.assertIn('not a document of a unit of this run', report['clusters'][0]['error'])
        # A note nobody could read is a review that did not happen: it stays open, to be asked again.
        self.assertEqual((report['open'], report['unreviewedClusters'], report['fix']), (1, ['c1'], []))

    def test_a_unit_with_no_usable_note_is_reviewed_again_and_ends_the_loop_as_a_stall_if_it_never_gets_one(self):
        first, record, _ = self.report(['pay/run'])
        self.assertEqual((first['open'], first['unreviewed'], first['rereview'], first['stalled']), (1, ['pay/run'], ['pay/run'], False))
        second, _, _ = self.report(['pay/run'], [record])
        self.assertTrue(second['stalled'])

    def test_structural_problems_count_as_open_and_send_the_unit_to_the_fix(self):
        self.review('pay/run', [])
        self.review('pay/rates', [])
        self.contract('c1', [])
        self.put(paths.design_map_path(APP), json.dumps({'clusters': [{'id': 'c1', 'units': ['pay/run', 'pay/rates'], 'peers': []}]}))
        self.put('report.json', json.dumps({'units': [{'unit': 'billing/pay/run', 'ok': False}, {'unit': 'billing/pay/rates', 'ok': True}]}))
        report, _, _ = cr.build(self.root, APP, ['pay/run', 'pay/rates'], 'report.json', None)
        self.assertEqual((report['open'], report['structural'], report['fix']), (1, 1, ['pay/run']))

    def test_progress_is_a_lower_open_count_and_a_stall_is_two_rounds_without_one(self):
        row = 'blocker | logic.md | Rules | fidelity | RULE-4 has no row. | Add it.'
        self.review('pay/run', [row, 'major | logic.md | Errors | clarity | No message. | Write it.'])
        first, record, _ = self.report(['pay/run'])
        self.assertEqual((first['round'], first['open'], first['stalled']), (1, 2, False))
        # Round 2: the blocker was fixed, the major is still there: progress, one fixed finding.
        self.review('pay/run', ['major | logic.md | Errors | clarity | No message. | Write it.'])
        second, record2, _ = self.report(['pay/run'], [record])
        self.assertEqual((second['round'], second['open'], second['stalled'], second['resolved']), (2, 1, False, 1))
        # Round 3: the same major again, no progress yet; round 4: the same again, it is a stall.
        third, record3, _ = self.report(['pay/run'], [record, record2])
        self.assertEqual((third['open'], third['stalled']), (1, True), 'the same findings back is a stall at once')
        self.assertEqual(third['resolvedTotal'], 1)

    def test_a_round_that_gets_worse_is_not_yet_a_stall_but_the_next_one_is(self):
        self.review('pay/run', ['major | logic.md | A | clarity | First. | x'])
        _, record, _ = self.report(['pay/run'])
        self.review('pay/run', ['major | logic.md | B | clarity | Second. | x', 'major | logic.md | C | clarity | Third. | x'])
        worse, record2, _ = self.report(['pay/run'], [record])
        self.assertEqual((worse['open'], worse['stalled'], worse['streak']), (2, False, 1))
        self.review('pay/run', ['major | logic.md | D | clarity | Fourth. | x', 'major | logic.md | E | clarity | Fifth. | x'])
        again, _, _ = self.report(['pay/run'], [record, record2])
        self.assertEqual((again['open'], again['stalled']), (2, True))

    def test_the_command_line_writes_the_history_and_the_rounds_accumulate(self):
        self.review('pay/run', ['major | logic.md | A | clarity | First. | x'])
        history = os.path.join(self.root, 'out', 'progress.json')
        self.assertEqual(run(cr.main, [APP, 'pay/run', '--root', self.root, '--history-out', history])[0], 0)
        self.put('progress.json', self.read('out/progress.json'))
        code, out, _ = run(cr.main, [APP, 'pay/run', '--root', self.root, '--history', 'progress.json', '--history-out', history])
        self.assertEqual(code, 0)
        self.assertIn('round 2: 1 open', out)
        with open(history, encoding='utf-8') as handle:
            self.assertEqual([r['round'] for r in json.load(handle)['rounds']], [1, 2])
        self.assertEqual(run(cr.main, [APP, 'pay/run', '--root', self.root, '--history', '../x'])[0], 2)


class Summary(Repo):
    def render(self, top, coverage=None):
        self.put(paths.design_report_path(APP), json.dumps({'units': [{'unit': 'billing/pay/run', 'kind': 'screen', 'ok': True, 'sets': []}]}))
        self.put(paths.design_review_report_path(APP), json.dumps({**top, 'units': [{'unit': 'billing/pay/run', 'reviewed': True, 'blockers': 0, 'majors': 0, 'minors': 0, 'findings': []}]}))
        if coverage is not None:
            self.put(paths.design_coverage_path(APP), json.dumps(coverage))
        return rr.render(APP, ['pay/run'], 'detail', self.root)

    def test_it_says_how_the_loop_ended(self):
        self.assertIn('verified after its fixes', self.render({'round': 3, 'open': 0, 'resolvedTotal': 4}))
        self.assertIn('4 finding(s) were fixed and checked again', self.render({'round': 3, 'open': 0, 'resolvedTotal': 4}))
        self.assertIn('without improvement', self.render({'round': 3, 'open': 2, 'stalled': True}))
        self.assertIn('the last fix was not reviewed again', self.render({'round': 2, 'open': 1, 'stalled': False}))

    def test_it_lists_the_requirements_nothing_designs(self):
        text = self.render({'round': 1, 'open': 0}, {'set': 'detail', 'total': 3, 'covered': 2, 'uncovered': ['REQ-9']})
        self.assertIn('2 of 3 requirement(s)', text)
        self.assertIn('`REQ-9`', text)
        os.remove(os.path.join(self.root, *paths.design_coverage_path(APP).split('/')))
        self.assertNotIn('Requirement coverage', rr.render(APP, ['pay/run'], 'detail', self.root))


class LoopReport(Repo):
    """The loop as data for the portal: rounds, why it stopped, and the status of each finding."""

    def finding(self, fp, unit, text, severity='major'):
        return {'fingerprint': fp, 'unit': unit, 'severity': severity, 'category': 'clarity', 'document': 'logic.md', 'section': 'Errors', 'finding': text, 'suggestion': 'Write it.', 'source': 'review'}

    def reports(self, top, review_findings, history):
        self.put(paths.design_report_path(APP), json.dumps({'units': [{'unit': 'billing/pay/run', 'kind': 'screen', 'ok': True, 'sets': []}]}))
        self.put(paths.design_review_report_path(APP), json.dumps({**top, 'units': [{'unit': 'billing/pay/run', 'reviewed': True, 'blockers': 0, 'majors': len(review_findings), 'minors': 0, 'findings': review_findings}]}))
        self.put(paths.design_progress_path(APP), json.dumps({'rounds': history}))

    def test_a_finding_reported_before_and_gone_now_is_fixed_and_one_that_stays_is_open(self):
        stays = {**self.finding('aaa', 'pay/run', 'No message.'), 'status': 'open'}
        history = [
            {'round': 1, 'open': 2, 'fix': ['pay/run'], 'resolvedTotal': 0, 'findings': [self.finding('aaa', 'pay/run', 'No message.'), self.finding('bbb', 'pay/run', 'RULE-4 has no row.', 'blocker')]},
            {'round': 2, 'open': 1, 'fix': ['pay/run'], 'resolvedTotal': 1, 'findings': [self.finding('aaa', 'pay/run', 'No message.')]},
        ]
        self.reports({'round': 2, 'open': 1, 'stalled': False, 'resolvedTotal': 1, 'clusters': []}, [stays], history)
        report = rr.loop_report(APP, ['pay/run'], 'detail', self.root)
        self.assertEqual((report['round'], report['stop'], report['open'], report['resolvedTotal']), (2, 'limit', 1, 1))
        self.assertEqual(report['rounds'], [{'round': 1, 'open': 2, 'fixed': 1, 'resolved': 0}, {'round': 2, 'open': 1, 'fixed': 1, 'resolved': 1}])
        findings = {f['id']: f for f in report['units'][0]['findings']}
        self.assertEqual((findings['aaa']['status'], findings['aaa']['firstRound'], findings['aaa']['lastRound']), ('open', 1, 2))
        self.assertEqual((findings['bbb']['status'], findings['bbb']['firstRound'], findings['bbb']['lastRound'], findings['bbb']['severity']), ('fixed', 1, 1, 'blocker'))
        self.assertEqual([f['status'] for f in report['units'][0]['findings']], ['open', 'fixed'])

    def test_why_the_loop_stopped(self):
        self.assertEqual(rr.stop_reason({'round': 3, 'open': 0}), 'clean')
        self.assertEqual(rr.stop_reason({'round': 3, 'open': 2, 'stalled': True}), 'stalled')
        self.assertEqual(rr.stop_reason({'round': 3, 'open': 2, 'stalled': False}), 'limit')
        self.assertEqual(rr.stop_reason({}), 'none')

    def test_the_command_line_writes_the_loop_and_coverage_and_clusters(self):
        self.reports({'round': 1, 'open': 0, 'clusters': [{'cluster': 'c1', 'units': ['pay/run', 'pay/rates'], 'reviewed': True, 'findings': []}]}, [], [{'round': 1, 'open': 0, 'fix': [], 'resolvedTotal': 0, 'findings': []}])
        self.put(paths.design_coverage_path(APP), json.dumps({'total': 3, 'covered': 2, 'uncovered': ['REQ-9']}))
        out, loop = os.path.join(self.root, 'review.md'), os.path.join(self.root, 'out', 'loop.json')
        self.assertEqual(run(rr.main, [APP, 'pay/run', '--set', 'detail', '--root', self.root, '--out', out, '--loop', loop])[0], 0)
        with open(loop, encoding='utf-8') as handle:
            data = json.load(handle)
        self.assertEqual((data['stop'], data['clusters'], data['coverage']), ('clean', [{'id': 'c1', 'units': ['pay/run', 'pay/rates'], 'reviewed': True}], {'total': 3, 'covered': 2, 'uncovered': ['REQ-9']}))
        self.assertEqual(data['units'][0]['state'], 'ready')


if __name__ == '__main__':
    unittest.main()
