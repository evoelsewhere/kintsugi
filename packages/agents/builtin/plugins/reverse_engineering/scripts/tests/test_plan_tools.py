import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.dirname(HERE)
sys.path.insert(0, SCRIPTS)
import catalog_common as cc  # noqa: E402
import docmd  # noqa: E402


def run(script, *args):
    return subprocess.run([sys.executable, os.path.join(SCRIPTS, script), *args], capture_output=True, text=True)


def write(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='') as handle:
        handle.write(value if isinstance(value, str) else json.dumps(value))


def load(path):
    with open(path, encoding='utf-8') as handle:
        return json.load(handle)


def item(item_id, files, leaves, **extra):
    return {'id': item_id, 'module': item_id.split('/')[0], 'kind': 'program', 'name': item_id.split('/')[1], 'summary': '', 'files': files,
            'leaves': leaves, 'entryPoints': [], 'loc': 100, 'complexity': 'low', 'digest': f'sha256:{item_id}', 'status': 'active', 'aliases': [], 'parts': [], **extra}


# web/entry -> core/service -> core/base; core/service -> ds:ORDERS; web/entry also calls core/base.
# batch/a <-> batch/b call each other. core/tests holds only tests. core/old is retired.
CATALOG = {
    'app': 'shop', 'source': {'repo': 'legacy', 'commit': 'a' * 40},
    'modules': [{'id': 'web', 'name': 'Web', 'summary': ''}, {'id': 'core', 'name': 'Core', 'summary': ''}, {'id': 'batch', 'name': 'Batch', 'summary': ''}],
    'items': [
        item('web/entry', ['src/Entry.java'], ['ENTRY'], complexity='medium', loc=300, entryPoints=['ENTRY']),
        item('core/service', ['src/Service.java'], ['SERVICE'], complexity='high', loc=900),
        item('core/base', ['src/Base.java'], ['BASE'], complexity='high', loc=1500),
        item('batch/a', ['src/A.java'], ['A'], loc=200),
        item('batch/b', ['src/B.java'], ['B'], loc=250),
        item('core/tests', ['src/test/java/AllTests.java'], ['TESTS'], loc=4000),
        item('core/old', ['src/Old.java'], ['OLD'], status='retired'),
    ],
    'unassigned': [], 'ambiguities': [],
}

TOPOLOGY = {
    'system': 'shop',
    'root': {'id': 'sys', 'name': 'shop', 'kind': 'system', 'children': [
        {'id': 'dom:web', 'name': 'Web', 'kind': 'domain', 'children': [{'id': 'ENTRY', 'name': 'ENTRY', 'kind': 'module', 'file': 'src/Entry.java'}]},
        {'id': 'dom:core', 'name': 'Core', 'kind': 'domain', 'children': [
            {'id': 'SERVICE', 'name': 'SERVICE', 'kind': 'module', 'file': 'src/Service.java'},
            {'id': 'BASE', 'name': 'BASE', 'kind': 'module', 'file': 'src/Base.java'},
            {'id': 'TESTS', 'name': 'TESTS', 'kind': 'module', 'file': 'src/test/java/AllTests.java'},
        ]},
        {'id': 'dom:batch', 'name': 'Batch', 'kind': 'domain', 'children': [{'id': 'A', 'name': 'A', 'kind': 'module', 'file': 'src/A.java'}, {'id': 'B', 'name': 'B', 'kind': 'module', 'file': 'src/B.java'}]},
        {'id': 'dom:data', 'name': 'Data', 'kind': 'domain', 'children': [{'id': 'ds:ORDERS', 'name': 'ORDERS', 'kind': 'datastore'}]},
    ]},
    'edges': [
        {'source': 'ENTRY', 'target': 'SERVICE', 'kind': 'call'},
        {'source': 'ENTRY', 'target': 'BASE', 'kind': 'call'},
        {'source': 'SERVICE', 'target': 'BASE', 'kind': 'call'},
        {'source': 'SERVICE', 'target': 'ds:ORDERS', 'kind': 'write'},
        {'source': 'A', 'target': 'B', 'kind': 'call'},
        {'source': 'B', 'target': 'A', 'kind': 'call'},
    ],
    'entryPoints': ['ENTRY'], 'deadEnds': [], 'observations': [], 'flows': [],
}


