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


def write(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='') as handle:
        handle.write(value if isinstance(value, str) else json.dumps(value))


def load(path):
    with open(path, encoding='utf-8') as handle:
        return json.load(handle)


def item(item_id, files, leaves, **extra):
    return {'id': item_id, 'module': item_id.split('/')[0], 'kind': 'program', 'name': item_id.split('/')[1].title(), 'summary': '', 'files': files,
            'leaves': leaves, 'entryPoints': [], 'loc': 100, 'complexity': 'low', 'digest': f'sha256:{item_id}', 'status': 'active', 'aliases': [], 'parts': [], **extra}


CATALOG = {
    'schemaVersion': 1, 'app': 'billing',
    'modules': [{'id': 'invoicing', 'name': 'Invoicing', 'summary': ''}, {'id': 'tax', 'name': 'Tax', 'summary': ''}],
    'items': [
        item('invoicing/entry', ['src/INV01.cbl'], ['INV01']),
        item('tax/calc', ['src/TAX.cbl', 'src/TAXLIB.cbl'], ['TAX']),
        item('tax/old', ['src/OLD.cbl'], ['OLD'], status='retired'),
    ],
    'unassigned': [], 'ambiguities': [],
}

TOPOLOGY = {
    'system': 'billing',
    'root': {'id': 'sys', 'name': 'billing', 'kind': 'system', 'children': [
        {'id': 'dom:inv', 'name': 'Invoicing', 'kind': 'domain', 'children': [{'id': 'INV01', 'name': 'INV01', 'kind': 'screen', 'file': 'src/INV01.cbl'}]},
        {'id': 'dom:tax', 'name': 'Tax', 'kind': 'domain', 'children': [{'id': 'TAX', 'name': 'TAX', 'kind': 'module', 'file': 'src/TAX.cbl'}]},
        {'id': 'dom:data', 'name': 'Data', 'kind': 'domain', 'children': [{'id': 'ds:INVOICES', 'name': 'INVOICES', 'kind': 'datastore'}]},
    ]},
    'edges': [
        {'source': 'INV01', 'target': 'TAX', 'kind': 'call'},
        {'source': 'INV01', 'target': 'ds:INVOICES', 'kind': 'write'},
    ],
    'entryPoints': ['INV01'], 'deadEnds': [], 'observations': [], 'flows': [],
}


class UnderstandToolsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = self.temp.name
        self.catalog = os.path.join(self.root, 'catalog.json')
        self.topology = os.path.join(self.root, 'topology.json')
        self.out = os.path.join(self.root, 'out')
        write(self.catalog, CATALOG)
        write(self.topology, TOPOLOGY)

    def tearDown(self):
        self.temp.cleanup()

    def test_scope_items_writes_fragments_briefs_and_shards(self):
        result = run('scope_items.py', 'billing', '--catalog', self.catalog, '--topology', self.topology, '--items', 'tax/calc,invoicing/entry', '--out', self.out)
        self.assertEqual(result.returncode, 0, result.stderr)
        fragment = load(os.path.join(self.out, 'applications', 'billing', 'units', 'invoicing', 'entry', 'topology.json'))
        self.assertEqual(fragment['item'], 'invoicing/entry')
        self.assertEqual([edge.get('targetItem') for edge in fragment['edges']], ['tax/calc', None])
        self.assertEqual(fragment['entryPoints'], ['INV01'])
        brief = load(os.path.join(self.out, 'applications', 'billing', 'assessment', 'understand', 'briefs', 'invoicing', 'entry.json'))
        self.assertEqual(brief['dependsOn'], ['tax/calc'])
        self.assertEqual(brief['dataStores'], [{'id': 'ds:INVOICES', 'access': ['write']}])
        tax = load(os.path.join(self.out, 'applications', 'billing', 'assessment', 'understand', 'briefs', 'tax', 'calc.json'))
        self.assertEqual(tax['usedBy'], ['invoicing/entry'])
        shards = load(os.path.join(self.out, 'applications', 'billing', 'assessment', 'understand', 'shards.json'))
        self.assertEqual([shard['name'] for shard in shards], ['invoicing.entry', 'tax.calc'])
        scope = load(os.path.join(self.out, 'applications', 'billing', 'assessment', 'understand', 'scope.json'))
        self.assertEqual(scope['files'], ['src/INV01.cbl', 'src/TAX.cbl', 'src/TAXLIB.cbl'])

    def test_scope_items_refuses_unknown_and_retired_items(self):
        for items in ('tax/old', 'nope/x', ''):
            result = run('scope_items.py', 'billing', '--catalog', self.catalog, '--items', items, '--out', self.out)
            self.assertEqual(result.returncode, 1, items)

    def test_split_rules_and_findings_namespace_ids_per_item(self):
        rules = os.path.join(self.root, 'rules_result.json')
        write(rules, {'confirmedRules': [
            {'name': 'Tax rounding', 'category': 'Calculation', 'priority': 'P0', 'source': 'src/TAXLIB.cbl:12'},
            {'name': 'Amount positive', 'category': 'Validation', 'priority': 'P1', 'source': 'src/TAX.cbl:3'},
            {'name': 'Entry date', 'category': 'Validation', 'priority': 'P1', 'source': 'src/INV01.cbl:40'},
            {'name': 'Elsewhere', 'category': 'Policy', 'priority': 'P2', 'source': 'src/OTHER.cbl:1'},
        ], 'dataObjects': [{'name': 'INVOICE-REC', 'source': 'src/INV01.cbl:5'}]})
        result = run('split_rules.py', 'billing', '--rules', rules, '--catalog', self.catalog, '--items', 'invoicing/entry,tax/calc', '--out', self.out)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('1 left out', result.stdout)
        tax = load(os.path.join(self.out, 'applications', 'billing', 'units', 'tax', 'calc', 'rules.json'))
        self.assertEqual([rule['name'] for rule in tax['rules']], ['Tax rounding', 'Amount positive'])
        for rule in tax['rules']:
            self.assertRegex(rule['id'], r'^RULE-tax\.calc-[0-9a-f]{8}$')
        self.assertNotEqual(tax['rules'][0]['id'], tax['rules'][1]['id'])
        entry = load(os.path.join(self.out, 'applications', 'billing', 'units', 'invoicing', 'entry', 'rules.json'))
        self.assertRegex(entry['rules'][0]['id'], r'^RULE-invoicing\.entry-[0-9a-f]{8}$')
        self.assertEqual([obj['name'] for obj in entry['dataObjects']], ['INVOICE-REC'])

        # A rerun with the rules in another order and one added keeps every unchanged rule's id (ADR-0038).
        write(rules, {'confirmedRules': [
            {'name': 'Entry date', 'category': 'Validation', 'priority': 'P1', 'source': 'src/INV01.cbl:40'},
            {'name': 'Elsewhere', 'category': 'Policy', 'priority': 'P2', 'source': 'src/OTHER.cbl:1'},
            {'name': 'Amount positive', 'category': 'Validation', 'priority': 'P1', 'source': 'src/TAX.cbl:3'},
            {'name': 'Tax floor', 'category': 'Calculation', 'priority': 'P1', 'source': 'src/TAXLIB.cbl:20'},
            {'name': 'Tax rounding', 'category': 'Calculation', 'priority': 'P0', 'source': 'src/TAXLIB.cbl:12'},
        ], 'dataObjects': []})
        result = run('split_rules.py', 'billing', '--rules', rules, '--catalog', self.catalog, '--items', 'invoicing/entry,tax/calc', '--out', self.out)
        self.assertEqual(result.returncode, 0, result.stderr)
        again = load(os.path.join(self.out, 'applications', 'billing', 'units', 'tax', 'calc', 'rules.json'))
        self.assertEqual({rule['name']: rule['id'] for rule in again['rules'] if rule['name'] != 'Tax floor'},
                         {rule['name']: rule['id'] for rule in tax['rules']})

        # Two distinct rules on one exact citation are told apart by the rule name, never by order (ADR-0038).
        write(rules, {'confirmedRules': [
            {'name': 'Tax rounding', 'category': 'Calculation', 'priority': 'P0', 'source': 'src/TAXLIB.cbl:12'},
            {'name': 'Tax floor', 'category': 'Calculation', 'priority': 'P1', 'source': 'src/TAXLIB.cbl:12'},
        ], 'dataObjects': []})
        result = run('split_rules.py', 'billing', '--rules', rules, '--catalog', self.catalog, '--items', 'tax/calc', '--out', self.out)
        self.assertEqual(result.returncode, 0, result.stderr)
        shared = load(os.path.join(self.out, 'applications', 'billing', 'units', 'tax', 'calc', 'rules.json'))
        ids = {rule['name']: rule['id'] for rule in shared['rules']}
        self.assertRegex(ids['Tax rounding'], r'^RULE-tax\.calc-[0-9a-f]{8}-tax-rounding$')
        self.assertRegex(ids['Tax floor'], r'^RULE-tax\.calc-[0-9a-f]{8}-tax-floor$')
        self.assertEqual(ids['Tax rounding'][:21], ids['Tax floor'][:21])

        scan = os.path.join(self.root, 'scan.json')
        write(scan, {'findings': [
            {'cwe': 'CWE-89', 'severity': 'Medium', 'source': 'src/TAX.cbl:9', 'title': 'SQL', 'credentialMeta': {'maskedPreview': 'ab**'}},
            {'cwe': 'CWE-798', 'severity': 'Critical', 'source': 'src/TAXLIB.cbl:2', 'title': 'Key', 'isCredential': True},
            {'cwe': 'CWE-1', 'severity': 'Low', 'source': 'src/OTHER.cbl:1', 'title': 'Out'},
        ], 'coverage': {'filesReviewed': ['src/TAX.cbl']}, 'toolsNotRun': [], 'deadFinders': []})
        result = run('split_findings.py', 'billing', '--scan', scan, '--catalog', self.catalog, '--items', 'invoicing/entry,tax/calc', '--out', self.out)
        self.assertEqual(result.returncode, 0, result.stderr)
        findings = load(os.path.join(self.out, 'applications', 'billing', 'units', 'tax', 'calc', 'findings.json'))
        self.assertEqual([(f['id'], f['cwe']) for f in findings['findings']], [('SEC-tax.calc-01', 'CWE-798'), ('SEC-tax.calc-02', 'CWE-89')])
        self.assertNotIn('credentialMeta', json.dumps(findings))
        self.assertEqual(findings['filesReviewed'], ['src/TAX.cbl'])

    def test_a_rerun_keeps_rules_review_and_reports_orphaned_verdicts(self):
        rules = os.path.join(self.root, 'rules_result.json')
        write(rules, {'confirmedRules': [
            {'name': 'Tax rounding', 'category': 'Calculation', 'priority': 'P0', 'source': 'src/TAXLIB.cbl:12'},
        ], 'dataObjects': []})
        result = run('split_rules.py', 'billing', '--rules', rules, '--catalog', self.catalog, '--items', 'tax/calc', '--out', self.out)
        self.assertEqual(result.returncode, 0, result.stderr)
        rule_id = load(os.path.join(self.out, 'applications', 'billing', 'units', 'tax', 'calc', 'rules.json'))['rules'][0]['id']
        review_path = os.path.join(self.out, 'applications', 'billing', 'units', 'tax', 'calc', 'rules-review.json')
        write(review_path, {rule_id: {'verdict': 'confirmed', 'approver': 'jane', 'date': '2026-10-18'},
                            'RULE-tax.calc-00000000': {'verdict': 'refuted', 'approver': 'jane', 'date': '2026-10-18'}})
        result = run('split_rules.py', 'billing', '--rules', rules, '--catalog', self.catalog, '--items', 'tax/calc', '--out', self.out)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('orphaned rule verdict(s)', result.stdout)
        self.assertIn('RULE-tax.calc-00000000', result.stdout)
        self.assertIn('1 rules-review.json kept unchanged', result.stdout)
        kept = load(review_path)
        self.assertEqual(kept[rule_id]['verdict'], 'confirmed')
        self.assertEqual(kept['RULE-tax.calc-00000000']['verdict'], 'refuted')
        # A verdict shape the contract does not know is refused, never silently applied.
        write(review_path, {rule_id: {'verdict': 'wrong', 'approver': 'jane', 'date': '2026-10-18'}})
        result = run('split_rules.py', 'billing', '--rules', rules, '--catalog', self.catalog, '--items', 'tax/calc', '--out', self.out)
        self.assertEqual(result.returncode, 1)
        self.assertIn('rules-review.json', result.stderr)

    def test_finish_items_writes_trace_meta_and_work_items(self):
        inputs = os.path.join(self.root, 'in')
        write(os.path.join(inputs, 'applications', 'billing', 'units', 'tax', 'calc', 'as-is.md'), '# Tax\n')
        write(os.path.join(inputs, 'applications', 'billing', 'units', 'tax', 'calc', 'trace.json'), {
            'entryPoints': ['src/TAX.cbl:1'], 'rulesApplied': ['RULE-tax.calc-01', 'RULE-001', 'RULE-other.x-01'], 'findings': ['SEC-tax.calc-01'],
            'dependencies': [{'target': 'invoicing/entry', 'kind': 'call', 'direction': 'outbound'}, {'target': '../x', 'kind': 'call', 'direction': 'outbound'}],
            'dataObjects': [], 'externalSystems': [],
            'requirements': ['REQ-TAX-01'], 'pullRequests': ['PR-7'], 'tests': ['tests/tax.test'],
            'files': ['src/TAX.cbl', '/etc/passwd'], 'openQuestions': 2})
        write(os.path.join(inputs, 'applications', 'billing', 'units', 'tax', 'calc', 'rules.json'), {'rules': [{'id': 'RULE-tax.calc-01'}]})
        write(os.path.join(inputs, 'applications', 'billing', 'units', 'tax', 'calc', 'findings.json'), {'findings': [{'id': 'SEC-tax.calc-01'}]})
        result = run('finish_items.py', 'billing', '--catalog', self.catalog, '--items', 'tax/calc,invoicing/entry', '--inputs', inputs, '--out', self.out,
                     '--commit', 'a' * 40, '--run', 'run-1', '--repo', 'legacy', '--existing', os.path.join(inputs, 'applications', 'billing', 'units'))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('1 without a specification', result.stdout)
        base = os.path.join(self.out, 'applications', 'billing', 'units', 'tax', 'calc')
        trace = load(os.path.join(base, 'trace.json'))
        self.assertEqual(trace['rulesApplied'], ['RULE-tax.calc-01'])
        self.assertEqual(trace['dependencies'], [{'target': 'invoicing/entry', 'kind': 'call', 'direction': 'outbound'}])
        self.assertEqual(trace['requirements'], ['REQ-TAX-01'])
        self.assertEqual(trace['pullRequests'], ['PR-7'])
        self.assertEqual(trace['tests'], ['tests/tax.test'])
        self.assertEqual(trace['files'], ['src/TAX.cbl'])
        meta = load(os.path.join(base, 'meta.json'))
        self.assertEqual((meta['digest'], meta['commit'], meta['runId']), ('sha256:tax/calc', 'a' * 40, 'run-1'))
        self.assertFalse(os.path.exists(os.path.join(self.out, 'applications', 'billing', 'units', 'invoicing')))
        with open(os.path.join(self.out, 'applications', 'billing', 'units', 'tax', 'calc', 'unit.md'), encoding='utf-8') as handle:
            unit = handle.read()
        self.assertIn('id: "billing/tax/calc"', unit)
        self.assertIn('dependsOn: ["billing/invoicing/entry"]', unit)
        self.assertIn('businessRules: ["RULE-tax.calc-01"]', unit)

    def test_rebuild_aggregates_merges_the_items(self):
        docs = os.path.join(self.root, 'docs')
        write(os.path.join(docs, 'applications', 'billing', 'assessment', 'catalog.json'), CATALOG)
        scoped = run('scope_items.py', 'billing', '--catalog', self.catalog, '--topology', self.topology, '--items', 'tax/calc,invoicing/entry', '--out', docs)
        self.assertEqual(scoped.returncode, 0, scoped.stderr)
        write(os.path.join(docs, 'applications', 'billing', 'units', 'tax', 'calc', 'rules.json'), {'rules': [{'id': 'RULE-tax.calc-01', 'name': 'Round', 'category': 'Calculation', 'priority': 'P0', 'source': 'src/TAX.cbl:3', 'confidence': 'High'}], 'dataObjects': []})
        write(os.path.join(docs, 'applications', 'billing', 'units', 'tax', 'calc', 'findings.json'), {'findings': [{'id': 'SEC-tax.calc-01', 'cwe': 'CWE-89', 'severity': 'High', 'source': 'src/TAX.cbl:9', 'title': 'SQL'}]})
        write(os.path.join(docs, 'applications', 'billing', 'units', 'tax', 'calc', 'meta.json'), {'digest': 'sha256:tax/calc', 'commit': 'a' * 40})
        write(os.path.join(docs, 'applications', 'billing', 'units', 'tax', 'calc', 'trace.json'), {'rulesApplied': ['RULE-tax.calc-01'], 'findings': ['SEC-tax.calc-01'], 'dependencies': []})
        result = run('rebuild_aggregates.py', 'billing', '--docs', docs, '--out', self.out)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('1 of 2 item(s) understood', result.stdout)
        gen = os.path.join(self.out, 'applications', 'billing', 'generated')
        topology = load(os.path.join(gen, 'topology.json'))
        self.assertEqual([d['id'] for d in topology['root']['children']], ['dom:invoicing', 'dom:tax'])
        self.assertEqual(topology['entryPoints'], ['INV01'])
        with open(os.path.join(gen, 'BUSINESS_RULES.md'), encoding='utf-8') as handle:
            self.assertIn('### RULE-tax.calc-01: Round', handle.read())
        with open(os.path.join(gen, 'SECURITY_FINDINGS.md'), encoding='utf-8') as handle:
            self.assertIn('| SEC-tax.calc-01 | CWE-89 | High |', handle.read())
        trace = load(os.path.join(self.out, 'applications', 'billing', 'generated', 'traceability.json'))
        self.assertEqual([(row['id'], row['stale']) for row in trace['units']], [('billing/tax/calc', False)])


if __name__ == '__main__':
    unittest.main()
