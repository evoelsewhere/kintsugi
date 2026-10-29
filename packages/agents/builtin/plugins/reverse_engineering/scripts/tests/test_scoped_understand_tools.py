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
import citations  # noqa: E402
import docmd  # noqa: E402
import render_rules as rr  # noqa: E402
import rule_docs as rd  # noqa: E402


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

APP = ('10-applications', 'billing')
UNITS = (*APP, '01-legacy')


def unit_file(root, unit, *parts):
    """A file of the unit's legacy folder (what is known about it)."""
    return os.path.join(root, *UNITS, *unit.split('/'), *parts)


def card_file(root, unit):
    """The unit's card on the modern side."""
    return os.path.join(root, *APP, '02-modern', *unit.split('/'), 'README.md')


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

    def split_rules(self, rules, items='invoicing/entry,tax/calc', docs=None, date='2026-10-21'):
        extra = ['--docs', docs] if docs else []
        return run('split_rules.py', 'billing', '--rules', rules, '--catalog', self.catalog, '--items', items, '--out', self.out, '--date', date, '--sources', f'legacy@{"c" * 40}', *extra)

    def rules_of(self, unit, root=None):
        """[(rule id, text of the rule's file)] in the order of the unit's rules index."""
        root = root or self.out
        rows = rr.unit_rule_rows(docmd.read_text(unit_file(root, unit, 'rules.md')))
        return [(row['id'], docmd.read_text(unit_file(root, unit, 'rules', f"{row['id']}.md"))) for row in rows if row['status'] != 'retired']

    def test_scope_items_writes_the_topology_document_the_brief_and_the_shards(self):
        result = run('scope_items.py', 'billing', '--catalog', self.catalog, '--items', 'tax/calc,invoicing/entry', '--out', self.out)
        self.assertEqual(result.returncode, 0, result.stderr)
        text = docmd.read_text(unit_file(self.out, 'invoicing/entry', 'topology.md'))
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
        self.assertTrue(brief['topology'].endswith('/01-legacy/invoicing/entry/topology.md'), brief['topology'])
        tax = load(os.path.join(scratch, 'briefs', 'tax', 'calc.json'))
        self.assertEqual(tax['usedBy'], ['invoicing/entry'])
        self.assertEqual([shard['name'] for shard in load(os.path.join(scratch, 'shards.json'))], ['invoicing.entry', 'tax.calc'])
        self.assertEqual(load(os.path.join(scratch, 'scope.json'))['files'], ['src/INV01.cbl', 'src/TAX.cbl', 'src/TAXLIB.cbl'])

    PROGRAM_PROFILE = ('---\nkind: "program"\nversion: 2\n---\n# Specification profile: program\n\n## Sections\n\n'
                       '| Section | What it holds | Evidence |\n|---|---|---|\n| Copybooks | the copybooks it includes | COPY statements |\n| Return codes | what it returns | the exit paths |\n\n'
                       '## Instructions\n\nList every copybook.\n')

    def test_scope_items_puts_the_profile_of_the_kind_in_the_brief(self):
        standards = os.path.join(self.root, 'standards')
        write(os.path.join(standards, 'program.md'), self.PROGRAM_PROFILE)
        write(os.path.join(standards, 'module.md'), 'not a profile')
        result = run('scope_items.py', 'billing', '--catalog', self.catalog, '--items', 'tax/calc', '--out', self.out, '--standards', standards)
        self.assertEqual(result.returncode, 0, result.stderr)
        brief = load(os.path.join(self.out, 'scratch', 'billing', 'understand', 'briefs', 'tax', 'calc.json'))
        self.assertEqual(brief['profile']['kind'], 'program')
        self.assertEqual((brief['profile']['version'], brief['profile']['source']), (2, 'project'))
        self.assertEqual([section['name'] for section in brief['profile']['sections']], ['Copybooks', 'Return codes'])
        self.assertEqual(brief['profile']['instructions'], 'List every copybook.')
        # Without a project file a kind with no built-in profile has none.
        result = run('scope_items.py', 'billing', '--catalog', self.catalog, '--items', 'tax/calc', '--out', self.out)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIsNone(load(os.path.join(self.out, 'scratch', 'billing', 'understand', 'briefs', 'tax', 'calc.json'))['profile'])

    def test_finish_items_records_the_profile_and_the_sections_the_specification_lacks(self):
        standards = os.path.join(self.root, 'standards')
        write(os.path.join(standards, 'program.md'), self.PROGRAM_PROFILE)
        inputs = self.finish_inputs()
        self.assertEqual(run('scope_items.py', 'billing', '--catalog', self.catalog, '--items', 'tax/calc', '--out', inputs, '--standards', standards).returncode, 0)
        write(unit_file(inputs, 'tax/calc', 'spec.md'), '# Tax\n\n## Purpose\n\nRounds.\n\n## Copybooks\n\nTAXTAB.\n\n## Gaps and questions\n\nNone.\n')
        result = run('finish_items.py', 'billing', '--catalog', self.catalog, '--items', 'tax/calc', '--inputs', inputs, '--out', self.out, '--sources', 'legacy@' + 'a' * 40, '--run', 'run-1')
        self.assertEqual(result.returncode, 0, result.stderr)
        record = docmd.split_front_matter(docmd.read_text(unit_file(self.out, 'tax/calc', 'understanding.md')))[0]
        self.assertEqual((record['profile'], record['profileMissing']), ('program@2', ['Return codes']))
        self.assertIn('tax/calc: no section "Return codes" of the program profile', result.stdout)
        # A complete specification records the profile and nothing missing.
        write(unit_file(inputs, 'tax/calc', 'spec.md'), '# Tax\n\n## 3. Copybooks\n\nTAXTAB.\n\n## Return codes\n\n0.\n\n## Gaps and questions\n\nNone.\n')
        result = run('finish_items.py', 'billing', '--catalog', self.catalog, '--items', 'tax/calc', '--inputs', inputs, '--out', self.out, '--sources', 'legacy@' + 'a' * 40, '--run', 'run-1')
        self.assertEqual(result.returncode, 0, result.stderr)
        record = docmd.split_front_matter(docmd.read_text(unit_file(self.out, 'tax/calc', 'understanding.md')))[0]
        self.assertEqual(record['profile'], 'program@2')
        self.assertNotIn('profileMissing', record)

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
            self.assertRegex(rule_id, r'^RULE-TAX01-[0-9]{4}$')
            self.assertIn(f'\n# {rule_id}: ', card)
            self.assertEqual(docmd.split_front_matter(card)[0]['version'], 1)
        self.assertNotEqual(tax[0][0], tax[1][0])
        self.assertEqual([row['name'] for row in rr.unit_rule_rows(docmd.read_text(unit_file(self.out, 'tax/calc', 'rules.md')))], ['Tax rounding', 'Amount positive'])
        entry = self.rules_of('invoicing/entry')
        self.assertRegex(entry[0][0], r'^RULE-INVO01-[0-9]{4}$')
        objects = docmd.read_text(unit_file(self.out, 'invoicing/entry', 'data-objects.md'))
        self.assertIn('## INVOICE-REC', objects)
        self.assertIn('| AMOUNT | decimal |', objects)
        index = docmd.read_text(unit_file(self.out, 'tax/calc', 'rules.md'))
        self.assertNotIn('"rules"', index)
        self.assertEqual(docmd.split_front_matter(index)[0]['catalogVersion'], 1)
        self.assertIn(f'[{tax[0][0]}](rules/{tax[0][0]}.md)', index)
        self.assertEqual([line for line in index.splitlines() if line.startswith('### ')], [])

        # A rerun with the rules in another order and one added keeps every unchanged rule's id (ADR-0038).
        write(rules, {'confirmedRules': [
            {'name': 'Entry date', 'category': 'Validation', 'priority': 'P1', 'source': 'src/INV01.cbl:40'},
            {'name': 'Elsewhere', 'category': 'Policy', 'priority': 'P2', 'source': 'src/OTHER.cbl:1'},
            {'name': 'Amount positive', 'category': 'Validation', 'priority': 'P1', 'source': 'src/TAX.cbl:3'},
            {'name': 'Tax floor', 'category': 'Calculation', 'priority': 'P1', 'source': 'src/TAXLIB.cbl:20'},
            {'name': 'Tax rounding', 'category': 'Calculation', 'priority': 'P0', 'source': 'src/TAXLIB.cbl:12'},
        ], 'dataObjects': []})
        self.assertEqual(self.split_rules(rules).returncode, 0)
        names = lambda cards: {docmd.split_front_matter(card)[0]['name']: rule_id for rule_id, card in cards}  # noqa: E731
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
        self.assertRegex(ids['Tax rounding'], r'^RULE-TAX01-[0-9]{4}$')
        self.assertRegex(ids['Tax floor'], r'^RULE-TAX01-[0-9]{4}$')
        self.assertEqual(ids['Tax rounding'].rsplit('-', 1)[0], ids['Tax floor'].rsplit('-', 1)[0])

        scan = os.path.join(self.root, 'scan.json')
        write(scan, {'findings': [
            {'cwe': 'CWE-89', 'severity': 'Medium', 'source': 'src/TAX.cbl:9', 'title': 'SQL', 'recommendedFix': 'Bind the parameter.', 'credentialMeta': {'maskedPreview': 'ab**'}},
            {'cwe': 'CWE-798', 'severity': 'Critical', 'source': 'src/TAXLIB.cbl:2', 'title': 'Key', 'isCredential': True},
            {'cwe': 'CWE-1', 'severity': 'Low', 'source': 'src/OTHER.cbl:1', 'title': 'Out'},
        ], 'coverage': {'filesReviewed': ['src/TAX.cbl']}, 'toolsNotRun': [], 'deadFinders': []})
        result = run('split_findings.py', 'billing', '--scan', scan, '--catalog', self.catalog, '--items', 'invoicing/entry,tax/calc', '--out', self.out)
        self.assertEqual(result.returncode, 0, result.stderr)
        text = docmd.read_text(unit_file(self.out, 'tax/calc', 'findings.md'))
        import split_findings as sf
        self.assertEqual([(row['id'], row['cwe'], row['severity']) for row in sf.finding_rows(text)], [('SEC-TAX01-0001', 'CWE-798', 'Critical'), ('SEC-TAX01-0002', 'CWE-89', 'Medium')])
        self.assertNotIn('credentialMeta', text)
        self.assertNotIn('ab**', text)
        self.assertIn('Bind the parameter.', text)
        self.assertEqual(docmd.split_front_matter(text)[0]['filesReviewed'], 1)

    def test_a_rerun_keeps_rules_review_and_reports_orphaned_verdicts(self):
        rules = os.path.join(self.root, 'rules_result.json')
        write(rules, {'confirmedRules': [{'name': 'Tax rounding', 'category': 'Calculation', 'priority': 'P0', 'source': 'src/TAXLIB.cbl:12'}], 'dataObjects': []})
        self.assertEqual(self.split_rules(rules, 'tax/calc').returncode, 0)
        rule_id = self.rules_of('tax/calc')[0][0]
        review_path = unit_file(self.out, 'tax/calc', 'rules-review.md')
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

    def test_a_rerun_keeps_unchanged_rules_bumps_changed_ones_and_retires_the_missing(self):
        rules = os.path.join(self.root, 'rules_result.json')
        first = [{'name': 'Tax rounding', 'category': 'Calculation', 'priority': 'P0', 'source': 'src/TAXLIB.cbl:12', 'given': 'g', 'when': 'w', 'then': 'half up', 'confidence': 'High'},
                 {'name': 'Tax floor', 'category': 'Calculation', 'priority': 'P1', 'source': 'src/TAXLIB.cbl:20', 'given': 'g', 'when': 'w', 'then': 'zero', 'confidence': 'High'},
                 {'name': 'Amount positive', 'category': 'Validation', 'priority': 'P1', 'source': 'src/TAX.cbl:3', 'confidence': 'High'}]
        write(rules, {'confirmedRules': first, 'dataObjects': []})
        self.assertEqual(self.split_rules(rules, 'tax/calc').returncode, 0)
        ids = {docmd.split_front_matter(text)[0]['name']: rule_id for rule_id, text in self.rules_of('tax/calc')}
        before = self.out
        self.out = os.path.join(self.root, 'out2')
        # Same rules, one changed, one gone: the repository holds the first run.
        second = [{**first[0], 'then': 'half even'}, first[1]]
        write(rules, {'confirmedRules': second, 'dataObjects': []})
        self.assertEqual(self.split_rules(rules, 'tax/calc', docs=before, date='2026-10-22').returncode, 0)
        files = {docmd.split_front_matter(text)[0]['name']: docmd.split_front_matter(text)[0] for _, text in self.rules_of('tax/calc')}
        self.assertEqual((files['Tax rounding']['version'], files['Tax floor']['version']), (2, 1))
        rounding = docmd.read_text(unit_file(self.out, 'tax/calc', 'rules', f"{ids['Tax rounding']}.md"))
        history = docmd.records_in(dict(docmd.sections(docmd.split_front_matter(rounding)[1], 2))['Version history'])
        self.assertEqual([(row['version'], row['date'], row['change'], row['commit']) for row in history], [('1', '2026-10-21', 'Rule extracted', f'legacy@{"c" * 40}'), ('2', '2026-10-22', 'Rule changed', f'legacy@{"c" * 40}')])
        # The rule that is no longer extracted becomes a tombstone and moves to the retired table.
        gone = docmd.read_text(unit_file(self.out, 'tax/calc', 'rules', f"{ids['Amount positive']}.md"))
        front = docmd.split_front_matter(gone)[0]
        self.assertEqual((front['status'], front['version']), ('retired', 2))
        self.assertIn('> Retired 2026-10-22', gone)
        index = docmd.read_text(unit_file(self.out, 'tax/calc', 'rules.md'))
        retired = docmd.records_in(dict(docmd.sections(docmd.split_front_matter(index)[1], 2))['Retired rules'])
        self.assertEqual([(row['id'], row['last version'], row['retired']) for row in retired], [(ids['Amount positive'], '2', '2026-10-22')])
        self.assertEqual(docmd.split_front_matter(index)[0]['catalogVersion'], 2)
        self.assertEqual(docmd.split_front_matter(index)[0]['rules'], 2)
        # A third run that changes nothing writes the same documents: versions, history and catalogVersion hold.
        second_out = self.out
        self.out = os.path.join(self.root, 'out3')
        self.assertEqual(self.split_rules(rules, 'tax/calc', docs=second_out, date='2026-10-25').returncode, 0)
        for name in os.listdir(os.path.join(second_out, *UNITS, 'tax', 'calc', 'rules')):
            if name.startswith(ids['Amount positive']):
                continue
            self.assertEqual(docmd.read_text(unit_file(self.out, 'tax/calc', 'rules', name)), docmd.read_text(unit_file(second_out, 'tax/calc', 'rules', name)))
        self.assertEqual(docmd.read_text(unit_file(self.out, 'tax/calc', 'rules.md')), index)
        self.assertFalse(os.path.exists(unit_file(self.out, 'tax/calc', 'rules', f"{ids['Amount positive']}.md")), 'a retired rule is not rewritten')

    def finish_inputs(self):
        inputs = os.path.join(self.root, 'in')
        write(unit_file(inputs, 'tax/calc', 'spec.md'), '# Tax\n\n## Gaps and questions\n\n| ID | Kind | Question | Where | Impact |\n| --- | --- | --- | --- | --- |\n| GAP-TAX01-0001 | ambiguous | Which rounding mode? | RULE-tax.calc-01 | risk |\n| GAP-TAX01-0002 | missing-source | Where is TAXTAB? | legacy/src/TAX.cbl:4 | blocking |\n')
        write(os.path.join(inputs, 'scratch', 'billing', 'understand', 'trace', 'tax', 'calc.json'), {
            'entryPoints': ['src/TAX.cbl:1'], 'rulesApplied': ['RULE-tax.calc-01', 'RULE-001', 'RULE-other.x-01'], 'findings': ['SEC-tax.calc-01'],
            'dependencies': [{'target': 'invoicing/entry', 'kind': 'call', 'direction': 'outbound'}, {'target': '../x', 'kind': 'call', 'direction': 'outbound'}],
            'dataObjects': [], 'externalSystems': [],
            'requirements': ['REQ-TAX-01'], 'pullRequests': ['PR-7'], 'tests': ['tests/tax.test'],
            'files': ['src/TAX.cbl', '/etc/passwd'], 'openQuestions': 2})
        rules_json = {'confirmedRules': [{'id': 'RULE-tax.calc-01', 'name': 'Round', 'category': 'Calculation', 'priority': 'P0', 'source': 'src/TAX.cbl:3', 'confidence': 'High'}]}
        write(unit_file(inputs, 'tax/calc', 'rules.md'), rd.render_unit_index('billing', 'tax/calc', [{'rule': r, 'version': 1} for r in rules_json['confirmedRules']], [], 1))
        import split_findings as sf
        write(unit_file(inputs, 'tax/calc', 'findings.md'), sf.render_findings('billing', 'tax/calc', [{'id': 'SEC-tax.calc-01', 'cwe': 'CWE-89', 'severity': 'High', 'source': 'src/TAX.cbl:9', 'title': 'SQL'}], ['src/TAX.cbl'], [], []))
        return inputs

    def test_finish_items_writes_trace_the_understanding_record_and_work_items(self):
        inputs = self.finish_inputs()
        result = run('finish_items.py', 'billing', '--catalog', self.catalog, '--items', 'tax/calc,invoicing/entry', '--inputs', inputs, '--out', self.out,
                     '--sources', 'legacy@' + 'a' * 40, '--run', 'run-1', '--existing', os.path.join(inputs, *UNITS))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('1 without a specification', result.stdout)
        front, body = docmd.split_front_matter(docmd.read_text(unit_file(self.out, 'tax/calc', 'trace.md')))
        self.assertEqual(front['openQuestions'], 2)
        sections = dict(docmd.sections(body, 2))
        self.assertEqual(docmd.bullets_in(sections['Rules applied']), ['RULE-tax.calc-01'])
        self.assertEqual(docmd.records_in(sections['Dependencies']), [{'target': 'invoicing/entry', 'kind': 'call', 'direction': 'outbound'}])
        self.assertEqual(docmd.bullets_in(sections['Requirements']), ['REQ-TAX-01'])
        self.assertEqual(docmd.bullets_in(sections['Pull requests']), ['PR-7'])
        self.assertEqual(docmd.bullets_in(sections['Tests']), ['tests/tax.test'])
        self.assertEqual(docmd.bullets_in(sections['Files']), ['src/TAX.cbl'])
        record = docmd.split_front_matter(docmd.read_text(unit_file(self.out, 'tax/calc', 'understanding.md')))[0]
        self.assertEqual((record['status'], record['digest'], record['sources'], record['runId']), ('understood', 'sha256:tax/calc', ['legacy@' + 'a' * 40], 'run-1'))
        self.assertFalse(os.path.exists(os.path.join(self.out, *UNITS, 'invoicing')))
        unit = docmd.read_text(card_file(self.out, 'tax/calc'))
        self.assertIn('id: "billing/tax/calc"', unit)
        self.assertIn('dependsOn: ["billing/invoicing/entry"]', unit)
        self.assertIn('businessRules: ["RULE-tax.calc-01"]', unit)
        self.assertIn('asIs: "10-applications/billing/01-legacy/tax/calc/spec.md"', unit)
        for root, _, names in os.walk(os.path.join(self.out, *APP)):
            self.assertFalse([name for name in names if name.endswith('.json')], root)

    def test_finish_items_counts_the_gaps_the_specification_lists(self):
        # The count of open questions is the rows of the Gaps and questions table, not the agent's own number (ADR-0057).
        inputs = self.finish_inputs()
        gaps = ('# Tax\n\n## Purpose\n\nRounds.\n\n## Gaps and questions\n\n'
                '| ID | Kind | Question | Where | Impact |\n| --- | --- | --- | --- | --- |\n'
                '| `GAP-tax.calc-01` | missing-source | What does copybook TAXTAB hold? | `legacy/src/TAX.cbl:4` | blocking |\n'
                '| GAP-tax.calc-02 | ambiguous | Why 0.0825? | RULE-tax.calc-01 | risk |\n'
                '| GAP-tax.calc-02 | ambiguous | Again | RULE-tax.calc-01 | risk |\n'
                '| GAP-tax.calc-03 | guess | Which table? | `legacy/src/TAX.cbl:9` | huge |\n'
                '| NOTE-1 | note | Not a gap id | - | note |\n')
        write(unit_file(inputs, 'tax/calc', 'spec.md'), gaps)
        result = run('finish_items.py', 'billing', '--catalog', self.catalog, '--items', 'tax/calc', '--inputs', inputs, '--out', self.out, '--sources', 'legacy@' + 'a' * 40, '--run', 'run-1')
        self.assertNotEqual(result.returncode, 0)
        for note in ('GAP-tax.calc-02 is listed twice', 'GAP-tax.calc-03 has kind "guess"', 'GAP-tax.calc-03 has impact "huge"', 'NOTE-1 is not a gap id'):
            self.assertIn(note, result.stderr)
        # "None." under the heading is zero gaps, whatever the agent counted.
        write(unit_file(inputs, 'tax/calc', 'spec.md'), '# Tax\n\n## Gaps and questions\n\nNone.\n')
        result = run('finish_items.py', 'billing', '--catalog', self.catalog, '--items', 'tax/calc', '--inputs', inputs, '--out', self.out, '--sources', 'legacy@' + 'a' * 40, '--run', 'run-1')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(docmd.split_front_matter(docmd.read_text(unit_file(self.out, 'tax/calc', 'trace.md')))[0]['openQuestions'], 0)
        self.assertNotIn('gaps table', result.stdout)

    def test_finish_items_lists_the_citations_that_do_not_resolve_in_the_understanding_record(self):
        # With --src the citations of spec.md, rules.md and findings.md are checked against the checkout (ADR-0085).
        inputs = self.finish_inputs()
        src = os.path.join(self.root, 'as-is')
        write(os.path.join(src, 'legacy', 'src', 'TAX.cbl'), ''.join(f'LINE {n}\n' for n in range(1, 6)))
        args = ['finish_items.py', 'billing', '--catalog', self.catalog, '--items', 'tax/calc', '--inputs', inputs, '--out', self.out, '--sources', 'legacy@' + 'a' * 40, '--run', 'run-1']
        result = run(*args, '--src', src)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('tax/calc: citation src/TAX.cbl:9 in findings.md: line 9 is past the end of the file (5 lines)', result.stdout)
        front, body = docmd.split_front_matter(docmd.read_text(unit_file(self.out, 'tax/calc', 'understanding.md')))
        self.assertEqual((front['citations'], front['citationsInvalid']), (3, 1))
        # ADR-0087: the digest of each cited range that holds, for the plan to tell when the source moves on.
        self.assertEqual(front['citedLines'], 2)
        self.assertEqual(sorted(citations.recorded_cited_lines(docmd.read_text(unit_file(self.out, 'tax/calc', 'understanding.md')))), ['legacy/src/TAX.cbl:3-3', 'legacy/src/TAX.cbl:4-4'])
        rows = docmd.records_in(dict(docmd.sections(body, 2))['Citations that do not resolve'])
        self.assertEqual(rows, [{'citation': '`src/TAX.cbl:9`', 'document': 'findings.md', 'why': 'line 9 is past the end of the file (5 lines)'}])
        self.assertNotIn('readRecord', front, 'no record of reads: nothing said about them')
        # With the record of what the specification job was shown (ADR-0086): coverage, and the citations it was not shown.
        write(unit_file(inputs, 'tax/calc', 'spec.md'), docmd.read_text(unit_file(inputs, 'tax/calc', 'spec.md')).replace('# Tax\n', '# Tax\n\nRounds (legacy/src/TAX.cbl:2), totals (legacy/src/TAX.cbl:5), rate legacy/src/TAX.cbl:3.\n', 1))
        write(os.path.join(inputs, 'scratch', 'billing', 'understand', 'reads', 'tax', 'calc.json'),
              {'agent': 'legacy-analyst@1.4.0', 'complete': False, 'unrecorded': {'shell': 2}, 'files': {'legacy/src/TAX.cbl': [[1, 2], [4, 4]]}})
        result = run(*args, '--src', src)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('tax/calc: citation legacy/src/TAX.cbl:5 in spec.md: its job was not shown these lines', result.stdout)
        front, body = docmd.split_front_matter(docmd.read_text(unit_file(self.out, 'tax/calc', 'understanding.md')))
        self.assertEqual((front['readRecord'], front['sourceLines'], front['sourceLinesShown'], front['citationsUnshown']), ('partial', 5, 3, 1))
        section = dict(docmd.sections(body, 2))['Citations the specification job was not shown']
        self.assertEqual(docmd.records_in(section), [{'citation': '`legacy/src/TAX.cbl:5`'}])
        self.assertIn('The job also used shell (2)', section)
        # Without --src nothing is checked and the record is as before.
        self.assertEqual(run(*args).returncode, 0)
        front, body = docmd.split_front_matter(docmd.read_text(unit_file(self.out, 'tax/calc', 'understanding.md')))
        self.assertNotIn('citations', front)
        self.assertNotIn('Citations that do not resolve', body)

    def test_the_unit_card_names_each_legacy_repository_its_files_come_from(self):
        # Two legacy repositories are mounted side by side: files are cited `<repository id>/<path>`.
        two = {**CATALOG, 'items': [
            item('invoicing/entry', ['legacy/src/INV01.cbl'], ['INV01'], entryPoints=['INV01']),
            item('tax/calc', ['legacy/src/TAX.cbl', 'legacy-data/schema/TAX.sql'], ['TAX']),
        ]}
        docs = os.path.join(self.root, 'docs-two')
        for path, text in cc.render_catalog('billing', two, cc.item_graph(two['items'], TOPOLOGY)).items():
            write(os.path.join(docs, *path.split('/')), text)
        catalog = os.path.join(docs, *cc.paths.assessment_catalog_dir('billing').split('/'))
        spec = 'legacy@' + 'a' * 40 + ',legacy-data@' + 'b' * 40
        result = run('finish_items.py', 'billing', '--catalog', catalog, '--items', 'tax/calc', '--inputs', self.finish_inputs(), '--out', self.out, '--sources', spec, '--run', 'run-1')
        self.assertEqual(result.returncode, 0, result.stderr)
        card = docmd.read_text(card_file(self.out, 'tax/calc'))
        self.assertIn('{repo: "legacy", paths: ["src/TAX.cbl"]}', card)
        self.assertIn('{repo: "legacy-data", paths: ["schema/TAX.sql"]}', card)
        record = docmd.split_front_matter(docmd.read_text(unit_file(self.out, 'tax/calc', 'understanding.md')))[0]
        self.assertEqual(record['sources'], ['legacy@' + 'a' * 40, 'legacy-data@' + 'b' * 40])
        for bad in ('legacy', 'legacy@nothex', 'legacy@' + 'a' * 40 + ',legacy@' + 'b' * 40):
            self.assertNotEqual(run('finish_items.py', 'billing', '--catalog', catalog, '--items', 'tax/calc', '--inputs', self.finish_inputs(), '--out', self.out, '--sources', bad).returncode, 0, bad)

    def test_a_citation_that_drops_the_repository_or_keeps_the_zone_folder_still_finds_its_item(self):
        # Agents see `as-is/<repository id>/<path>` and may cite `<path>`; a path that names exactly one file resolves.
        items = [item('web/orders', ['web/src/Order.cbl', 'web/src/Shared.cbl'], ['O']), item('db/schema', ['db/schema/T.sql', 'db/src/Shared.cbl'], ['T'])]
        owner = cc.owner_of(items)
        self.assertEqual(owner.item_of('web/src/Order.cbl'), 'web/orders')
        self.assertEqual(owner.item_of('as-is/web/src/Order.cbl'), 'web/orders')
        self.assertEqual(owner.item_of('src/Order.cbl'), 'web/orders')
        self.assertEqual(owner.item_of('schema/T.sql'), 'db/schema')
        # The same path in two repositories is ambiguous, a path in no item is nothing.
        self.assertIsNone(owner.item_of('src/Shared.cbl'))
        self.assertIsNone(owner.item_of('src/Missing.cbl'))
        self.assertIsNone(owner.item_of(''))
        self.assertIsNone(owner.item_of(None))
        self.assertEqual(owner.path_of('schema/T.sql'), 'db/schema/T.sql')

    def test_split_rules_and_findings_place_citations_without_the_repository(self):
        two = {**CATALOG, 'items': [item('tax/calc', ['legacy/src/TAX.cbl', 'legacy/src/TAXLIB.cbl'], ['TAX']), item('invoicing/entry', ['legacy-data/src/INV01.cbl'], ['INV01'])]}
        docs = os.path.join(self.root, 'docs-cited')
        for path, text in cc.render_catalog('billing', two, cc.item_graph(two['items'], TOPOLOGY)).items():
            write(os.path.join(docs, *path.split('/')), text)
        catalog = os.path.join(docs, *cc.paths.assessment_catalog_dir('billing').split('/'))
        rules = os.path.join(self.root, 'rules-cited.json')
        write(rules, {'confirmedRules': [
            {'name': 'Tax rounding', 'category': 'Calculation', 'priority': 'P0', 'source': 'legacy/src/TAXLIB.cbl:12'},
            {'name': 'Amount positive', 'category': 'Validation', 'priority': 'P1', 'source': 'src/TAX.cbl:3'},
            {'name': 'Entry date', 'category': 'Validation', 'priority': 'P1', 'source': 'as-is/legacy-data/src/INV01.cbl:40'},
        ], 'dataObjects': []})
        out = os.path.join(self.root, 'out-cited')
        result = run('split_rules.py', 'billing', '--rules', rules, '--catalog', catalog, '--items', 'tax/calc,invoicing/entry', '--out', out, '--date', '2026-10-22', '--sources', 'legacy@' + 'a' * 40 + ',legacy-data@' + 'b' * 40)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('3 rule(s) split over 2 item(s); 0 left out', result.stdout)
        tax = rr.unit_rule_rows(docmd.read_text(unit_file(out, 'tax/calc', 'rules.md')))
        self.assertEqual(sorted(row['name'] for row in tax), ['Amount positive', 'Tax rounding'])

    def test_rebuild_aggregates_lists_the_gaps_of_the_understood_units_blocking_first(self):
        docs = os.path.join(self.root, 'docs')
        inputs = self.finish_inputs()
        self.assertEqual(run('finish_items.py', 'billing', '--catalog', self.catalog, '--items', 'tax/calc', '--inputs', inputs, '--out', docs, '--sources', 'legacy@' + 'a' * 40, '--run', 'run-1').returncode, 0)
        write(unit_file(docs, 'tax/calc', 'spec.md'), docmd.read_text(os.path.join(os.path.dirname(__file__), 'fixtures', 'gaps', 'spec.md')))
        result = run('rebuild_aggregates.py', 'billing', '--docs', docs, '--out', self.out)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('3 gap(s)', result.stdout)
        front, body = docmd.split_front_matter(docmd.read_text(os.path.join(self.out, *APP, '_generated', 'GAPS.md')))
        self.assertEqual({key: front[key] for key in ('gaps', 'units', 'blocking', 'risk', 'note', 'missingSource', 'unresolved', 'ambiguous', 'unverified')},
                         {'gaps': 3, 'units': 1, 'blocking': 1, 'risk': 1, 'note': 1, 'missingSource': 1, 'unresolved': 0, 'ambiguous': 1, 'unverified': 1})
        rows = docmd.records_in(body)
        self.assertEqual([(row['item'], row['id'], row['impact']) for row in rows], [('tax/calc', 'GAP-tax.calc-01', 'blocking'), ('tax/calc', 'GAP-tax.calc-02', 'risk'), ('tax/calc', 'GAP-tax.calc-03', 'note')])
        # Who can settle each gap (ADR-0087): the row's own value, else its kind's default; open gaps counted per settler.
        self.assertEqual([(row['settled by'], row['probe']) for row in rows],
                         [('source-owner', 'Ask the owners of the copybook library for TAXTAB.'), ('expert', 'Ask the tax team which rate applies.'), ('check', '')])
        self.assertEqual({key: front[key] for key in ('openForSourceOwner', 'openForExpert', 'openForData', 'openForCheck')},
                         {'openForSourceOwner': 1, 'openForExpert': 1, 'openForData': 0, 'openForCheck': 1})

    def test_rebuild_aggregates_merges_the_units_into_markdown_read_models(self):
        docs = os.path.join(self.root, 'docs')
        inputs = self.finish_inputs()
        self.assertEqual(run('finish_items.py', 'billing', '--catalog', self.catalog, '--items', 'tax/calc', '--inputs', inputs, '--out', docs, '--sources', 'legacy@' + 'a' * 40, '--run', 'run-1').returncode, 0)
        for name in ('spec.md', 'rules.md', 'findings.md'):
            write(unit_file(docs, 'tax/calc', name), docmd.read_text(unit_file(inputs, 'tax/calc', name)))
        result = run('rebuild_aggregates.py', 'billing', '--docs', docs, '--out', self.out)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('1 of 2 item(s) understood', result.stdout)
        gen = os.path.join(self.out, *APP, '_generated')
        self.assertEqual(sorted(os.listdir(gen)), ['BUSINESS_RULES.md', 'DATA_ACCESS.md', 'DATA_OBJECTS.md', 'GAPS.md', 'README.md', 'SECURITY_FINDINGS.md', 'traceability.md'])
        business = docmd.read_text(os.path.join(gen, 'BUSINESS_RULES.md'))
        self.assertIn('| RULE-tax.calc-01 | tax/calc | Round | Calculation | P0 | High | 1 | confirmed | `src/TAX.cbl:3` | [RULE-tax.calc-01](../01-legacy/tax/calc/rules/RULE-tax.calc-01.md) |', business)
        self.assertEqual([line for line in business.splitlines() if line.startswith('### ')], [])
        self.assertEqual(docmd.split_front_matter(business)[0]['rules'], 1)
        self.assertIn('| SEC-tax.calc-01 | CWE-89 | High |', docmd.read_text(os.path.join(gen, 'SECURITY_FINDINGS.md')))
        front, body = docmd.split_front_matter(docmd.read_text(os.path.join(gen, 'traceability.md')))
        self.assertEqual((front['items'], front['units'], front['rulesCovered'], front['findingsMapped'], front['openQuestions'], front['stale']), (2, 1, 1, 1, 2, 0))
        self.assertIn('`tax/calc`', body)
        # The read/write matrix comes from the catalog's links, understood or not (ADR-0060).
        front, body = docmd.split_front_matter(docmd.read_text(os.path.join(gen, 'DATA_ACCESS.md')))
        self.assertEqual((front['stores'], front['items'], front['neverWritten']), (1, 1, 0))
        sections = dict(docmd.sections(body, 2))
        self.assertEqual(docmd.records_in(sections['By data store']), [{'data store': 'ds:INVOICES', 'written by': 'invoicing/entry (program)', 'read by': '-'}])
        self.assertEqual(docmd.records_in(sections['By item']), [{'item': 'invoicing/entry', 'kind': 'program', 'reads': '-', 'writes': 'ds:INVOICES'}])


if __name__ == '__main__':
    unittest.main()
