import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.dirname(HERE)
sys.path.insert(0, SCRIPTS)
import catalog_common as cc  # noqa: E402
import docmd  # noqa: E402
import render_rules as rr  # noqa: E402


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
    'app': 'billing',
    'modules': [{'id': 'invoicing', 'name': 'Invoicing', 'summary': ''}, {'id': 'tax', 'name': 'Tax', 'summary': ''}],
    'items': [
        item('invoicing/entry', ['src/INV01.cbl'], ['INV01'], entryPoints=['INV01']),
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

UNITS = ('applications', 'billing', 'units')


def unit_file(root, unit, *parts):
    return os.path.join(root, *UNITS, *unit.split('/'), *parts)


class UnderstandToolsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = self.temp.name
        self.out = os.path.join(self.root, 'out')
        # The catalog the assess stage committed, links included.
        for path, text in cc.render_catalog('billing', CATALOG, cc.item_graph(CATALOG['items'], TOPOLOGY)).items():
            write(os.path.join(self.root, 'docs', *path.split('/')), text)
        self.catalog = os.path.join(self.root, 'docs', *cc.paths.assessment_catalog_dir('billing').split('/'))

    def tearDown(self):
        self.temp.cleanup()

    def split_rules(self, rules, items='invoicing/entry,tax/calc'):
        return run('split_rules.py', 'billing', '--rules', rules, '--catalog', self.catalog, '--items', items, '--out', self.out)

    def rules_of(self, unit):
        return rr.unit_rule_cards(docmd.read_text(unit_file(self.out, unit, 'understanding', 'rules.md')))

    def test_scope_items_writes_the_topology_document_the_brief_and_the_shards(self):
        result = run('scope_items.py', 'billing', '--catalog', self.catalog, '--items', 'tax/calc,invoicing/entry', '--out', self.out)
        self.assertEqual(result.returncode, 0, result.stderr)
        text = docmd.read_text(unit_file(self.out, 'invoicing/entry', 'understanding', 'topology.md'))
        front, body = docmd.split_front_matter(text)
        self.assertEqual((front['item'], front['system'], front['leaves'], front['dataStores'], front['entryPoints']), ('invoicing/entry', 'billing', 1, 1, 1))
        sections = dict(docmd.sections(body, 2))
        self.assertEqual(docmd.records_in(sections['Depends on']), [{'item': 'tax/calc', 'kinds': 'call', 'edges': '1'}])
        self.assertEqual(docmd.records_in(sections['Data stores']), [{'store': 'ds:INVOICES', 'access': 'write'}])
        self.assertEqual(docmd.records_in(sections['Leaves'])[0]['entry point'], 'yes')
        scratch = os.path.join(self.out, 'scratch', 'billing', 'understand')
        brief = load(os.path.join(scratch, 'briefs', 'invoicing', 'entry.json'))
        self.assertEqual(brief['dependsOn'], ['tax/calc'])
        self.assertEqual(brief['dataStores'], [{'id': 'ds:INVOICES', 'access': ['write']}])
        self.assertTrue(brief['topology'].endswith('/understanding/topology.md'))
        tax = load(os.path.join(scratch, 'briefs', 'tax', 'calc.json'))
        self.assertEqual(tax['usedBy'], ['invoicing/entry'])
        self.assertEqual([shard['name'] for shard in load(os.path.join(scratch, 'shards.json'))], ['invoicing.entry', 'tax.calc'])
        self.assertEqual(load(os.path.join(scratch, 'scope.json'))['files'], ['src/INV01.cbl', 'src/TAX.cbl', 'src/TAXLIB.cbl'])

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
        ], 'dataObjects': [{'name': 'INVOICE-REC', 'source': 'src/INV01.cbl:5', 'fields': [{'name': 'AMOUNT', 'type': 'decimal'}]}]})
        result = self.split_rules(rules)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('1 left out', result.stdout)
        tax = self.rules_of('tax/calc')
        self.assertEqual(len(tax), 2)
        for rule_id, card in tax:
            self.assertRegex(rule_id, r'^RULE-tax\.calc-[0-9a-f]{8}$')
            self.assertIn(f'### {rule_id}: ', card)
        self.assertNotEqual(tax[0][0], tax[1][0])
        self.assertEqual([row['name'] for row in rr.unit_rule_rows(docmd.read_text(unit_file(self.out, 'tax/calc', 'understanding', 'rules.md')))], ['Tax rounding', 'Amount positive'])
        entry = self.rules_of('invoicing/entry')
        self.assertRegex(entry[0][0], r'^RULE-invoicing\.entry-[0-9a-f]{8}$')
        objects = docmd.read_text(unit_file(self.out, 'invoicing/entry', 'understanding', 'data-objects.md'))
        self.assertIn('## INVOICE-REC', objects)
        self.assertIn('| AMOUNT | decimal |', objects)
        self.assertNotIn('"rules"', docmd.read_text(unit_file(self.out, 'tax/calc', 'understanding', 'rules.md')))

        # A rerun with the rules in another order and one added keeps every unchanged rule's id (ADR-0038).
        write(rules, {'confirmedRules': [
            {'name': 'Entry date', 'category': 'Validation', 'priority': 'P1', 'source': 'src/INV01.cbl:40'},
            {'name': 'Elsewhere', 'category': 'Policy', 'priority': 'P2', 'source': 'src/OTHER.cbl:1'},
            {'name': 'Amount positive', 'category': 'Validation', 'priority': 'P1', 'source': 'src/TAX.cbl:3'},
            {'name': 'Tax floor', 'category': 'Calculation', 'priority': 'P1', 'source': 'src/TAXLIB.cbl:20'},
            {'name': 'Tax rounding', 'category': 'Calculation', 'priority': 'P0', 'source': 'src/TAXLIB.cbl:12'},
        ], 'dataObjects': []})
        self.assertEqual(self.split_rules(rules).returncode, 0)
        names = lambda cards: {re.sub(r'^### \S+: ', '', card.split('\n', 1)[0]): rule_id for rule_id, card in cards}  # noqa: E731
        again = names(self.rules_of('tax/calc'))
        before = names(tax)
        self.assertEqual({name: rule_id for name, rule_id in again.items() if name != 'Tax floor'}, before)

        # Two distinct rules on one exact citation are told apart by the rule name, never by order (ADR-0038).
        write(rules, {'confirmedRules': [
            {'name': 'Tax rounding', 'category': 'Calculation', 'priority': 'P0', 'source': 'src/TAXLIB.cbl:12'},
            {'name': 'Tax floor', 'category': 'Calculation', 'priority': 'P1', 'source': 'src/TAXLIB.cbl:12'},
        ], 'dataObjects': []})
        self.assertEqual(self.split_rules(rules, 'tax/calc').returncode, 0)
        ids = names(self.rules_of('tax/calc'))
        self.assertRegex(ids['Tax rounding'], r'^RULE-tax\.calc-[0-9a-f]{8}-tax-rounding$')
        self.assertRegex(ids['Tax floor'], r'^RULE-tax\.calc-[0-9a-f]{8}-tax-floor$')
        self.assertEqual(ids['Tax rounding'][:21], ids['Tax floor'][:21])

        scan = os.path.join(self.root, 'scan.json')
        write(scan, {'findings': [
            {'cwe': 'CWE-89', 'severity': 'Medium', 'source': 'src/TAX.cbl:9', 'title': 'SQL', 'recommendedFix': 'Bind the parameter.', 'credentialMeta': {'maskedPreview': 'ab**'}},
            {'cwe': 'CWE-798', 'severity': 'Critical', 'source': 'src/TAXLIB.cbl:2', 'title': 'Key', 'isCredential': True},
            {'cwe': 'CWE-1', 'severity': 'Low', 'source': 'src/OTHER.cbl:1', 'title': 'Out'},
        ], 'coverage': {'filesReviewed': ['src/TAX.cbl']}, 'toolsNotRun': [], 'deadFinders': []})
        result = run('split_findings.py', 'billing', '--scan', scan, '--catalog', self.catalog, '--items', 'invoicing/entry,tax/calc', '--out', self.out)
        self.assertEqual(result.returncode, 0, result.stderr)
        text = docmd.read_text(unit_file(self.out, 'tax/calc', 'understanding', 'findings.md'))
        import split_findings as sf
        self.assertEqual([(row['id'], row['cwe'], row['severity']) for row in sf.finding_rows(text)], [('SEC-tax.calc-01', 'CWE-798', 'Critical'), ('SEC-tax.calc-02', 'CWE-89', 'Medium')])
        self.assertNotIn('credentialMeta', text)
        self.assertNotIn('ab**', text)
        self.assertIn('Bind the parameter.', text)
        self.assertEqual(docmd.split_front_matter(text)[0]['filesReviewed'], 1)

    def test_a_rerun_keeps_rules_review_and_reports_orphaned_verdicts(self):
        rules = os.path.join(self.root, 'rules_result.json')
        write(rules, {'confirmedRules': [{'name': 'Tax rounding', 'category': 'Calculation', 'priority': 'P0', 'source': 'src/TAXLIB.cbl:12'}], 'dataObjects': []})
        self.assertEqual(self.split_rules(rules, 'tax/calc').returncode, 0)
        rule_id = self.rules_of('tax/calc')[0][0]
        review_path = unit_file(self.out, 'tax/calc', 'understanding', 'rules-review.md')
        review = docmd.table(['Rule', 'Verdict', 'Approver', 'Date'], [[rule_id, 'confirmed', 'jane', '2026-10-18'], ['RULE-tax.calc-00000000', 'refuted', 'jane', '2026-10-18']])
        write(review_path, review)
        result = self.split_rules(rules, 'tax/calc')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('orphaned rule verdict(s)', result.stdout)
        self.assertIn('RULE-tax.calc-00000000', result.stdout)
        self.assertIn('1 rules-review.md kept unchanged', result.stdout)
        self.assertEqual(docmd.read_text(review_path), review)
        # A verdict the contract does not know is refused, never silently applied.
        write(review_path, docmd.table(['Rule', 'Verdict', 'Approver', 'Date'], [[rule_id, 'wrong', 'jane', '2026-10-18']]))
        result = self.split_rules(rules, 'tax/calc')
        self.assertEqual(result.returncode, 1)
        self.assertIn('rules-review.md', result.stderr)

    def finish_inputs(self):
        inputs = os.path.join(self.root, 'in')
        write(unit_file(inputs, 'tax/calc', 'understanding', 'as-is.md'), '# Tax\n')
        write(os.path.join(inputs, 'scratch', 'billing', 'understand', 'trace', 'tax', 'calc.json'), {
            'entryPoints': ['src/TAX.cbl:1'], 'rulesApplied': ['RULE-tax.calc-01', 'RULE-001', 'RULE-other.x-01'], 'findings': ['SEC-tax.calc-01'],
            'dependencies': [{'target': 'invoicing/entry', 'kind': 'call', 'direction': 'outbound'}, {'target': '../x', 'kind': 'call', 'direction': 'outbound'}],
            'dataObjects': [], 'externalSystems': [],
            'requirements': ['REQ-TAX-01'], 'pullRequests': ['PR-7'], 'tests': ['tests/tax.test'],
            'files': ['src/TAX.cbl', '/etc/passwd'], 'openQuestions': 2})
        rules_json = {'confirmedRules': [{'id': 'RULE-tax.calc-01', 'name': 'Round', 'category': 'Calculation', 'priority': 'P0', 'source': 'src/TAX.cbl:3', 'confidence': 'High'}]}
        write(unit_file(inputs, 'tax/calc', 'understanding', 'rules.md'), rr.render_unit_rules('billing', 'tax/calc', rules_json['confirmedRules']))
        import split_findings as sf
        write(unit_file(inputs, 'tax/calc', 'understanding', 'findings.md'), sf.render_findings('billing', 'tax/calc', [{'id': 'SEC-tax.calc-01', 'cwe': 'CWE-89', 'severity': 'High', 'source': 'src/TAX.cbl:9', 'title': 'SQL'}], ['src/TAX.cbl'], [], []))
        return inputs

    def test_finish_items_writes_trace_the_understanding_record_and_work_items(self):
        inputs = self.finish_inputs()
        result = run('finish_items.py', 'billing', '--catalog', self.catalog, '--items', 'tax/calc,invoicing/entry', '--inputs', inputs, '--out', self.out,
                     '--commit', 'a' * 40, '--run', 'run-1', '--repo', 'legacy', '--existing', os.path.join(inputs, *UNITS))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('1 without a specification', result.stdout)
        front, body = docmd.split_front_matter(docmd.read_text(unit_file(self.out, 'tax/calc', 'understanding', 'trace.md')))
        self.assertEqual(front['openQuestions'], 2)
        sections = dict(docmd.sections(body, 2))
        self.assertEqual(docmd.bullets_in(sections['Rules applied']), ['RULE-tax.calc-01'])
        self.assertEqual(docmd.records_in(sections['Dependencies']), [{'target': 'invoicing/entry', 'kind': 'call', 'direction': 'outbound'}])
        self.assertEqual(docmd.bullets_in(sections['Requirements']), ['REQ-TAX-01'])
        self.assertEqual(docmd.bullets_in(sections['Pull requests']), ['PR-7'])
        self.assertEqual(docmd.bullets_in(sections['Tests']), ['tests/tax.test'])
        self.assertEqual(docmd.bullets_in(sections['Files']), ['src/TAX.cbl'])
        record = docmd.split_front_matter(docmd.read_text(unit_file(self.out, 'tax/calc', 'understanding', 'understanding.md')))[0]
        self.assertEqual((record['status'], record['digest'], record['commit'], record['runId']), ('understood', 'sha256:tax/calc', 'a' * 40, 'run-1'))
        self.assertFalse(os.path.exists(os.path.join(self.out, *UNITS, 'invoicing')))
        unit = docmd.read_text(unit_file(self.out, 'tax/calc', 'unit.md'))
        self.assertIn('id: "billing/tax/calc"', unit)
        self.assertIn('dependsOn: ["billing/invoicing/entry"]', unit)
        self.assertIn('businessRules: ["RULE-tax.calc-01"]', unit)
        self.assertIn('asIs: "applications/billing/units/tax/calc/understanding/as-is.md"', unit)
        for root, _, names in os.walk(os.path.join(self.out, *UNITS)):
            self.assertFalse([name for name in names if name.endswith('.json')], root)

    def test_rebuild_aggregates_merges_the_units_into_markdown_read_models(self):
        docs = os.path.join(self.root, 'docs')
        inputs = self.finish_inputs()
        self.assertEqual(run('finish_items.py', 'billing', '--catalog', self.catalog, '--items', 'tax/calc', '--inputs', inputs, '--out', docs, '--commit', 'a' * 40, '--run', 'run-1').returncode, 0)
        for name in ('as-is.md', 'rules.md', 'findings.md'):
            write(unit_file(docs, 'tax/calc', 'understanding', name), docmd.read_text(unit_file(inputs, 'tax/calc', 'understanding', name)))
        result = run('rebuild_aggregates.py', 'billing', '--docs', docs, '--out', self.out)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('1 of 2 item(s) understood', result.stdout)
        gen = os.path.join(self.out, 'applications', 'billing', 'generated')
        self.assertEqual(sorted(os.listdir(gen)), ['BUSINESS_RULES.md', 'DATA_OBJECTS.md', 'README.md', 'SECURITY_FINDINGS.md', 'traceability.md'])
        self.assertIn('### RULE-tax.calc-01: Round', docmd.read_text(os.path.join(gen, 'BUSINESS_RULES.md')))
        self.assertIn('| SEC-tax.calc-01 | CWE-89 | High |', docmd.read_text(os.path.join(gen, 'SECURITY_FINDINGS.md')))
        front, body = docmd.split_front_matter(docmd.read_text(os.path.join(gen, 'traceability.md')))
        self.assertEqual((front['items'], front['units'], front['rulesCovered'], front['findingsMapped'], front['openQuestions'], front['stale']), (2, 1, 1, 1, 2, 0))
        self.assertIn('`tax/calc`', body)


if __name__ == '__main__':
    unittest.main()
