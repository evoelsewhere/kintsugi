import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import catalog_common as cc
import docmd
import gaps_common as gaps


def specification(rows, prose=''):
    return '# Unit\n\n' + prose + '\n\n## Gaps and questions\n\n' + docmd.table(
        ['ID', 'Kind', 'Question', 'Where', 'Impact'], rows)


class ReferenceIdRegressionTests(unittest.TestCase):
    def test_rename_after_exact_matching_preserves_remaining_shared_citation_id(self):
        rules = [{'name': name, 'source': 'legacy/a.cbl:10'} for name in ('Alpha', 'Beta')]
        first, ledger = cc.assign_rule_ids('CARD01', rules)
        for current in ([rules[0], {**rules[1], 'name': 'Beta renamed'}],
                        [{**rules[1], 'name': 'Beta renamed'}, rules[0]]):
            again, _ = cc.assign_rule_ids('CARD01', current, ledger)
            self.assertEqual({r['name']: r['id'] for r in again},
                             {'Alpha': first[0]['id'], 'Beta renamed': first[1]['id']})

    def test_two_unmatched_rules_at_one_citation_are_not_guessed(self):
        first, ledger = cc.assign_rule_ids('CARD01', [{'name': n, 'source': 'legacy/a.cbl:10'} for n in ('A', 'B')])
        again, _ = cc.assign_rule_ids('CARD01', [{'name': n, 'source': 'legacy/a.cbl:10'} for n in ('C', 'D')], ledger)
        self.assertTrue({r['id'] for r in first}.isdisjoint({r['id'] for r in again}))

    def test_retired_number_is_not_given_to_a_new_identity(self):
        first, ledger = cc.assign_rule_ids('CARD01', [{'name': 'A', 'source': 'legacy/a.cbl:10'}])
        _, retired = cc.assign_rule_ids('CARD01', [], ledger)
        again, _ = cc.assign_rule_ids('CARD01', [{'name': 'B', 'source': 'legacy/a.cbl:10'}], retired)
        self.assertNotEqual(first[0]['id'], again[0]['id'])

    def test_equivalent_gap_rows_merge_and_all_draft_references_follow_persisted_ids(self):
        original = specification([
            ['GAP-CARD01-0001', 'unresolved', 'Which mode?', 'legacy/a.cbl:10', 'risk'],
            ['GAP-CARD01-0002', 'missing-source', 'Where is the copybook?', 'legacy/a.cbl:20', 'blocking'],
        ])
        _, ledger = gaps.assign_gap_ids(original, 'CARD01')
        rerun = specification([
            ['GAP-CARD01-0001', 'missing-source', 'Where is the copybook?', 'legacy/a.cbl:20', 'blocking'],
            ['GAP-CARD01-0002', 'unresolved', 'Which mode?', 'legacy/a.cbl:10', 'risk'],
            ['GAP-CARD01-0003', 'unresolved', 'Which mode?', '`legacy/a.cbl:10`', 'risk'],
        ], 'First GAP-CARD01-0001; second GAP-CARD01-0002. Also (gap: GAP-CARD01-0003).')
        text, updated = gaps.assign_gap_ids(rerun, 'CARD01', ledger)
        self.assertIn('First GAP-CARD01-0002; second GAP-CARD01-0001.', text)
        self.assertIn('(gap: GAP-CARD01-0001)', text)
        self.assertNotIn('GAP-CARD01-0003', text)
        self.assertEqual(len(gaps.checked_gaps(text)), 2)
        self.assertEqual(docmd.split_front_matter(updated)[0]['allocated'], 2)

    def test_writer_validator_rejects_dangling_references_before_finish(self):
        text = specification([
            ['GAP-CARD01-0001', 'unresolved', 'Which mode?', 'legacy/a.cbl:10', 'risk'],
        ], 'See (gap: GAP-CARD01-0002).')
        with self.assertRaisesRegex(cc.refs.DataError, 'no table row'):
            gaps.checked_gaps(text)
        with self.assertRaisesRegex(cc.refs.DataError, 'no table row'):
            gaps.checked_gaps('# Unit\n\nGAP-CARD01-0001.\n\n## Gaps and questions\n\nNone.\n')

    def test_writer_validator_rejects_conflicting_equivalent_gap_rows(self):
        text = specification([
            ['GAP-CARD01-0001', 'unresolved', 'Which mode?', 'legacy/a.cbl:10', 'risk'],
            ['GAP-CARD01-0002', 'unresolved', 'Which mode?', 'legacy/a.cbl:10', 'blocking'],
        ])
        with self.assertRaisesRegex(cc.refs.DataError, 'conflicting impacts'):
            gaps.checked_gaps(text)
