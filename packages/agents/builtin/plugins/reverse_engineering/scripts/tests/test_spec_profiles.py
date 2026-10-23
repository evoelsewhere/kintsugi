import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import spec_profiles as sp  # noqa: E402

CORE = ('screen', 'api', 'batch-job', 'report', 'event', 'integration')


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='') as handle:
        handle.write(text)


class SpecProfileTests(unittest.TestCase):
    def test_every_core_kind_but_module_has_a_valid_built_in_profile(self):
        for kind in CORE:
            profile, notes = sp.load(kind)
            self.assertIsNotNone(profile, kind)
            self.assertEqual((profile['kind'], profile['version'], profile['source'], notes), (kind, 1, 'builtin', []))
            self.assertGreaterEqual(len(profile['sections']), 5, kind)
            self.assertTrue(profile['instructions'], kind)
        self.assertIsNone(sp.load('module')[0])
        self.assertIsNone(sp.load('../etc')[0])

    def test_a_project_profile_replaces_the_built_in_one_as_a_whole(self):
        with tempfile.TemporaryDirectory() as root:
            write(os.path.join(root, 'screen.md'), '---\nkind: "screen"\nversion: 3\n---\n## Sections\n\n| Section | What it holds | Evidence |\n|---|---|---|\n| Fields | all | map |\n')
            profile, notes = sp.load('screen', root)
            self.assertEqual((profile['source'], profile['version'], [section['name'] for section in profile['sections']], notes), ('project', 3, ['Fields'], []))

    def test_an_unusable_project_profile_is_reported_and_the_built_in_one_is_used(self):
        with tempfile.TemporaryDirectory() as root:
            write(os.path.join(root, 'screen.md'), '---\nkind: "api"\nversion: 0\n---\n## Sections\n\nnothing\n')
            profile, notes = sp.load('screen', root)
            self.assertEqual(profile['source'], 'builtin')
            self.assertEqual(len(notes), 1)
            self.assertIn('front matter kind', notes[0])
            self.assertIn('version', notes[0])
            self.assertIn('no section', notes[0])

    def test_missing_sections_ignores_numbering_case_and_deeper_headings(self):
        profile = {'sections': [{'name': 'Layout and fields'}, {'name': 'Validations'}]}
        text = '# Spec\n\n## 3. layout and FIELDS\n\n### Validations\n\nx\n'
        self.assertEqual(sp.missing_sections(profile, text), ['Validations'])
        self.assertEqual(sp.missing_sections(profile, '## Layout and fields\n\n## Validations\n'), [])


if __name__ == '__main__':
    unittest.main()
