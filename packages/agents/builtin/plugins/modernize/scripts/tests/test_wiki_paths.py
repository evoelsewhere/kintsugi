"""paths.py answers every case of the wiki layout fixture as document-layout.ts does (ADR-0096).

The fixture, packages/domain/test/fixtures/wiki-layout.json, is read by this test and by
packages/domain/test/document-layout.test.ts, so a drift between the two implementations fails a test.
"""
import json
import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import paths  # noqa: E402

# scripts/tests -> scripts -> <plugin> -> plugins -> builtin -> agents -> packages
FIXTURE = os.path.join(HERE, *['..'] * 6, 'domain', 'test', 'fixtures', 'wiki-layout.json')


def snake(name):
    return re.sub(r'([A-Z])', lambda match: '_' + match.group(1).lower(), name)


def load_cases():
    with open(FIXTURE, encoding='utf-8') as handle:
        return json.load(handle)['cases']


@unittest.skipUnless(os.path.exists(FIXTURE), 'the shared fixture lives in packages/domain, which a copy of the plugin does not carry')
class WikiPathsTests(unittest.TestCase):
    def test_every_case_of_the_fixture_gives_the_same_answer_as_the_typescript_layout(self):
        cases = load_cases()
        self.assertGreater(len(cases), 150)
        for case in cases:
            name = snake(case['fn'])
            function = getattr(paths, name, None)
            self.assertTrue(callable(function), f'paths.py has no {name}')
            label = f'{name}({case["args"]!r})'
            expected = case['expect']
            if isinstance(expected, dict) and expected.get('throws'):
                with self.assertRaises(ValueError, msg=label):
                    function(*case['args'])
                continue
            actual = function(*case['args'])
            if isinstance(actual, tuple):
                actual = list(actual)
            self.assertEqual(actual, expected, label)

    def test_the_constants_equal_the_typescript_ones(self):
        self.assertEqual(paths.SPACES_ROOT, '20-spaces')
        self.assertEqual(paths.PAGE_TEMPLATES_DIR, '01-standards/page-templates')
        self.assertEqual(paths.ATTACHMENTS, '_attachments')
        self.assertEqual(paths.ATTACHMENT_EXTENSIONS, ('png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf'))
        self.assertEqual(paths.DOCUMENT_EXCLUDED_ROOTS, ('plugins', 'scratch'))
        self.assertEqual(paths.DOCUMENT_EXCLUDED_FOLDERS, ('restricted', 'identifiers'))

    def test_a_page_id_round_trips(self):
        for number in (1, 42, 9999, 10000, 999_999_999):
            self.assertEqual(paths.parse_page_id(paths.page_id('ONB', number)), ('ONB', number))


if __name__ == '__main__':
    unittest.main()
