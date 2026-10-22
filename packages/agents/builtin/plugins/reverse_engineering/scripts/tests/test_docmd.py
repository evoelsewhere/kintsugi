import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import docmd  # noqa: E402


class FrontMatterTests(unittest.TestCase):
    def test_round_trips_scalars_and_lists(self):
        fields = {'app': 'billing-web', 'items': 12, 'ok': True, 'none': None, 'languages': ['Java', 'C#'], 'empty': [], 'quote': 'say "hi"'}
        text = docmd.front_matter(fields) + '\n# Title\n'
        data, body = docmd.split_front_matter(text)
        self.assertEqual(data['app'], 'billing-web')
        self.assertEqual(data['items'], 12)
        self.assertIs(data['ok'], True)
        self.assertIsNone(data['none'])
        self.assertEqual(data['languages'], ['Java', 'C#'])
        self.assertEqual(data['empty'], [])
        self.assertEqual(data['quote'], 'say "hi"')
        self.assertEqual(body, '# Title')

    def test_a_document_without_front_matter_is_all_body(self):
        data, body = docmd.split_front_matter('# Title\n\ntext')
        self.assertEqual(data, {})
        self.assertEqual(body, '# Title\n\ntext')

    def test_an_unterminated_block_is_not_front_matter(self):
        self.assertEqual(docmd.split_front_matter('---\na: 1\n# no end')[0], {})


class TableTests(unittest.TestCase):
    def test_round_trips_cells_with_pipes_and_code(self):
        rows = [['a|b', '`x|y`', 'plain'], ['', 'two  words', 'end\\']]
        parsed = docmd.tables_in(docmd.table(['One', 'Two', 'Three'], rows))
        self.assertEqual(len(parsed), 1)
        header, got = parsed[0]
        self.assertEqual(header, ['One', 'Two', 'Three'])
        self.assertEqual(got[0], ['a|b', '`x|y`', 'plain'])
        self.assertEqual(got[1], ['', 'two words', 'end\\'])

    def test_records_are_keyed_by_the_lower_cased_header(self):
        text = docmd.table(['Rule', 'Verdict'], [['RULE-a-1', 'confirmed']])
        self.assertEqual(docmd.records_in(text), [{'rule': 'RULE-a-1', 'verdict': 'confirmed'}])

    def test_tables_inside_fenced_code_are_skipped(self):
        text = '```\n| a |\n| --- |\n| 1 |\n```\n'
        self.assertEqual(docmd.tables_in(text), [])


class CardTests(unittest.TestCase):
    def test_round_trips_a_card(self):
        card = (
            docmd.heading(2, 'invoicing/entry', 'Invoice entry') + '\n\nEnters invoices.\n\n'
            + docmd.field_lines({'kind': 'screen', 'loc': 120, 'aliases': ['old', 'older'], 'note': ''}, coded=('digest',))
            + '\n### Depends on\n\n' + docmd.table(['Item', 'Kinds'], [['core/db', 'call']])
            + '\n### Files\n\n' + docmd.bullet_list(['src/a.java', 'src/b.java'])
        )
        text = '# Catalog\n\n' + card + '\n' + docmd.heading(2, 'invoicing/other', 'Other') + '\n\nSecond.\n'
        cards = docmd.sections(text, 2)
        self.assertEqual([docmd.split_heading(title)[0] for title, _ in cards], ['invoicing/entry', 'invoicing/other'])
        prose, fields, subs = docmd.parse_card(cards[0][1], 2)
        self.assertEqual(prose, 'Enters invoices.')
        self.assertEqual(fields['kind'], 'screen')
        self.assertEqual(docmd.as_int(fields['loc']), 120)
        self.assertEqual(fields['aliases'], ['old', 'older'])
        self.assertEqual(docmd.as_list(fields['note']), [])
        self.assertEqual(docmd.records_in(subs['Depends on']), [{'item': 'core/db', 'kinds': 'call'}])
        self.assertEqual(docmd.bullets_in(subs['Files']), ['src/a.java', 'src/b.java'])

    def test_headings_inside_fenced_code_are_not_sections(self):
        text = '## Real\n\n```\n## Fake\n```\n'
        self.assertEqual([title for title, _ in docmd.sections(text, 2)], ['Real'])


class FileTests(unittest.TestCase):
    def test_writes_atomically_and_refuses_links_and_oversize(self):
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, 'a', 'doc.md')
            docmd.write_text(path, 'hello')
            self.assertEqual(docmd.read_text(path), 'hello\n')
            with self.assertRaises(docmd.DataError):
                docmd.read_text(path, limit=2)

    def test_scratch_json_round_trips(self):
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, 'x.json')
            docmd.write_json(path, {'a': [1, 2]})
            self.assertEqual(docmd.read_json(path), {'a': [1, 2]})

    def test_norm_path_rejects_escapes(self):
        self.assertEqual(docmd.norm_path('src\\a/../b.java'), 'src/b.java')
        for bad in ('', '/etc/passwd', '../x', '.', None):
            self.assertIsNone(docmd.norm_path(bad))


if __name__ == '__main__':
    unittest.main()
