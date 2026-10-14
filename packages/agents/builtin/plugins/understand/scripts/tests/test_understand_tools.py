import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.dirname(HERE)


def run(script, *args):
    return subprocess.run([sys.executable, os.path.join(SCRIPTS, script), *args], capture_output=True, text=True)


def write(root, rel, text):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as handle:
        handle.write(text if isinstance(text, str) else json.dumps(text))


def read(path, mode='r'):
    with open(path, mode, **({} if 'b' in mode else {'encoding': 'utf-8'})) as handle:
        return handle.read()


def load(path):
    with open(path, encoding='utf-8') as handle:
        return json.load(handle)


def leaf(node_id, file, loc, kind='module', name=None):
    return {'id': node_id, 'name': name or node_id, 'kind': kind, 'file': file, 'loc': loc}


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
            leaf('CUSTUPD', 'src/cust/CUSTUPD.cbl', 7000),
            leaf('CUSTSCR', 'src/cust/CUSTSCR.bms', None, kind='screen'),
            leaf('ORPHAN', None, 300),
        ]},
        {'id': 'dom:data', 'name': 'Data stores', 'kind': 'domain', 'children': [
            {'id': 'ds:INVOICES', 'name': 'INVOICES', 'kind': 'datastore'},
            {'id': 'ds:CUSTOMERS', 'name': 'CUSTOMERS', 'kind': 'datastore'},
        ]},
    ]},
    'edges': [
        {'source': 'NIGHTLY', 'target': 'INVOICE', 'kind': 'call'},
        {'source': 'INVOICE', 'target': 'RATES', 'kind': 'call'},
        {'source': 'INVOICE', 'target': 'fmt1', 'kind': 'call'},
        {'source': 'INVOICE', 'target': 'ds:INVOICES', 'kind': 'write'},
        {'source': 'INVOICE', 'target': 'ds:CUSTOMERS', 'kind': 'read'},
        {'source': 'CUSTSCR', 'target': 'CUSTUPD', 'kind': 'call'},
        {'source': 'CUSTUPD', 'target': 'ds:CUSTOMERS', 'kind': 'write'},
        {'source': 'RATES', 'target': 'INVOICE', 'kind': 'call'},
    ],
    'entryPoints': ['NIGHTLY', 'CUSTSCR'], 'deadEnds': [], 'observations': [], 'flows': [],
}

RULES = """# Business rules

### RULE-001: Late fee
**Category:** Calculation
**Source:** `src/billing/RATES.cbl:120-140`

### RULE-002: Customer must be active
**Source:** `src/cust/CUSTUPD.cbl:40`

### RULE-003: Orphan rule
**Source:** `src/elsewhere/X.cbl:1`
"""

FINDINGS = """# Security findings

| ID | CWE | Severity | Location | Title |
|---|---|---|---|---|
| SEC-001 | CWE-89 | High | `src/cust/CUSTUPD.cbl:88` | SQL built from input |
| SEC-002 | CWE-798 | Critical | config/db.properties:3 | Hardcoded credential |
"""


def assessment(ws, rules=True, findings=True, inventory=True):
    write(ws, 'assessment/topology.json', TOPOLOGY)
    if rules:
        write(ws, 'assessment/BUSINESS_RULES.md', RULES)
    if findings:
        write(ws, 'assessment/SECURITY_FINDINGS.md', FINDINGS)
    if inventory:
        write(ws, 'assessment/inventory.json', {'files': [{'path': 'src/cust/CUSTSCR.bms', 'language': 'Other', 'lines': 90, 'codeLines': 80}]})
    write(ws, 'kintsugi.yaml', 'schemaVersion: 1\nunitKinds: [module, batch-job, screen]  # kinds\n')


def units(ws, *extra):
    return run('units_from_topology.py', 'billing', '--assessment', os.path.join(ws, 'assessment'), '--out', os.path.join(ws, 'work'),
               '--manifest', os.path.join(ws, 'kintsugi.yaml'), *extra)


