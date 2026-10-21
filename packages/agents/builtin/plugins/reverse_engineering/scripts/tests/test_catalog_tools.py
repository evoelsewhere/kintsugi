import hashlib
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


def leaf(node_id, file, loc, kind='module', name=None):
    return {'id': node_id, 'name': name or node_id, 'kind': kind, 'file': file, 'loc': loc}


def inv_file(path, lines, complexity=1, content=None):
    return {'path': path, 'language': 'COBOL', 'codeLines': lines, 'cyclomaticComplexity': complexity,
            'sha256': hashlib.sha256((content or path).encode()).hexdigest()}


INVENTORY = {
    'app': 'billing', 'sourceRepository': 'legacy', 'sourceCommit': 'a' * 40,
    'files': [
        inv_file('src/billing/INVOICE.cbl', 900, 120),
        inv_file('src/billing/RATES.cbl', 400, 30),
        inv_file('src/billing/util/fmt1.cbl', 40),
        inv_file('src/billing/util/fmt2.cbl', 60),
        {'path': 'jcl/NIGHTLY.jcl', 'language': 'Other', 'bytes': 30, 'sha256': hashlib.sha256(b'jcl').hexdigest()},
        inv_file('src/cust/upd/CUSTUPD.cbl', 3000, 40),
        inv_file('src/cust/upd/CUSTLIB.cbl', 500, 10),
        inv_file('src/cust/upd/CUSTUPD2.cbl', 300, 5),
        {'path': 'README.md', 'language': 'Markdown', 'codeLines': 1, 'cyclomaticComplexity': 0, 'sha256': hashlib.sha256(b'r').hexdigest()},
    ],
}

