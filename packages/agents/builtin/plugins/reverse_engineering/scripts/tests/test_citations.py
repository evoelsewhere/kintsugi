import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import citations  # noqa: E402


def write(root, rel, text):
    path = os.path.join(root, *rel.split('/'))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='') as handle:
        handle.write(text)


class Citations(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        write(self.root, 'legacy/src/TAX.cbl', 'LINE 1\nLINE 2\nLINE 3\nLINE 4\n')
        write(self.root, 'legacy/src/SHARED.cpy', 'ONE\n')
        write(self.root, 'legacy-data/schema/TAX.sql', 'CREATE TABLE TAX\n(RATE DECIMAL)')
        write(self.root, 'legacy-data/src/SHARED.cpy', 'ONE\n')
        write(self.root, 'secret.txt', 'outside\n')
        self.sources = citations.Sources({'legacy': os.path.join(self.root, 'legacy'), 'legacy-data': os.path.join(self.root, 'legacy-data')})

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_finds_citations_with_a_line_or_a_range_in_running_text(self):
        text = 'Rounds half up (`legacy/src/TAX.cbl:3`), see legacy/src/TAX.cbl:4-2 and RULE-TAX01-0001; at 10:30 nothing.'
        self.assertEqual(citations.citations_in(text), [('legacy/src/TAX.cbl', 3, 3), ('legacy/src/TAX.cbl', 2, 4)])
        self.assertEqual(citations.label(('legacy/src/TAX.cbl', 2, 4)), 'legacy/src/TAX.cbl:2-4')
        self.assertEqual(citations.label(('legacy/src/TAX.cbl', 3, 3)), 'legacy/src/TAX.cbl:3')

    def test_resolves_the_repository_id_the_zone_folder_or_a_path_one_repository_has(self):
        self.assertEqual(self.sources.resolve('legacy/src/TAX.cbl'), (('legacy', 'src/TAX.cbl'), None))
        self.assertEqual(self.sources.resolve('as-is/legacy-data/schema/TAX.sql'), (('legacy-data', 'schema/TAX.sql'), None))
        self.assertEqual(self.sources.resolve('schema/TAX.sql'), (('legacy-data', 'schema/TAX.sql'), None))
        self.assertEqual(self.sources.resolve('src/SHARED.cpy')[1], 'in several repositories (legacy, legacy-data): name one')
        self.assertEqual(self.sources.resolve('legacy/src/TAXTAB.cpy')[1], 'no such file in legacy')
        self.assertEqual(self.sources.resolve('TAX.cbl')[1], 'no such file in the sources')
        self.assertEqual(self.sources.resolve('legacy/../secret.txt')[1], 'not a path inside a repository')

    def test_a_line_past_the_end_or_line_zero_does_not_hold(self):
        self.assertEqual(self.sources.problem(('legacy/src/TAX.cbl', 4, 4)), (True, None))
        self.assertEqual(self.sources.problem(('legacy/src/TAX.cbl', 3, 5)), (True, 'line 5 is past the end of the file (4 lines)'))
        self.assertEqual(self.sources.problem(('legacy/src/TAX.cbl', 0, 0)), (True, 'no line number'))
        self.assertEqual(self.sources.problem(('legacy-data/schema/TAX.sql', 2, 2)), (True, None), 'a last line without a newline counts')

    def test_documents_are_not_source_citations(self):
        text = 'See 10-applications/billing/01-legacy/tax/calc/spec.md:12, rules/RULE-TAX01-0001.md:3 and _tools/extract_topology.py:9.'
        self.assertEqual(self.sources.check(text), (0, []))

    def test_check_counts_each_citation_once_and_lists_those_that_do_not_hold(self):
        text = ('Rate (legacy/src/TAX.cbl:3), again legacy/src/TAX.cbl:3, table legacy/src/TAXTAB.cpy:1, '
                'end legacy/src/TAX.cbl:9, schema schema/TAX.sql:1, spec.md:4.')
        checked, problems = self.sources.check(text)
        self.assertEqual(checked, 4)
        self.assertEqual(problems, [('legacy/src/TAXTAB.cpy:1', 'no such file in legacy'), ('legacy/src/TAX.cbl:9', 'line 9 is past the end of the file (4 lines)')])


if __name__ == '__main__':
    unittest.main()