class UnitsFromTopologyTests(unittest.TestCase):
    def test_proposes_units_by_domain_with_dependencies_rules_and_findings(self):
        with tempfile.TemporaryDirectory() as ws:
            assessment(ws)
            done = units(ws)
            self.assertEqual(done.returncode, 0, done.stderr)
            result = load(os.path.join(ws, 'work/units.json'))
            by_key = {unit['key']: unit for unit in result['units']}
            # Small leaves of one directory are grouped; data stores are never units.
            self.assertEqual(sorted(by_key), ['billing/invoice', 'billing/nightly', 'billing/rates', 'billing/util',
                                              'customers/custscr', 'customers/custupd', 'customers/orphan'])
            self.assertEqual(by_key['billing/util']['leaves'], ['fmt1', 'fmt2'])
            self.assertEqual(by_key['billing/util']['loc'], 100)
            invoice = by_key['billing/invoice']
            self.assertEqual(invoice['id'], 'billing/billing/invoice')
            self.assertEqual(invoice['dependsOn'], ['billing/billing/rates', 'billing/billing/util'])
            self.assertEqual(invoice['usedBy'], ['billing/billing/nightly', 'billing/billing/rates'])
            self.assertEqual(invoice['dataStores'], [{'id': 'ds:CUSTOMERS', 'name': 'CUSTOMERS', 'access': ['read']},
                                                     {'id': 'ds:INVOICES', 'name': 'INVOICES', 'access': ['write']}])
            # Kinds follow kintsugi.yaml's unitKinds; entry points are marked.
            self.assertEqual(by_key['billing/nightly']['kind'], 'batch-job')
            self.assertTrue(by_key['billing/nightly']['entryPoint'])
            self.assertEqual(by_key['customers/custscr']['kind'], 'screen')
            # Size from inventory.json when the map has none.
            self.assertEqual(by_key['customers/custscr']['loc'], 80)
            # Rules and findings land on the unit owning the cited file.
            self.assertEqual(by_key['billing/rates']['rules'], ['RULE-001'])
            self.assertEqual(by_key['customers/custupd']['rules'], ['RULE-002'])
            self.assertEqual(by_key['customers/custupd']['findings'], ['SEC-001'])
            self.assertEqual(result['inputs'], {'topology': True, 'inventory': True, 'businessRules': True, 'securityFindings': True,
                                                'unitKinds': ['module', 'batch-job', 'screen']})
            ambiguities = '\n'.join(result['ambiguities'])
            self.assertIn('leaf ORPHAN names no source file', ambiguities)
            self.assertIn('customers/custupd has 7000 lines', ambiguities)
            brief = load(os.path.join(ws, 'work/briefs/billing/invoice.json'))
            self.assertEqual(brief['key'], 'billing/invoice')
            self.assertIn('ambiguities: 2', done.stdout)

    def test_records_missing_optional_inputs(self):
        with tempfile.TemporaryDirectory() as ws:
            assessment(ws, rules=False, findings=False, inventory=False)
            done = units(ws)
            self.assertEqual(done.returncode, 0, done.stderr)
            result = load(os.path.join(ws, 'work/units.json'))
            self.assertFalse(result['inputs']['businessRules'])
            self.assertFalse(result['inputs']['securityFindings'])
            self.assertTrue(all(unit['rules'] == [] and unit['findings'] == [] for unit in result['units']))
            self.assertIn('not present: inventory.json, BUSINESS_RULES.md, SECURITY_FINDINGS.md', done.stdout)

    def test_groups_by_directory_then_caps_above_the_limit(self):
        with tempfile.TemporaryDirectory() as ws:
            assessment(ws)
            done = units(ws, '--max-units', '4')
            self.assertEqual(done.returncode, 0, done.stderr)
            result = load(os.path.join(ws, 'work/units.json'))
            self.assertEqual(len(result['units']), 4)
            self.assertTrue(any('every leaf of a domain directory was grouped' in line for line in result['ambiguities']))
            self.assertTrue(any('left out above the limit of 4' in line for line in result['ambiguities']))

    def test_fails_without_topology_or_on_duplicate_ids(self):
        with tempfile.TemporaryDirectory() as ws:
            os.makedirs(os.path.join(ws, 'assessment'))
            done = units(ws)
            self.assertEqual(done.returncode, 1)
            self.assertIn('run the assess stage first', done.stderr)
            broken = json.loads(json.dumps(TOPOLOGY))
            broken['root']['children'][0]['children'].append(leaf('INVOICE', 'x.cbl', 1))
            write(ws, 'assessment/topology.json', broken)
            done = units(ws)
            self.assertEqual(done.returncode, 1)
            self.assertIn('duplicate node id', done.stderr)

    def test_unit_names_are_safe_path_segments(self):
        with tempfile.TemporaryDirectory() as ws:
            hostile = json.loads(json.dumps(TOPOLOGY))
            hostile['root']['children'][0]['name'] = '../../etc'
            hostile['root']['children'][0]['children'][0]['name'] = '../../../passwd'
            write(ws, 'assessment/topology.json', hostile)
            done = run('units_from_topology.py', 'billing', '--assessment', os.path.join(ws, 'assessment'), '--out', os.path.join(ws, 'work'))
            self.assertEqual(done.returncode, 0, done.stderr)
            keys = [unit['key'] for unit in load(os.path.join(ws, 'work/units.json'))['units']]
            self.assertIn('etc/passwd', keys)
            self.assertTrue(all('..' not in key for key in keys))