TOPOLOGY = {
    'system': 'billing',
    'root': {'id': 'sys', 'name': 'billing', 'kind': 'system', 'children': [
        {'id': 'dom:billing', 'name': 'Billing', 'kind': 'domain', 'children': [
            leaf('INVOICE', 'src/billing/INVOICE.cbl', 900),
            leaf('RATES', 'src/billing/RATES.cbl', 400),
            leaf('fmt1', 'src/billing/util/fmt1.cbl', 40),
            leaf('fmt2', 'src/billing/util/fmt2.cbl', 60),
            leaf('NIGHTLY', 'jcl/NIGHTLY.jcl', 30, kind='job'),
        ]},
        {'id': 'dom:customers', 'name': 'Customers', 'kind': 'domain', 'children': [
            leaf('CUSTUPD', 'src/cust/upd', 3500),
            leaf('GHOST', 'src/gone/GHOST.cbl', 300),
        ]},
        {'id': 'dom:data', 'name': 'Data stores', 'kind': 'domain', 'children': [
            {'id': 'ds:INVOICES', 'name': 'INVOICES', 'kind': 'datastore'},
        ]},
    ]},
    'edges': [{'source': 'NIGHTLY', 'target': 'INVOICE', 'kind': 'call'}],
    'entryPoints': ['NIGHTLY'], 'deadEnds': [], 'observations': [], 'flows': [],
}


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = self.temp.name
        self.assessment = os.path.join(self.root, 'assessment', 'billing')
        write(os.path.join(self.assessment, 'topology.json'), TOPOLOGY)
        write(os.path.join(self.assessment, 'inventory.json'), INVENTORY)
        write(os.path.join(self.root, 'kintsugi.yaml'), 'schemaVersion: 1\nunitKinds: [screen, batch-job, program]\n')
        self.inventory = os.path.join(self.assessment, 'inventory.json')

    def tearDown(self):
        self.temp.cleanup()

    def commit(self, catalog, name='previous', graph=None):
        """The catalog as the Markdown the assess stage commits; returns the catalog folder."""
        root = os.path.join(self.root, name)
        for path, text in cc.render_catalog('billing', catalog, graph).items():
            write(os.path.join(root, *path.split('/')), text)
        return os.path.join(root, *cc.paths.assessment_catalog_dir('billing').split('/'))

    def propose(self, out='proposed.json'):
        path = os.path.join(self.root, out)
        result = run('catalog_from_topology.py', 'billing', '--topology', os.path.join(self.assessment, 'topology.json'), '--inventory', self.inventory, '--out', path,
                     '--manifest', os.path.join(self.root, 'kintsugi.yaml'))
        self.assertEqual(result.returncode, 0, result.stderr)
        return path

    def apply(self, catalog, edits):
        edits_path = os.path.join(self.root, 'edits.json')
        write(edits_path, edits)
        out = os.path.join(self.root, 'curated.json')
        result = run('apply_catalog_edits.py', '--catalog', catalog, '--edits', edits_path, '--inventory', self.inventory,
                     '--out', out, '--manifest', os.path.join(self.root, 'kintsugi.yaml'))
        self.assertEqual(result.returncode, 0, result.stderr)
        return out, load(out)

    def reconcile(self, catalog, *extra):
        out = os.path.join(self.root, 'catalog.json')
        result = run('reconcile_catalog.py', '--catalog', catalog, '--inventory', self.inventory, '--out', out, *extra)
        self.assertEqual(result.returncode, 0, result.stderr)
        return load(out), result.stdout

    def test_catalog_from_topology_covers_every_file_once(self):
        catalog = load(self.propose())
        ids = [item['id'] for item in catalog['items']]
        self.assertEqual(ids, ['billing/invoice', 'billing/nightly', 'billing/rates', 'billing/util', 'customers/custupd'])
        self.assertEqual([module['id'] for module in catalog['modules']], ['billing', 'customers'])
        self.assertEqual(catalog['source'], {'repo': 'legacy', 'commit': 'a' * 40})
        by_id = {item['id']: item for item in catalog['items']}
        # A directory leaf takes every inventory file under it; small leaves of one directory are grouped.
        self.assertEqual(by_id['customers/custupd']['files'], ['src/cust/upd/CUSTLIB.cbl', 'src/cust/upd/CUSTUPD.cbl', 'src/cust/upd/CUSTUPD2.cbl'])
        self.assertEqual(by_id['customers/custupd']['loc'], 3800)
        self.assertEqual(by_id['billing/util']['files'], ['src/billing/util/fmt1.cbl', 'src/billing/util/fmt2.cbl'])
        self.assertEqual(by_id['billing/nightly']['kind'], 'batch-job')
        self.assertEqual(by_id['billing/nightly']['entryPoints'], ['NIGHTLY'])
        self.assertEqual(by_id['billing/invoice']['complexity'], 'high')
        self.assertEqual(by_id['billing/rates']['complexity'], 'medium')
        self.assertTrue(by_id['billing/invoice']['digest'].startswith('sha256:'))
        self.assertEqual(by_id['billing/invoice']['status'], 'active')
        self.assertEqual(catalog['unassigned'], ['README.md'])
        self.assertTrue(any('GHOST' in line or 'ghost' in line for line in catalog['ambiguities']))
        # Deterministic.
        self.assertEqual(load(self.propose('again.json')), catalog)

    def test_digest_follows_file_content(self):
        before = {item['id']: item['digest'] for item in load(self.propose())['items']}
        changed = json.loads(json.dumps(INVENTORY))
        changed['files'][1]['sha256'] = hashlib.sha256(b'changed').hexdigest()
        write(self.inventory, changed)
        after = {item['id']: item['digest'] for item in load(self.propose())['items']}
        self.assertNotEqual(before['billing/rates'], after['billing/rates'])
        self.assertEqual(before['billing/invoice'], after['billing/invoice'])

    def test_missing_topology_fails(self):
        os.remove(os.path.join(self.assessment, 'topology.json'))
        result = run('catalog_from_topology.py', 'billing', '--topology', os.path.join(self.assessment, 'topology.json'), '--inventory', self.inventory, '--out', os.path.join(self.root, 'x.json'))
        self.assertEqual(result.returncode, 1)
        self.assertIn('topology.json is missing', result.stderr)

    def test_apply_edits_validates_each_edit(self):
        proposed = self.propose()
        _, curated = self.apply(proposed, {'edits': [
            {'op': 'rename', 'item': 'billing/invoice', 'name': 'Invoice entry\nscreen'},
            {'op': 'set-kind', 'item': 'billing/invoice', 'kind': 'screen'},
            {'op': 'set-kind', 'item': 'billing/rates', 'kind': 'spaceship'},
            {'op': 'describe', 'module': 'billing', 'summary': 'Bills customers.'},
            {'op': 'merge', 'items': ['billing/rates', 'billing/util'], 'name': 'Rates and formatting'},
            {'op': 'move-files', 'files': ['README.md'], 'to': 'billing/invoice'},
            {'op': 'move-files', 'files': ['src/billing/RATES.cbl', 'src/billing/util/fmt1.cbl', 'src/billing/util/fmt2.cbl'], 'to': 'billing/invoice'},
            {'op': 'split', 'item': 'customers/custupd', 'into': [{'name': 'Customer update', 'files': ['src/cust/upd/CUSTUPD.cbl', 'src/cust/upd/CUSTUPD2.cbl']}, {'name': 'Customer library', 'files': ['src/cust/upd/CUSTLIB.cbl']}]},
            {'op': 'split', 'item': 'billing/nightly', 'into': [{'name': 'a', 'files': ['jcl/NIGHTLY.jcl']}, {'name': 'b', 'files': ['jcl/NIGHTLY.jcl']}]},
            {'op': 'move-item', 'item': 'billing/nightly', 'module': 'batch', 'moduleName': 'Batch'},
            {'op': 'add-parts', 'item': 'billing/invoice', 'parts': [{'name': 'calcTax', 'kind': 'function', 'file': 'src/billing/INVOICE.cbl:210'}]},
            {'op': 'add-parts', 'item': 'billing/invoice', 'parts': [{'name': 'elsewhere', 'file': 'src/cust/upd/CUSTLIB.cbl'}]},
            {'op': 'delete-everything'},
            'not an edit',
        ]})
        by_id = {item['id']: item for item in curated['items']}
        self.assertEqual(by_id['billing/invoice']['name'], 'Invoice entry screen')
        self.assertEqual(by_id['billing/invoice']['kind'], 'screen')
        self.assertEqual(by_id['billing/rates']['name'], 'Rates and formatting')
        self.assertNotIn('billing/util', by_id)
        self.assertEqual(by_id['billing/invoice']['parts'], [{'name': 'calcTax', 'kind': 'function', 'file': 'src/billing/INVOICE.cbl:210'}])
        self.assertIn('README.md', by_id['billing/invoice']['files'])
        self.assertEqual(curated['unassigned'], [])
        self.assertEqual(by_id['customers/custupd']['files'], ['src/cust/upd/CUSTUPD.cbl', 'src/cust/upd/CUSTUPD2.cbl'])
        self.assertEqual(by_id['customers/customer-library']['files'], ['src/cust/upd/CUSTLIB.cbl'])
        self.assertIn('batch/nightly', by_id)
        self.assertEqual(next(module for module in curated['modules'] if module['id'] == 'billing')['summary'], 'Bills customers.')
        rejected = {entry['index']: entry['reason'] for entry in curated['curation']['rejected']}
        self.assertEqual(sorted(rejected), [2, 6, 8, 11, 12, 13])
        self.assertIn('not one of the unitKinds', rejected[2])
        self.assertIn('no files', rejected[6])
        self.assertIn('share files', rejected[8])
        self.assertIn('outside the item', rejected[11])
        self.assertEqual(curated['curation']['applied'], 8)

    def test_apply_without_edits_keeps_the_catalog(self):
        proposed = self.propose()
        out = os.path.join(self.root, 'curated.json')
        result = run('apply_catalog_edits.py', '--catalog', proposed, '--edits', os.path.join(self.root, 'missing.json'), '--inventory', self.inventory, '--out', out)
        self.assertEqual(result.returncode, 0, result.stderr)
        curated = load(out)
        self.assertEqual(curated['items'], load(proposed)['items'])
        self.assertEqual(curated['curation'], {'applied': 0, 'rejected': [], 'note': 'no curation edits'})

    def test_reconcile_first_catalog_and_idempotence(self):
        proposed = self.propose()
        catalog, stdout = self.reconcile(proposed)
        self.assertEqual(catalog['reconciled'], {'from': 'none', 'kept': 0, 'new': 5, 'retired': 0, 'renamed': 0})
        self.assertIn('first catalog', stdout)
        again, _ = self.reconcile(proposed, '--previous', self.commit(catalog))
        self.assertEqual([item['id'] for item in again['items']], [item['id'] for item in catalog['items']])
        self.assertEqual(again['reconciled'], {'from': 'catalog', 'kept': 5, 'new': 0, 'retired': 0, 'renamed': 0})

    def test_reconcile_keeps_ids_aliases_splits_and_retires(self):
        old = load(self.propose())
        for item in old['items']:
            if item['id'] == 'billing/invoice':
                item['id'], item['name'] = 'billing/invoice-entry', 'Invoice entry'
            if item['id'] == 'billing/util':
                item['id'] = 'billing/formatting'
        old['items'].append(cc.new_item('legacy/old-report', 'legacy', 'report', 'Old report', ['src/gone/REPORT.cbl']))
        old['modules'].append({'id': 'legacy', 'name': 'Legacy', 'summary': 'gone'})
        previous = self.commit(old)
        # This run: the customer item splits in two, util is unchanged, invoice is renamed.
        proposed = self.propose()
        _, curated = self.apply(proposed, {'edits': [
            {'op': 'split', 'item': 'customers/custupd', 'into': [{'name': 'Customer update', 'files': ['src/cust/upd/CUSTUPD.cbl', 'src/cust/upd/CUSTUPD2.cbl']}, {'name': 'Customer library', 'files': ['src/cust/upd/CUSTLIB.cbl']}]},
            {'op': 'rename', 'item': 'billing/invoice', 'name': 'Invoicing'},
        ]})
        catalog, _ = self.reconcile(os.path.join(self.root, 'curated.json'), '--previous', previous)
        by_id = {item['id']: item for item in catalog['items']}
        self.assertEqual(by_id['billing/invoice-entry']['name'], 'Invoicing')
        self.assertEqual(by_id['billing/invoice-entry']['aliases'], ['Invoice entry'])
        self.assertIn('billing/formatting', by_id)
        self.assertNotIn('billing/util', by_id)
        # One piece of the split keeps the id, the other gets its own.
        self.assertEqual(by_id['customers/custupd']['files'], ['src/cust/upd/CUSTUPD.cbl', 'src/cust/upd/CUSTUPD2.cbl'])
        self.assertEqual(by_id['customers/customer-library']['files'], ['src/cust/upd/CUSTLIB.cbl'])
        self.assertEqual(by_id['legacy/old-report']['status'], 'retired')
        self.assertIn('legacy', [module['id'] for module in catalog['modules']])
        self.assertEqual(catalog['reconciled']['retired'], 1)
        self.assertEqual(catalog['reconciled']['new'], 1)

    def test_reconcile_seeds_from_units(self):
        units_dir = os.path.join(self.root, 'units', 'billing')
        write(os.path.join(units_dir, 'customers', 'cust.md'),
              '---\nid: "billing/customers/cust"\nmodule: "customers"\nkind: "program"\ntitle: "Customers"\nsource:\n  - {repo: "legacy", paths: ["src/cust/upd/CUSTUPD.cbl", "src/cust/upd/CUSTLIB.cbl"]}\n---\nbody\n')
        write(os.path.join(units_dir, 'old', 'gone.md'), '---\nid: billing/old/gone\ntitle: Gone\nsource:\n  - repo: legacy\n    paths:\n      - src/gone/X.cbl\n---\n')
        catalog, stdout = self.reconcile(self.propose(), '--units-dir', units_dir)
        by_id = {item['id']: item for item in catalog['items']}
        self.assertIn('customers/cust', by_id)
        self.assertEqual(by_id['old/gone']['status'], 'retired')
        self.assertEqual(by_id['old/gone']['files'], ['src/gone/X.cbl'])
        self.assertEqual(catalog['reconciled']['from'], 'units')
        self.assertIn('existing units', stdout)

    def test_reconcile_expands_unit_directories_on_the_inventory(self):
        # A work item lists a directory leaf's directory, not its files.
        units_dir = os.path.join(self.root, 'units', 'billing')
        write(os.path.join(units_dir, 'customers', 'customer-update.md'),
              '---\nid: "billing/customers/customer-update"\nmodule: "customers"\nkind: "program"\ntitle: "Customer update"\nsource:\n  - {repo: "legacy", paths: ["src/cust/upd"]}\n---\n')
        catalog, _ = self.reconcile(self.propose(), '--units-dir', units_dir)
        by_id = {item['id']: item for item in catalog['items']}
        self.assertNotIn('customers/custupd', by_id)
        self.assertEqual(by_id['customers/customer-update']['files'], ['src/cust/upd/CUSTLIB.cbl', 'src/cust/upd/CUSTUPD.cbl', 'src/cust/upd/CUSTUPD2.cbl'])
        self.assertEqual(catalog['reconciled']['retired'], 0)

    def test_reconcile_keeps_module_ids(self):
        # The previous catalog called the billing module "invoicing"; this run's topology calls it "billing".
        old = load(self.propose())
        old['items'] = [item for item in old['items'] if item['module'] == 'billing' and item['id'] != 'billing/util']
        for item in old['items']:
            item['id'] = 'invoicing/' + item['id'].split('/', 1)[1]
            item['module'] = 'invoicing'
        old['modules'] = [{'id': 'invoicing', 'name': 'Invoicing', 'summary': 'Bills customers.'}]
        catalog, _ = self.reconcile(self.propose(), '--previous', self.commit(old))
        self.assertEqual([module['id'] for module in catalog['modules']], ['customers', 'invoicing'])
        self.assertEqual(next(module for module in catalog['modules'] if module['id'] == 'invoicing')['summary'], 'Bills customers.')
        by_id = {item['id']: item for item in catalog['items']}
        # Kept items keep their ids; the new item of the renamed module moves under the old module id.
        self.assertEqual(sorted(by_id), ['customers/custupd', 'invoicing/invoice', 'invoicing/nightly', 'invoicing/rates', 'invoicing/util'])
        self.assertTrue(all(item['module'] == item['id'].split('/')[0] for item in catalog['items']))
        self.assertEqual(catalog['reconciled'], {'from': 'catalog', 'kept': 3, 'new': 2, 'retired': 0, 'renamed': 0})

    def test_an_entry_point_module_takes_an_entry_kind(self):
        topology = json.loads(json.dumps(TOPOLOGY))
        topology['entryPoints'] = ['NIGHTLY', 'INVOICE']
        write(os.path.join(self.assessment, 'topology.json'), topology)
        write(os.path.join(self.root, 'kintsugi.yaml'), 'unitKinds:\n  - screen\n  - batch-job\n  - api\n  - program\n')
        by_id = {item['id']: item for item in load(self.propose())['items']}
        self.assertEqual(by_id['billing/invoice']['kind'], 'api')
        self.assertEqual(by_id['billing/invoice']['entryPoints'], ['INVOICE'])
        self.assertEqual(by_id['billing/rates']['kind'], 'program')
        self.assertEqual(by_id['billing/nightly']['kind'], 'batch-job')


