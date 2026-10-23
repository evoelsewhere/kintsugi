import json
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))))
SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPTS)
import docmd  # noqa: E402

PYTHON = sys.executable


def run(script, *args):
    return subprocess.run(
        [PYTHON, os.path.join(SCRIPTS, script), *map(str, args)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=30,
    )


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as handle:
        json.dump(data, handle, indent=2)
        handle.write('\n')


def make_topology():
    return {
        'system': 'Billing',
        'root': {
            'id': 'sys', 'name': 'billing', 'kind': 'system',
            'children': [
                {
                    'id': 'dom:accounts', 'name': 'Accounts', 'kind': 'domain',
                    'children': [
                        {'id': 'module:AccountService', 'name': 'AccountService', 'kind': 'module', 'file': 'src/AccountService.py', 'loc': 12},
                        {'id': 'ds:accounts', 'name': 'Accounts', 'kind': 'datastore', 'loc': 1},
                    ],
                },
                {
                    'id': 'dom:invoicing', 'name': 'Invoicing', 'kind': 'domain',
                    'children': [{'id': 'module:InvoiceEntry', 'name': 'InvoiceEntry', 'kind': 'module', 'file': 'src/InvoiceEntry.py', 'loc': 40}],
                },
            ],
        },
        'edges': [
            {'source': 'module:AccountService', 'target': 'ds:accounts', 'kind': 'write'},
            {'source': 'module:InvoiceEntry', 'target': 'module:AccountService', 'kind': 'call'},
        ],
        'entryPoints': ['module:InvoiceEntry'],
        'deadEnds': [],
        'observations': ['Invoices are posted through the account service.'],
        'flows': [{'name': 'Post invoice', 'persona': 'clerk', 'steps': [{'label': 'Enter the invoice', 'nodes': ['module:InvoiceEntry', 'module:AccountService']}]}],
    }


def symlink_or_skip(test, target, link):
    try:
        os.symlink(target, link)
    except OSError as error:
        if getattr(error, 'winerror', None) == 1314:
            test.skipTest('Windows symlink creation requires unavailable developer privilege (WinError 1314)')
        raise


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = self.temp.name
        self.source = os.path.join(self.root, 'source')
        self.out = os.path.join(self.root, 'out')
        self.scratch = os.path.join(self.root, 'scratch')
        os.makedirs(self.source)

    def tearDown(self):
        self.temp.cleanup()

    def inventory(self, *extra):
        return run('inventory.py', 'billing', '--source', self.source, '--out', self.out, '--scratch', self.scratch, *extra)

    def test_happy_path_writes_a_deterministic_summary_and_the_raw_inventory(self):
        os.makedirs(os.path.join(self.source, 'src'))
        with open(os.path.join(self.source, 'src', 'branch.py'), 'w', encoding='utf-8') as handle:
            handle.write('def work(value):\n    if value and value > 2:\n        return value\n    return 0\n')
        with open(os.path.join(self.source, 'README.md'), 'w', encoding='utf-8') as handle:
            handle.write('# Billing\n')
        result = self.inventory()
        self.assertEqual(result.returncode, 0, result.stderr)
        path = os.path.join(self.out, 'inventory.md')
        first = docmd.read_text(path)
        front, body = docmd.split_front_matter(first)
        self.assertEqual(front['app'], 'billing')
        self.assertEqual(front['sourceFileCount'], 2)
        self.assertEqual(front['complexityIndexFormula'], '2.94 × KSLOC^1.10')
        self.assertGreater(front['complexityPerKsloc'] or 0, 0)
        sections = dict(docmd.sections(body, 2))
        self.assertEqual({row['language'] for row in docmd.records_in(sections['Languages'])}, {'Markdown', 'Python'})
        self.assertEqual(docmd.records_in(sections['Most complex files'])[0]['path'], 'src/branch.py')
        self.assertNotIn('.json', first)
        raw = docmd.read_json(os.path.join(self.scratch, 'inventory.json'))
        self.assertEqual(raw['languages'], {'Markdown': 1, 'Python': 1})
        self.assertEqual(raw['sloc'], raw['codeLines'])
        result = self.inventory()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(docmd.read_text(path), first)

    def test_a_vue_and_a_java_repository_are_both_counted_with_their_templates_branches(self):
        files = {
            'web/src/App.vue': '<template>\n  <li v-for="item in items" v-if="item.ok">{{ item }}</li>\n</template>\n<script>\nexport default { methods: { go(a) { if (a) { return 1 } return 0 } } }\n</script>\n<style lang="scss">\n.a { color: red }\n</style>\n',
            'web/src/main.mts': 'export const x = 1\n',
            'web/.nuxt/dist/skipped.vue': '<template><p/></template>\n',
            'api/src/Main.java': 'class Main {\n  void run(int a) {\n    if (a > 0) { return; }\n  }\n}\n',
            'api/src/page.jsp': '<c:if test="${ok}">yes</c:if>\n',
        }
        for relative, text in files.items():
            os.makedirs(os.path.dirname(os.path.join(self.source, *relative.split('/'))), exist_ok=True)
            with open(os.path.join(self.source, *relative.split('/')), 'w', encoding='utf-8') as handle:
                handle.write(text)
        result = self.inventory()
        self.assertEqual(result.returncode, 0, result.stderr)
        raw = json.loads(docmd.read_text(os.path.join(self.scratch, 'inventory.json')))
        self.assertEqual(raw['languages'], {'JSP': 1, 'Java': 1, 'TypeScript': 1, 'Vue': 1})
        by_path = {entry['path']: entry for entry in raw['files']}
        self.assertNotIn('web/.nuxt/dist/skipped.vue', by_path)
        # The decisions of the template (v-for, v-if) and of the script (if) all count.
        self.assertEqual(by_path['web/src/App.vue']['cyclomaticComplexity'], 4)
        self.assertGreater(by_path['api/src/page.jsp']['cyclomaticComplexity'], 1)

    def test_the_language_of_a_file_comes_from_its_extension_or_its_name_and_unknown_ones_are_other(self):
        from inventory import language_for
        expected = {
            'src/Main.java': 'Java', 'ui/App.VUE': 'Vue', 'batch/PAYROLL.CBL': 'COBOL', 'lib/util.h': 'C/C++', 'a/b.erl': 'Erlang',
            'forms/Main.dfm': 'Delphi', 'rpg/ORD001.rpgle': 'RPG', 'x/mod.zig': 'Zig', 'a/Makefile': 'Makefile', 'docker/Dockerfile': 'Dockerfile',
            'db/pkg.pkb': 'PL/SQL', 'ops/run.ps1': 'PowerShell', 'old/Calc.cls': 'Visual Basic', 'a/b.hs': 'Haskell', 'a/b.lua': 'Lua',
            'a/data.json': 'Other', 'a/archive.zip': 'Other', 'a/noextension': 'Other', 'a/b.unknownext': 'Other',
        }
        self.assertEqual({path: language_for(path) for path in expected}, expected)

    def test_the_generated_table_is_well_formed_and_keeps_the_names_the_inventory_always_used(self):
        import languages
        for extension, name in languages.EXTENSIONS.items():
            self.assertRegex(extension, r'^\.[^\s./]+$')
            self.assertEqual(extension, extension.lower())
            self.assertTrue(name.strip(), extension)
        for filename, name in languages.FILENAMES.items():
            self.assertEqual(filename, filename.lower())
            self.assertTrue(name.strip(), filename)
        self.assertGreater(len(set(languages.EXTENSIONS.values())), 300)
        for extension, name in {'.c': 'C', '.h': 'C/C++', '.md': 'Markdown', '.sh': 'Shell', '.vb': 'Visual Basic', '.cbl': 'COBOL', '.yaml': 'YAML'}.items():
            self.assertEqual(languages.EXTENSIONS[extension], name)

    def test_comments_and_decisions_follow_the_language(self):
        from inventory import analyze
        pascal = analyze('a.pas', '{ a comment }\n(* another *)\nbegin\n  if x then y := 1;\nend.\n', 'Pascal')
        self.assertEqual((pascal['commentLines'], pascal['codeLines'], pascal['cyclomaticComplexity']), (2, 3, 2))
        lisp = analyze('a.lisp', '; a comment\n(defun f (x) (if x 1 (when y 2)))\n', 'Common Lisp')
        self.assertEqual((lisp['commentLines'], lisp['codeLines'], lisp['cyclomaticComplexity']), (1, 1, 3))
        fortran = analyze('a.f90', '! a comment\nif (x > 0) then\n  y = 1\nend if\n', 'Fortran')
        self.assertEqual((fortran['commentLines'], fortran['codeLines']), (1, 3))
        batch = analyze('a.bat', 'REM a comment\n:: another\nif exist x echo ok\n', 'Batch')
        self.assertEqual((batch['commentLines'], batch['codeLines']), (2, 1))

    def test_sources_are_recorded_in_order_and_validated(self):
        first, second = 'a' * 40, 'b' * 40
        for repo in ('billing-service', 'billing-db'):
            os.makedirs(os.path.join(self.source, repo))
        result = self.inventory('--sources', f'billing-service@{first},billing-db@{second}')
        self.assertEqual(result.returncode, 0, result.stderr)
        front, body = docmd.split_front_matter(docmd.read_text(os.path.join(self.out, 'inventory.md')))
        self.assertEqual(front['sources'], [f'billing-service@{first}', f'billing-db@{second}'])
        self.assertNotIn('sourceCommit', front)
        self.assertIn(f'`billing-service@{first}`, `billing-db@{second}`', body)
        for bad in ('bad', f'x@{first}@y', f'x@{first},x@{second}', 'x@' + 'z' * 40, f'../x@{first}'):
            self.assertEqual(run('inventory.py', 'billing', '--sources', bad).returncode, 2, bad)
        # A source that is not a folder of the measured tree is refused, not recorded.
        result = self.inventory('--sources', f'billing-service@{first},missing@{second}')
        self.assertEqual(result.returncode, 1)
        self.assertIn('missing', result.stderr)

    def test_a_source_folder_with_one_folder_per_repository_is_inventoried_as_one_tree(self):
        for repo, name in (('billing-service', 'main.py'), ('billing-db', 'schema.py')):
            os.makedirs(os.path.join(self.source, repo, 'src'))
            with open(os.path.join(self.source, repo, 'src', name), 'w', encoding='utf-8') as handle:
                handle.write('def work(value):\n    return value\n')
        result = self.inventory('--sources', f'billing-service@{"a" * 40},billing-db@{"b" * 40}')
        self.assertEqual(result.returncode, 0, result.stderr)
        raw = json.loads(docmd.read_text(os.path.join(self.scratch, 'inventory.json')))
        self.assertEqual(sorted(entry['path'] for entry in raw['files']), ['billing-db/src/schema.py', 'billing-service/src/main.py'])

    def test_missing_required_parameter_exits_two_with_usage_and_no_output(self):
        result = run('inventory.py', 'billing', '--source', self.source)
        self.assertEqual(result.returncode, 2)
        self.assertIn('usage:', result.stderr.lower())
        self.assertFalse(os.path.exists(self.out))

    def test_symlink_to_outside_source_is_rejected(self):
        external = os.path.join(self.root, 'outside.py')
        with open(external, 'w', encoding='utf-8') as handle:
            handle.write('safe = True\n')
        symlink_or_skip(self, external, os.path.join(self.source, 'escape.py'))
        result = self.inventory()
        self.assertEqual(result.returncode, 1)
        self.assertIn('escapes --source', result.stderr)
        self.assertFalse(os.path.exists(self.out))

    def test_output_inside_source_checkout_is_refused(self):
        out = os.path.join(self.source, 'generated')
        result = run('inventory.py', 'billing', '--source', self.source, '--out', out, '--scratch', self.scratch)
        self.assertEqual(result.returncode, 1)
        self.assertIn('outside the read-only --source', result.stderr)
        self.assertFalse(os.path.exists(out))

    def test_oversized_source_file_is_rejected(self):
        from inventory import MAX_FILE_BYTES
        path = os.path.join(self.source, 'too_large.py')
        with open(path, 'wb') as handle:
            handle.write(b'x' * (MAX_FILE_BYTES + 1))
        result = self.inventory()
        self.assertEqual(result.returncode, 1)
        self.assertIn('exceeds the', result.stderr)
        self.assertFalse(os.path.exists(self.out))


class RenderTopologyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = self.temp.name
        self.topology = os.path.join(self.root, 'scratch', 'topology.json')
        self.out = os.path.join(self.root, 'assessment')

    def tearDown(self):
        self.temp.cleanup()

    def render(self):
        return run('render_topology.py', 'billing', '--topology', self.topology, '--out', self.out)

    def test_renders_the_domains_the_edges_between_them_and_the_flows(self):
        write_json(self.topology, make_topology())
        result = self.render()
        self.assertEqual(result.returncode, 0, result.stderr)
        front, body = docmd.split_front_matter(docmd.read_text(os.path.join(self.out, 'topology.md')))
        self.assertEqual((front['system'], front['domains'], front['leaves'], front['dataStores'], front['edges'], front['entryPoints']), ('Billing', 2, 2, 1, 2, 1))
        sections = dict(docmd.sections(body, 2))
        self.assertEqual({row['domain'] for row in docmd.records_in(sections['Domains'])}, {'Accounts', 'Invoicing'})
        self.assertEqual(docmd.records_in(sections['Edges between domains']), [{'from': 'Invoicing', 'to': 'Accounts', 'kinds': 'call', 'edges': '1'}])
        leaves = {row['leaf']: row for row in docmd.records_in(sections['Leaves'])}
        self.assertEqual(leaves['module:InvoiceEntry']['entry point'], 'yes')
        self.assertEqual(leaves['ds:accounts']['kind'], 'datastore')
        self.assertIn('Post invoice', sections['Flows'])
        self.assertIn('```mermaid', sections['Diagram'])

    def test_an_invalid_topology_fails_with_what_is_wrong(self):
        broken = make_topology()
        del broken['flows']
        write_json(self.topology, broken)
        result = self.render()
        self.assertEqual(result.returncode, 1)
        self.assertIn('flows', result.stderr)
        self.assertFalse(os.path.exists(self.out))

    def test_a_duplicate_node_id_fails(self):
        broken = make_topology()
        broken['root']['children'][1]['children'][0]['id'] = 'module:AccountService'
        write_json(self.topology, broken)
        result = self.render()
        self.assertEqual(result.returncode, 1)
        self.assertIn('duplicate', result.stderr)


if __name__ == '__main__':
    unittest.main()
