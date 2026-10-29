import os
import sys
import unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import gaps_common as gaps
import gap_resolution


def spec(answer='', status='open'):
    return '# Spec\n\n## Logic\n\nRate unknown (gap: GAP-M101-0001).\n\n## Gaps and questions\n\n| ID | Kind | Question | Where | Impact | Status | Answer | Evidence |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| GAP-M101-0001 | ambiguous | Which rate? | legacy/tax.cbl:4 | blocking | ' + status + ' | ' + answer + ' | REQ-1 |\n\n## Sources\n\nLeave unchanged.\n'


class Resolution(unittest.TestCase):
    def test_carries_merged_answers_at_their_original_location(self):
        old = spec('Use 8%.', 'resolved')
        updated = gaps.carry_resolutions(spec('The model guessed 9%.', 'resolved'), old, True)
        rows = gaps.checked_gaps(updated)
        self.assertEqual(rows[0]['answer'], 'Use 8%.')
        self.assertTrue(gap_resolution.resolved(rows[0]))
        self.assertEqual(updated.split('## Logic')[1].split('## Gaps')[0], old.split('## Logic')[1].split('## Gaps')[0])
        self.assertEqual(updated.split('## Sources')[1], old.split('## Sources')[1])

    def test_reopens_the_answer_when_source_digest_changes(self):
        updated = gaps.carry_resolutions(spec(), spec('Use 8%.', 'resolved'), False)
        row = gaps.checked_gaps(updated)[0]
        self.assertEqual(row['answer'], 'Use 8%.')
        self.assertEqual(row['status'], 'open')
        self.assertFalse(gap_resolution.resolved(row))

    def test_model_cannot_resolve_or_delete_a_human_answer(self):
        updated = gaps.carry_resolutions(spec('Use 9%.', 'resolved'), None, True)
        self.assertFalse(gap_resolution.resolved(gaps.checked_gaps(updated)[0]))
        omitted = '# Spec\n\n## Gaps and questions\n\nNone.\n'
        kept = gaps.carry_resolutions(omitted, spec('Use 8%.', 'resolved'), True)
        self.assertEqual(gaps.checked_gaps(kept)[0]['answer'], 'Use 8%.')

    def test_placeholder_resolution_never_counts_as_complete(self):
        for value in ('', '-', 'TODO', 'TBD later', 'None.'):
            rows, problems = gap_resolution.inspect(spec(value, 'resolved'))
            self.assertTrue(problems)
            self.assertFalse(gap_resolution.resolved(rows[0]))

    def test_rebuild_uses_current_specification_counts_instead_of_old_trace_snapshot(self):
        import tempfile
        import pathlib
        import rebuild_aggregates as rebuild
        import docmd
        import paths
        with tempfile.TemporaryDirectory() as root:
            def put(relative, text):
                path = pathlib.Path(root) / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text)
            put(paths.unit_understanding_path('billing', 'tax', 'calc'), '---\nstatus: understood\ndigest: sha256:abc\n---\n')
            put(paths.unit_trace_path('billing', 'tax', 'calc'), '---\nopenQuestions: 9\n---\n# Trace\n')
            put(paths.unit_as_is_path('billing', 'tax', 'calc'), spec('Use 8%.', 'resolved'))
            item = {'id': 'tax/calc', 'status': 'active', 'digest': 'sha256:abc', 'files': []}
            from unittest.mock import patch
            with patch.object(rebuild.cc, 'load_catalog', return_value=({'tax/calc': item}, {})):
                *_, rows, gap_rows = rebuild.rebuild('billing', root)
            self.assertEqual(rows[0]['openQuestions'], 0)
            front = docmd.split_front_matter(rebuild.gaps_md('billing', gap_rows))[0]
            self.assertEqual((front['open'], front['resolved']), (0, 1))

    def test_carrying_answers_keeps_who_settles_the_gap_and_its_probe(self):
        # ADR-0087: the advisory columns survive the rewrite of the table; an unknown value reads as the kind's default.
        written = spec().replace('| ID | Kind | Question | Where | Impact | Status | Answer | Evidence |\n| --- | --- | --- | --- | --- | --- | --- | --- |',
                                 '| ID | Kind | Question | Where | Impact | Settled by | Probe | Status | Answer | Evidence |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
        written = written.replace('| blocking | open |', '| blocking | expert | Ask the tax team. | open |')
        row = gaps.checked_gaps(gaps.carry_resolutions(written, spec('Use 8%.', 'resolved'), True))[0]
        self.assertEqual((row['settled by'], row['probe'], row['answer']), ('expert', 'Ask the tax team.', 'Use 8%.'))
        self.assertEqual(gap_resolution.settler(row), 'expert')
        self.assertEqual(gap_resolution.settler({**row, 'settled by': 'the tax team'}), 'expert')
        self.assertEqual(gap_resolution.settler({'kind': 'missing-source'}), 'source-owner')

    def test_malformed_previously_answered_register_fails_instead_of_losing_answers(self):
        before = spec('Use 8%.', 'resolved').replace('| ambiguous |', '| wrong-kind |')
        with self.assertRaisesRegex(Exception, 'invalid gap answers'):
            gaps.carry_resolutions(spec(), before, True)