class CatalogDocumentTests(unittest.TestCase):
    """The committed catalog: render_catalog.py writes it, load_catalog reads it back."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = self.temp.name
        write(os.path.join(self.root, 'topology.json'), TOPOLOGY)
        write(os.path.join(self.root, 'inventory.json'), INVENTORY)
        write(os.path.join(self.root, 'kintsugi.yaml'), 'unitKinds: [screen, batch-job, program]\n')

    def tearDown(self):
        self.temp.cleanup()

    def pipeline(self):
        proposed = os.path.join(self.root, 'proposed.json')
        topology, inventory = os.path.join(self.root, 'topology.json'), os.path.join(self.root, 'inventory.json')
        for args in (
            ('catalog_from_topology.py', 'billing', '--topology', topology, '--inventory', inventory, '--out', proposed, '--manifest', os.path.join(self.root, 'kintsugi.yaml')),
            ('reconcile_catalog.py', '--catalog', proposed, '--inventory', inventory, '--out', os.path.join(self.root, 'catalog.json')),
            ('render_catalog.py', 'billing', '--catalog', os.path.join(self.root, 'catalog.json'), '--topology', topology, '--out', os.path.join(self.root, 'docs')),
        ):
            result = run(*args)
            self.assertEqual(result.returncode, 0, result.stderr)
        return os.path.join(self.root, 'docs', *cc.paths.assessment_catalog_dir('billing').split('/'))

    def test_the_catalog_is_markdown_and_reads_back_as_it_was_written(self):
        directory = self.pipeline()
        self.assertEqual(sorted(os.listdir(directory)), ['billing.md', 'customers.md', 'index.md'])
        items, catalog = cc.load_catalog(directory)
        written = load(os.path.join(self.root, 'catalog.json'))
        for item in written['items']:
            read = items[item['id']]
            for key in ('module', 'kind', 'name', 'files', 'leaves', 'entryPoints', 'loc', 'complexity', 'digest', 'status'):
                self.assertEqual(read[key], item[key], (item['id'], key))
        self.assertEqual(catalog['source'], {'repo': 'legacy', 'commit': 'a' * 40})
        self.assertEqual([module['id'] for module in catalog['modules']], ['billing', 'customers'])
        self.assertEqual(catalog['unassigned'], ['README.md'])
        self.assertEqual(catalog['app'], 'billing')

    def test_a_card_carries_the_links_between_items(self):
        items, _ = cc.load_catalog(self.pipeline())
        # NIGHTLY (an item of its own) calls INVOICE; the data store is not an item.
        self.assertEqual(items['billing/nightly']['dependsOn'], [{'item': 'billing/invoice', 'kinds': ['call'], 'edges': 1}])
        self.assertEqual(items['billing/invoice']['usedBy'], ['billing/nightly'])
        leaf = items['billing/nightly']['leafNodes'][0]
        self.assertEqual((leaf['id'], leaf['kind'], leaf['file'], leaf['loc'], leaf['entry']), ('NIGHTLY', 'job', 'jcl/NIGHTLY.jcl', 30, True))

    def test_the_committed_files_hold_no_json(self):
        directory = self.pipeline()
        for name in os.listdir(directory):
            text = docmd.read_text(os.path.join(directory, name))
            self.assertTrue(text.startswith('---\n'), name)
            self.assertNotIn('"files":', text)


class InventoryHashTests(unittest.TestCase):
    def test_every_file_has_a_sha256(self):
        with tempfile.TemporaryDirectory() as root:
            source = os.path.join(root, 'src')
            write(os.path.join(source, 'a.py'), 'print(1)\n')
            write(os.path.join(source, 'job.jcl'), '//JOB\n')
            out = os.path.join(root, 'out')
            scratch = os.path.join(root, 'scratch')
            result = run('inventory.py', 'billing', '--source', source, '--out', out, '--scratch', scratch)
            self.assertEqual(result.returncode, 0, result.stderr)
            files = {entry['path']: entry for entry in load(os.path.join(scratch, 'inventory.json'))['files']}
            self.assertEqual(files['a.py']['sha256'], hashlib.sha256(b'print(1)\n').hexdigest())
            self.assertEqual(files['job.jcl']['sha256'], hashlib.sha256(b'//JOB\n').hexdigest())


if __name__ == '__main__':
    unittest.main()