class MergeAndWorkItemTests(unittest.TestCase):
    def prepare(self, ws):
        assessment(ws)
        self.assertEqual(units(ws).returncode, 0)
        # Two specifications were written; one job failed (no spec, no fragment).
        write(ws, 'specs/billing/invoice.md', '# Invoice\n')
        write(ws, 'specs/customers/custupd.md', '# Customer update\n')
        write(ws, 'trace/billing/invoice.json', {
            'entryPoints': ['src/billing/INVOICE.cbl:10'],
            'rulesApplied': ['RULE-001', 'RULE-999', 'mock rulesApplied'],
            'findings': ['SEC-002'],
            'dependencies': [
                {'target': 'customers/custupd', 'kind': 'call', 'direction': 'outbound'},
                {'target': 'PAYMENT-GATEWAY', 'kind': 'integration', 'direction': 'outbound'},
                {'target': 'INVOICES', 'kind': 'read', 'direction': 'outbound'},
                {'target': 'nowhere', 'kind': 'call', 'direction': 'outbound'},
            ],
            'dataObjects': ['Invoice record'],
            'externalSystems': ['Printing service'],
            'files': ['src/billing/INVOICE.cpy', '/etc/passwd'],
            'openQuestions': 2,
        })
        write(ws, 'trace/customers/custupd.json', {'rulesApplied': [], 'findings': [], 'dependencies': [
            {'target': 'billing/billing/rates', 'kind': 'call', 'direction': 'inbound'}]})

    def merge(self, ws):
        return run('merge_traceability.py', 'billing', '--units', os.path.join(ws, 'work/units.json'), '--trace', os.path.join(ws, 'trace'),
                   '--specs', os.path.join(ws, 'specs'), '--assessment', os.path.join(ws, 'assessment'), '--out', os.path.join(ws, 'out'),
                   '--source-repo', 'billing-legacy', '--source-commit', 'abc123')

    def test_merges_fragments_into_a_deterministic_matrix(self):
        with tempfile.TemporaryDirectory() as ws:
            self.prepare(ws)
            done = self.merge(ws)
            self.assertEqual(done.returncode, 0, done.stderr)
            matrix = load(os.path.join(ws, 'out/traceability.json'))
            by_id = {unit['id']: unit for unit in matrix['units']}
            invoice = by_id['billing/billing/invoice']
            self.assertEqual(invoice['spec'], 'knowledge/as-is/billing/billing/invoice.md')
            self.assertEqual(invoice['rules'], ['RULE-001'])
            self.assertEqual(invoice['findings'], ['SEC-002'])
            self.assertEqual(invoice['dependsOn'], ['billing/billing/rates', 'billing/billing/util', 'billing/customers/custupd'])
            self.assertEqual(invoice['externalSystems'], ['PAYMENT-GATEWAY', 'Printing service'])
            self.assertEqual(invoice['dataStores'], [{'id': 'ds:CUSTOMERS', 'access': ['read']}, {'id': 'ds:INVOICES', 'access': ['read', 'write']}])
            self.assertEqual(invoice['files'], ['src/billing/INVOICE.cbl', 'src/billing/INVOICE.cpy'])
            self.assertEqual(invoice['openQuestions'], 2)
            # An inbound dependency adds the edge to the other unit.
            self.assertIn('billing/customers/custupd', by_id['billing/billing/rates']['dependsOn'])
            self.assertIsNone(by_id['billing/billing/util']['spec'])
            self.assertEqual(matrix['rules']['RULE-001'], ['billing/billing/invoice', 'billing/billing/rates'])
            self.assertEqual(matrix['unmappedRules'], ['RULE-003'])
            self.assertEqual(matrix['cycles'], [['billing/billing/invoice', 'billing/billing/rates']])
            self.assertEqual(matrix['notes'], {'invalid rule ids': 1, 'unknown rule ids': 1, 'unresolved dependencies': 1, 'invalid paths': 1})
            text = read(os.path.join(ws, 'out/traceability.md'))
            self.assertTrue(text.startswith('Legacy repository billing-legacy at abc123\n'))
            self.assertIn('| billing/invoice | module | [billing/invoice](billing/invoice.md) |', text)
            self.assertIn('## Dependency cycles', text)
            # Deterministic: the same inputs give the same bytes.
            first = read(os.path.join(ws, 'out/traceability.json'), 'rb')
            self.assertEqual(self.merge(ws).returncode, 0)
            self.assertEqual(read(os.path.join(ws, 'out/traceability.json'), 'rb'), first)

    def test_leaves_out_cited_files_missing_from_the_source(self):
        with tempfile.TemporaryDirectory() as ws:
            self.prepare(ws)
            write(ws, 'source/src/billing/INVOICE.cbl', 'x\n')
            done = run('merge_traceability.py', 'billing', '--units', os.path.join(ws, 'work/units.json'), '--trace', os.path.join(ws, 'trace'),
                       '--specs', os.path.join(ws, 'specs'), '--source', os.path.join(ws, 'source'), '--out', os.path.join(ws, 'out'))
            self.assertEqual(done.returncode, 0, done.stderr)
            matrix = load(os.path.join(ws, 'out/traceability.json'))
            invoice = next(unit for unit in matrix['units'] if unit['id'] == 'billing/billing/invoice')
            # The map's own files stay; a fragment's file that does not exist is left out and counted.
            self.assertEqual(invoice['files'], ['src/billing/INVOICE.cbl'])
            self.assertEqual(matrix['notes']['files not in the source'], 1)

    def test_writes_work_items_and_keeps_existing_ones(self):
        with tempfile.TemporaryDirectory() as ws:
            self.prepare(ws)
            self.assertEqual(self.merge(ws).returncode, 0)
            write(ws, 'existing/billing/rates.md', '---\nstatus: in-progress\n---\n')
            done = run('write_work_items.py', 'billing', '--traceability', os.path.join(ws, 'out/traceability.json'), '--out', os.path.join(ws, 'docs'),
                       '--existing', os.path.join(ws, 'existing'), '--repo', 'billing-legacy')
            self.assertEqual(done.returncode, 0, done.stderr)
            self.assertIn('6 work item(s) written', done.stdout)
            self.assertIn('kept: billing/billing/rates', done.stdout)
            self.assertFalse(os.path.exists(os.path.join(ws, 'docs/units/billing/billing/rates.md')))
            text = read(os.path.join(ws, 'docs/units/billing/billing/invoice.md'))
            self.assertTrue(text.startswith('---\nid: "billing/billing/invoice"\napplication: "billing"\nmodule: "billing"\nkind: "module"\n'))
            self.assertIn('phase: discover-assess\nstage: understand\nstatus: pending\ncomplexity: medium\n', text)
            self.assertIn('dependsOn: ["billing/billing/rates", "billing/billing/util", "billing/customers/custupd"]', text)
            self.assertIn('  - {repo: "billing-legacy", paths: ["src/billing/INVOICE.cbl", "src/billing/INVOICE.cpy"]}', text)
            self.assertIn('  asIs: "knowledge/as-is/billing/billing/invoice.md"\n  businessRules: ["RULE-001"]\n---\n', text)
            self.assertIn('Security findings: SEC-002', text)
            util = read(os.path.join(ws, 'docs/units/billing/billing/util.md'))
            self.assertNotIn('asIs:', util)
            self.assertIn('No AS-IS specification was written', util)

    def test_work_items_refuse_unsafe_names(self):
        with tempfile.TemporaryDirectory() as ws:
            write(ws, 'trace.json', {'units': [{'id': 'billing/../x', 'module': '..', 'unit': 'x', 'title': 't', 'kind': 'module',
                                                'dependsOn': [], 'files': [], 'rules': [], 'findings': [], 'entryPoint': False}]})
            done = run('write_work_items.py', 'billing', '--traceability', os.path.join(ws, 'trace.json'), '--out', os.path.join(ws, 'docs'))
            self.assertEqual(done.returncode, 1)
            self.assertIn('unsafe module or unit name', done.stderr)


if __name__ == '__main__':
    unittest.main()
