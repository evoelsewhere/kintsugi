"""Tests for the design-set scripts: design_lib, scaffold_design, check_design, validate_design_templates.

Run:  python -m pytest packages/agents/builtin/plugins/modernize/scripts/tests/test_design.py
The fixtures are shared with hooks/tests of the reverse_engineering plugin (`design.test.ts`): the TypeScript reader the API
runs and `design_lib.py` the member's harness runs must give the same answers for the same files.
"""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import design_lib as dl  # noqa: E402

FIXTURES = os.path.join(HERE, 'fixtures', 'design')


def read(*parts):
    with open(os.path.join(FIXTURES, *parts), encoding='utf-8') as handle:
        return handle.read()


def sources_of(group):
    out = []
    for folder in sorted(os.listdir(os.path.join(FIXTURES, group))):
        directory = os.path.join(FIXTURES, group, folder)
        if not os.path.isdir(directory):
            continue
        files = [name for name in sorted(os.listdir(directory)) if name.endswith('.md')]
        out.append({'folder': folder, 'set_text': read(group, folder, 'set.md') if 'set.md' in files else None,
                    'templates': {name: read(group, folder, name) for name in files if name != 'set.md'}})
    return out


CASES = json.loads(read('cases.json'))
EXPECTED = json.loads(read('expected.json'))


class SharedFixtures(unittest.TestCase):
    def test_the_good_sets_are_valid(self):
        sets, problems = dl.load_sets(sources_of('sets'), CASES['unitKinds'])
        self.assertEqual(problems, [])
        self.assertEqual([loaded['set']['id'] for loaded in sets], ['basic', 'detail'])

    def test_the_faulty_sets_give_the_recorded_problems(self):
        sets, problems = dl.load_sets(sources_of('bad-sets'), CASES['unitKinds'])
        self.assertEqual(problems, EXPECTED['validate']['bad-sets'])
        self.assertEqual([loaded['set']['id'] for loaded in sets], EXPECTED['validate']['bad-set-ids'])

    def test_every_design_gives_the_recorded_problems_and_staleness(self):
        sets, _ = dl.load_sets(sources_of('sets'), CASES['unitKinds'])
        by_id = {loaded['set']['id']: loaded for loaded in sets}
        for case in CASES['cases']:
            loaded = by_id[case['set']]
            text = read('designs', case['file'])
            got = {
                'problems': dl.check_document(loaded['templates'][case['template']], loaded['set'], text, CASES['context']),
                'stale': dl.is_stale(text, loaded['set']),
            }
            self.assertEqual(got, EXPECTED['designs'][case['file']], case['file'])


class Reading(unittest.TestCase):
    def test_a_set_keeps_its_identity_files_and_description(self):
        set_, problems = dl.parse_set(read('sets', 'detail', 'set.md'), 'detail')
        self.assertEqual(problems, [])
        self.assertEqual((set_['id'], set_['title'], set_['version'], set_['appliesTo'], set_['needs'], set_['stage']),
                         ('detail', 'Detail design', 2, ['screen', 'api'], ['basic'], 'detail-design'))
        self.assertEqual(set_['files'], [{'path': 'logic.md', 'template': 'logic.md', 'required': True, 'when': []},
                                         {'path': 'sql.md', 'template': 'sql.md', 'required': False, 'when': ['api']}])
        self.assertIn('How the unit is built.', set_['description'])

    def test_which_files_a_unit_of_a_kind_needs(self):
        set_, _ = dl.parse_set(read('sets', 'detail', 'set.md'), 'detail')
        self.assertEqual([f['path'] for f in dl.files_for(set_, 'screen')], ['logic.md'])
        self.assertEqual([f['path'] for f in dl.files_for(set_, 'api')], ['logic.md', 'sql.md'])
        self.assertEqual(dl.files_for(set_, 'batch'), [])

    def test_a_template_section_is_a_heading_with_a_directive_block_and_only_that(self):
        sections, problems = dl.parse_template(read('sets', 'detail', 'logic.md'))
        self.assertEqual(problems, [])
        self.assertEqual([(s['heading'], s['required'], len(s['table'])) for s in sections], [('Business rules', True, 3), ('Error handling', True, 3), ('Dependencies', False, 2)])
        self.assertEqual(sections[0]['checks'], [{'name': 'covers-rules', 'column': 'Rule'}, {'name': 'refs-resolve', 'column': 'Function', 'source': 'basic'}, {'name': 'no-placeholder'}])

    def test_the_design_items_of_a_document_are_the_cells_of_its_id_columns(self):
        self.assertEqual(dl.item_ids('| ID | Function |\n| --- | --- |\n| F-001 | a |\n| TODO | b |\n\n| Rule | x |\n| --- | --- |\n| R-1 | y |\n'), ['F-001'])


if __name__ == '__main__':
    unittest.main()
