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


def markdown_in(*parts):
    directory = os.path.join(FIXTURES, *parts)
    return [name for name in sorted(os.listdir(directory)) if name.endswith('.md')] if os.path.isdir(directory) else []


def sources_of(group):
    out = []
    for folder in sorted(os.listdir(os.path.join(FIXTURES, group))):
        directory = os.path.join(FIXTURES, group, folder)
        if not os.path.isdir(directory):
            continue
        files = markdown_in(group, folder)
        profiles = {}
        for kind in sorted(os.listdir(directory)):
            if kind.startswith('_') or not os.path.isdir(os.path.join(directory, kind)):
                continue
            inside = markdown_in(group, folder, kind)
            profiles[kind] = {'profile_text': read(group, folder, kind, 'profile.md') if 'profile.md' in inside else None,
                              'templates': {name: read(group, folder, kind, name) for name in inside if name != 'profile.md'},
                              'examples': markdown_in(group, folder, kind, '_examples')}
        out.append({'folder': folder, 'set_text': read(group, folder, 'set.md') if 'set.md' in files else None,
                    'templates': {name: read(group, folder, name) for name in files if name != 'set.md'},
                    'examples': markdown_in(group, folder, '_examples'), 'profiles': profiles})
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
        omega = next(loaded for loaded in sets if loaded['set']['id'] == 'omega')
        self.assertEqual(sorted(omega['profiles']), EXPECTED['validate']['bad-profile-kinds'])

    def test_every_design_gives_the_recorded_problems_and_staleness(self):
        sets, _ = dl.load_sets(sources_of('sets'), CASES['unitKinds'])
        by_id = {loaded['set']['id']: loaded for loaded in sets}
        for case in CASES['cases']:
            loaded = by_id[case['set']]
            text = read('designs', case['file'])
            # A case names the kind it is written for; without one it is written with the set's own template.
            file = next((f for f in dl.files_for(loaded, case['kind']) if f['template'] == case['template']), None) if 'kind' in case else None
            template = loaded['templates'][case['template']] if file is None else dl.template_of(loaded, file)
            ref = {'id': loaded['set']['id'], 'version': loaded['set']['version']} if file is None else file['ref']
            got = {'problems': dl.check_document(template, ref, text, CASES['context']), 'stale': dl.is_stale(text, ref)}
            self.assertEqual(got, EXPECTED['designs'][case['file']], case['file'])

    def test_the_files_of_each_set_for_each_kind_are_the_recorded_ones(self):
        sets, _ = dl.load_sets(sources_of('sets'), CASES['unitKinds'])
        got = {}
        for loaded in sets:
            for kind in CASES['resolveKinds']:
                got[f'{loaded["set"]["id"]}/{kind}'] = [
                    {'path': f['path'], 'template': f['template'], 'required': f['required'], 'templateFile': f['templateFile'],
                     'ref': dl.ref_text(f['ref']), 'profile': f['profile'], 'example': f['example']}
                    for f in dl.files_for(loaded, kind)]
        self.assertEqual(got, EXPECTED['resolved'])


class Scope(unittest.TestCase):
    """Design sets of the application, their reads and instructions (ADR-0050); the answers are shared with design.test.ts."""

    def arch(self):
        set_, problems = dl.parse_set(read('app-sets', 'arch', 'set.md'), 'arch')
        self.assertEqual(problems, [])
        return set_

    def test_the_good_application_sets_are_valid_and_the_faulty_ones_give_the_recorded_problems(self):
        sets, problems = dl.load_sets(sources_of('app-sets'), CASES['unitKinds'])
        self.assertEqual(problems, EXPECTED['validate']['app-sets'])
        self.assertEqual([(s['set']['id'], s['set']['scope'], s['set']['needs']) for s in sets], [('arch', 'application', []), ('dbunit', 'unit', ['arch'])])
        sets, problems = dl.load_sets(sources_of('bad-app-sets'), CASES['unitKinds'])
        self.assertEqual(problems, EXPECTED['validate']['bad-app-sets'])
        self.assertEqual([s['set']['id'] for s in sets], EXPECTED['validate']['bad-app-set-ids'])

    def test_every_application_design_gives_the_recorded_problems(self):
        sets, _ = dl.load_sets(sources_of('app-sets'), CASES['unitKinds'])
        by_id = {loaded['set']['id']: loaded for loaded in sets}
        for case in CASES['appCases']:
            loaded = by_id[case['set']]
            text = read('designs', case['file'])
            ref = {'id': loaded['set']['id'], 'version': loaded['set']['version']}
            got = {'problems': dl.check_document(loaded['templates'][case['template']], ref, text, CASES['appContext']), 'stale': dl.is_stale(text, ref)}
            self.assertEqual(got, EXPECTED['appDesigns'][case['file']], case['file'])

    def test_a_set_is_for_units_unless_it_says_application(self):
        basic, _ = dl.parse_set(read('sets', 'basic', 'set.md'), 'basic')
        self.assertEqual((basic['scope'], basic['reads'], basic['instructions']), ('unit', [], ''))
        arch = self.arch()
        self.assertEqual((arch['scope'], arch['needs'], arch['reads'], arch['stage']), ('application', [], ['10-applications/{app}/01-legacy/', '02-architecture/'], 'architecture-design'))

    def test_the_instructions_section_is_for_the_designer_and_leaves_the_description(self):
        arch = self.arch()
        self.assertEqual(arch['instructions'], 'Describe the target in terms of the common components.\nCite the assessment for what the legacy system does today.')
        self.assertEqual(arch['description'], 'How the application is built as a whole, written once for the application.')

    def test_an_application_set_has_files_and_no_unit_kind(self):
        sets, _ = dl.load_sets(sources_of('app-sets'), CASES['unitKinds'])
        by_id = {loaded['set']['id']: loaded for loaded in sets}
        self.assertEqual([f['path'] for f in dl.files_for(by_id['arch'], None)], ['overview.md'])
        self.assertEqual(dl.files_for(by_id['arch'], 'screen'), [])
        self.assertEqual(dl.files_for(by_id['dbunit'], None), [])