def read_plan(path):
    """plan.md as the data it was written from."""
    front, body = docmd.split_front_matter(docmd.read_text(path))
    plan = {'front': front, 'batches': [], 'leftOut': [], 'dropped': []}
    for title, card in docmd.sections(body, 2):
        ident, name = docmd.split_heading(title)
        if ident.startswith('Batch '):
            prose, fields, subs = docmd.parse_card(card, 2)
            plan['batches'].append({
                'n': int(ident.split()[1]), 'title': name, 'rationale': prose, 'risk': fields['risk'], 'loc': int(fields['loc']), 'high': int(fields['high complexity']),
                'cohesion': float(fields['cohesion']) if fields['cohesion'] != '' else None, 'items': docmd.bullets_in(subs['Items']),
                'dependsOutside': [{'item': row['item'], 'usedBy': row['used by'].split(', ')} for row in docmd.records_in(subs.get('Depends on outside', ''))],
            })
        elif title in ('Left out', 'Dropped'):
            plan['leftOut' if title == 'Left out' else 'dropped'] = [{'item': row['item'], 'reason': row['reason']} for row in docmd.records_in(card)]
    return plan


class PlanToolsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = self.temp.name
        self.units = os.path.join(self.root, '10-applications', 'shop', '01-legacy')
        self.out = os.path.join(self.root, 'out')
        self.graph_path = os.path.join(self.out, 'scratch', 'shop', 'understand', 'graph.json')
        self.plan_path = os.path.join(self.out, '10-applications', 'shop', '01-legacy', 'plan.md')
        # The catalog the assess stage committed, links included.
        self.catalog = os.path.join(self.root, 'catalog')
        graph = cc.item_graph(CATALOG['items'], TOPOLOGY)
        for path, text in cc.render_catalog('shop', CATALOG, graph).items():
            write(os.path.join(self.root, 'docs', *path.split('/')), text)
        self.catalog = os.path.join(self.root, 'docs', *cc.paths.assessment_catalog_dir('shop').split('/'))

    def tearDown(self):
        self.temp.cleanup()

    def graph(self):
        result = run('plan_graph.py', 'shop', '--catalog', self.catalog, '--existing', self.units, '--out', self.out)
        self.assertEqual(result.returncode, 0, result.stderr)
        return load(self.graph_path), result.stdout

    def test_graph_links_items_through_their_cards_and_orders_them_by_depth(self):
        graph, stdout = self.graph()
        by_id = {entry['id']: entry for entry in graph['items']}
        self.assertEqual(sorted(by_id), ['batch/a', 'batch/b', 'core/base', 'core/service', 'core/tests', 'web/entry'])
        self.assertEqual([dep['item'] for dep in by_id['web/entry']['dependsOn']], ['core/base', 'core/service'])
        self.assertEqual(by_id['core/base']['usedBy'], ['core/service', 'web/entry'])
        self.assertEqual(by_id['core/base']['fanIn'], 2)
        self.assertEqual(by_id['core/service']['dataStores'], [{'id': 'ds:ORDERS', 'access': ['write']}])
        self.assertTrue(by_id['web/entry']['entryPoint'])
        # base depends on nothing (0); service on base (1); entry on both (2).
        self.assertEqual([by_id[key]['depth'] for key in ('core/base', 'core/service', 'web/entry')], [0, 1, 2])
        self.assertEqual(graph['cycles'], [['batch/a', 'batch/b']])
        self.assertEqual(by_id['batch/a']['cycle'], ['batch/a', 'batch/b'])
        self.assertEqual(by_id['batch/a']['depth'], by_id['batch/b']['depth'])
        self.assertEqual(by_id['core/tests']['assetClass'], 'test')
        self.assertEqual(graph['source'], {'repo': 'legacy', 'commit': 'a' * 40})
        self.assertIn('5 open code item(s)', stdout)

    def test_graph_marks_items_with_an_understanding_record_as_understood(self):
        write(os.path.join(self.units, 'core', 'base', 'understanding.md'), '---\nstatus: "understood"\n---\n')
        graph, stdout = self.graph()
        self.assertEqual({entry['id'] for entry in graph['items'] if entry['understood']}, {'core/base'})
        self.assertIn('4 open code item(s)', stdout)

    def test_graph_without_links_has_no_dependencies(self):
        bare = {**CATALOG, 'items': [{**entry} for entry in CATALOG['items']]}
        for path, text in cc.render_catalog('shop', bare, {}).items():
            write(os.path.join(self.root, 'bare', *path.split('/')), text)
        result = run('plan_graph.py', 'shop', '--catalog', os.path.join(self.root, 'bare', *cc.paths.assessment_catalog_dir('shop').split('/')), '--out', self.out)
        self.assertEqual(result.returncode, 0, result.stderr)
        graph = load(self.graph_path)
        self.assertTrue(all(entry['dependsOn'] == [] and entry['depth'] == 0 for entry in graph['items']))
        self.assertFalse(graph['stats']['linked'])

    def plan(self, draft, *extra):
        self.graph()
        draft_path = os.path.join(self.root, 'draft.json')
        write(draft_path, draft)
        return run('check_plan.py', 'shop', '--draft', draft_path, '--graph', self.graph_path, '--out', self.out, *extra)

    def test_a_valid_draft_becomes_a_plan_with_the_numbers_only_the_graph_can_give(self):
        result = self.plan({
            'strategy': 'Foundations first, then what uses them.',
            'batches': [
                {'title': 'Foundations', 'items': ['core/base', 'core/service'], 'rationale': 'Everything calls them.', 'risk': 'high'},
                {'title': 'Entry', 'items': ['web/entry'], 'rationale': 'Needs both.', 'risk': 'urgent'},
            ],
            'leftOut': [{'item': 'batch/a', 'reason': 'Low value.'}],
        })
        self.assertEqual(result.returncode, 0, result.stderr)
        plan = read_plan(self.plan_path)
        first, second = plan['batches']
        self.assertEqual((first['n'], first['title'], first['loc'], first['high']), (1, 'Foundations', 2400, 2))
        self.assertEqual(first['rationale'], 'Everything calls them.')
        # service -> base is inside the batch; service -> ORDERS is a data store, not a call to an item.
        self.assertEqual(first['cohesion'], 1.0)
        self.assertEqual(first['dependsOutside'], [])
        # An unknown risk becomes medium; entry depends on two items already planned in an earlier batch.
        self.assertEqual(second['risk'], 'medium')
        self.assertEqual(second['cohesion'], 0.0)
        self.assertEqual(second['dependsOutside'], [])
        self.assertEqual((plan['front']['catalogCommit'], plan['front']['items'], plan['front']['open']), ('a' * 40, 6, 5))
        self.assertEqual(plan['leftOut'], [{'item': 'batch/a', 'reason': 'Low value.'}])
        self.assertEqual((plan['front']['batches'], plan['front']['planned']), (2, 3))
        self.assertNotIn('.json', docmd.read_text(self.plan_path))

    def test_a_batch_that_leaves_a_dependency_for_later_says_so(self):
        result = self.plan({'batches': [{'title': 'Top first', 'items': ['web/entry'], 'rationale': '', 'risk': 'low'}]})
        self.assertEqual(result.returncode, 0, result.stderr)
        outside = read_plan(self.plan_path)['batches'][0]['dependsOutside']
        self.assertEqual(outside, [{'item': 'core/base', 'usedBy': ['web/entry']}, {'item': 'core/service', 'usedBy': ['web/entry']}])

    def test_items_that_cannot_be_planned_are_dropped_with_the_reason(self):
        write(os.path.join(self.units, 'core', 'base', 'understanding.md'), '---\nstatus: "understood"\n---\n')
        result = self.plan({'batches': [
            {'title': 'Mixed', 'items': ['core/base', 'core/tests', 'nope/x', 'core/old', 'core/service', 'core/service'], 'rationale': '', 'risk': 'high'},
            {'title': 'Repeat', 'items': ['core/service'], 'rationale': '', 'risk': 'high'},
        ]})
        self.assertEqual(result.returncode, 0, result.stderr)
        plan = read_plan(self.plan_path)
        self.assertEqual([batch['items'] for batch in plan['batches']], [['core/service']])
        reasons = {entry['item']: entry['reason'] for entry in plan['dropped']}
        self.assertEqual(reasons['core/base'], 'understood already')
        self.assertEqual(reasons['core/tests'], 'test code is not planned')
        self.assertEqual(reasons['nope/x'], 'not an item of the catalog')
        self.assertEqual(reasons['core/old'], 'not an item of the catalog')
        self.assertEqual(reasons['core/service'], 'already in an earlier batch')

    def test_a_batch_over_the_size_cap_keeps_its_first_items(self):
        result = self.plan({'batches': [{'title': 'Big', 'items': ['core/base', 'core/service', 'web/entry'], 'rationale': '', 'risk': 'high'}]}, '--max-batch', '2')
        self.assertEqual(result.returncode, 0, result.stderr)
        plan = read_plan(self.plan_path)
        self.assertEqual(plan['batches'][0]['items'], ['core/base', 'core/service'])
        self.assertEqual(plan['dropped'], [{'item': 'web/entry', 'reason': 'a batch holds at most 2 items'}])

    def test_a_draft_with_nothing_left_fails_with_the_reason(self):
        result = self.plan({'batches': [{'title': 'Tests', 'items': ['core/tests'], 'rationale': '', 'risk': 'low'}]})
        self.assertEqual(result.returncode, 1)
        self.assertIn('no batch is left', result.stderr)
        self.assertFalse(os.path.exists(self.plan_path))
        bad = self.plan({'strategy': 'no batches here'})
        self.assertEqual(bad.returncode, 1)
        self.assertIn('batches list', bad.stderr)


if __name__ == '__main__':
    unittest.main()