class Reading(unittest.TestCase):
    def test_a_set_keeps_its_identity_files_and_description(self):
        set_, problems = dl.parse_set(read('sets', 'detail', 'set.md'), 'detail')
        self.assertEqual(problems, [])
        self.assertEqual((set_['id'], set_['title'], set_['version'], set_['needs'], set_['stage'], set_['instructions']),
                         ('detail', 'Detail design', 2, ['basic'], 'detail-design', 'Cite every rule by its id.'))
        self.assertEqual(set_['files'], [{'path': 'logic.md', 'template': 'logic.md', 'required': True}])
        self.assertIn('How the unit is built.', set_['description'])

    def test_a_profile_keeps_its_kind_version_removed_files_added_files_and_instructions(self):
        self.assertEqual(dl.parse_profile(read('sets', 'detail', 'api', 'profile.md'), 'api'),
                         ({'kind': 'api', 'version': 1, 'files': [{'path': 'sql.md', 'template': 'sql.md', 'required': False}], 'removes': [],
                           'instructions': 'Name every query and its parameters.'}, []))
        batch, _ = dl.parse_profile(read('sets', 'detail', 'batch', 'profile.md'), 'batch')
        self.assertEqual((batch['kind'], batch['version'], batch['removes'], batch['files']), ('batch', 1, ['logic.md'], [{'path': 'job.md', 'template': 'job.md', 'required': True}]))
        self.assertEqual(dl.parse_profile('# No front matter', 'api'), (None, ['has no front matter']))

    def test_which_files_a_unit_of_a_kind_needs(self):
        sets, _ = dl.load_sets(sources_of('sets'), CASES['unitKinds'])
        detail = next(loaded for loaded in sets if loaded['set']['id'] == 'detail')

        def paths_of(kind):
            return [f['path'] for f in dl.files_for(detail, kind)]
        self.assertEqual(paths_of('other'), ['logic.md'])
        self.assertEqual(paths_of('screen'), ['logic.md'])
        self.assertEqual(paths_of('api'), ['logic.md', 'sql.md'])
        self.assertEqual(paths_of('batch'), ['job.md'])
        self.assertEqual(paths_of(None), [])
        screen, api_logic, other = dl.files_for(detail, 'screen')[0], dl.files_for(detail, 'api')[0], dl.files_for(detail, 'other')[0]
        self.assertEqual((screen['profile'], screen['templateFile'], screen['ref'], screen['example']),
                         ('screen', 'screen/logic.md', {'id': 'detail/screen', 'version': 3}, 'screen/_examples/logic.md'))
        self.assertEqual((api_logic['profile'], api_logic['ref']), (None, {'id': 'detail', 'version': 2}))
        self.assertEqual((other['templateFile'], other['example']), ('logic.md', '_examples/logic.md'))
        self.assertEqual([s['heading'] for s in dl.template_of(detail, screen)['sections']], ['Business rules', 'Screen events'])

    def test_a_template_section_is_a_heading_with_a_directive_block_and_only_that(self):
        sections, problems = dl.parse_template(read('sets', 'detail', 'logic.md'))
        self.assertEqual(problems, [])
        self.assertEqual([(s['heading'], s['required'], len(s['table'])) for s in sections], [('Business rules', True, 3), ('Error handling', True, 3), ('Dependencies', False, 2)])
        self.assertEqual(sections[0]['checks'], [{'name': 'covers-rules', 'column': 'Rule'}, {'name': 'refs-resolve', 'column': 'Function', 'source': 'basic'}, {'name': 'no-placeholder'}])

    def test_the_design_items_of_a_document_are_the_cells_of_its_id_columns(self):
        self.assertEqual(dl.item_ids('| ID | Function |\n| --- | --- |\n| F-001 | a |\n| TODO | b |\n\n| Rule | x |\n| --- | --- |\n| R-1 | y |\n'), ['F-001'])


if __name__ == '__main__':
    unittest.main()
