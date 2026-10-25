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


def run(script, *args):
    return subprocess.run([sys.executable, os.path.join(SCRIPTS, script), *args], capture_output=True, text=True)


def load(path):
    with open(path, encoding='utf-8') as handle:
        return json.load(handle)


def write(root, rel, text='x\n'):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as handle:
        handle.write(text)


class RenderTests(unittest.TestCase):
    def test_rules_render_with_rule_headings_and_hostile_text_stays_inert(self):
        result = {'confirmedRules': [
            {'name': 'Late fee', 'category': 'Calculation', 'priority': 'P0', 'source': 'a.cbl:10-20', 'plainEnglish': 'A fee.',
             'given': 'a late payment', 'when': 'month end', 'then': 'fee 5%', 'confidence': 'High'},
            {'name': 'Bad `name` | pipe\n# Heading', 'category': 'Validation', 'priority': 'P1', 'source': 'b.cbl:1-2', 'plainEnglish': 'x',
             'given': 'g\n# injected heading\n```', 'when': 'w', 'then': 't', 'confidence': 'Low', 'smeQuestion': 'Is it 5 or 6?'}],
            'dataObjects': [{'name': 'Account', 'source': 'a.cbl:1', 'fields': [{'name': 'id', 'type': 'int'}], 'consumedBy': ['Late fee']}],
            'injectionFlags': ['a.cbl:5'], 'rejectedRules': [{}], 'unverifiedRules': [], 'rerunModules': [],
            'stats': {'skippedModules': ['M9']}}
        with tempfile.TemporaryDirectory() as ws:
            write(ws, 'assessment/rules_result.json', json.dumps(result))
            done = run('render_rules.py', 's', '--assessment', os.path.join(ws, 'assessment'), '--out', os.path.join(ws, 'out'))
            self.assertEqual(done.returncode, 0, done.stderr)
            text = open(os.path.join(ws, 'out/BUSINESS_RULES.md'), encoding='utf-8').read()
            # The index lists the rules and links their files; it holds no rule cards.
            self.assertEqual([line for line in text.splitlines() if line.startswith('### ')], [])
            rows = [line for line in text.splitlines() if re.match(r'^\| RULE-APP00-\d+ \|', line)]
            self.assertEqual(len(rows), 2, rows)
            self.assertIn('| RULE-APP00-0001 | Late fee | Calculation | P0 | High | 1 | confirmed | `a.cbl:10-20` | [RULE-APP00-0001](rules/RULE-APP00-0001.md) |', text)
            ids = [int(n) for n in re.findall(r'^\| RULE-APP00-(\d+) \|', text, re.M)]
            self.assertEqual(ids, list(range(1, len(ids) + 1)), 'rule numbers read in sequence down the index')
            first = open(os.path.join(ws, 'out/rules/RULE-APP00-0001.md'), encoding='utf-8').read()
            self.assertIn('# RULE-APP00-0001: Late fee', first)
            self.assertIn('Then  fee 5%', first)
            self.assertIn('## Version history', first)
            hostile = open(os.path.join(ws, 'out/rules/RULE-APP00-0002.md'), encoding='utf-8').read()
            self.assertEqual([line for line in hostile.splitlines() if line.startswith('# ')], ["# RULE-APP00-0002: Bad 'name' / pipe # Heading"])
            self.assertNotIn('\n# injected heading', hostile)
            self.assertIn('status: "needs-sme"', hostile)
            self.assertIn('Is it 5 or 6?', hostile)
            self.assertIn('Rules requiring SME confirmation', text)
            self.assertIn('Is it 5 or 6?', text)
            self.assertIn('Coverage gaps', text)
            self.assertIn('Instruction-shaped content', text)
            dto = open(os.path.join(ws, 'out/DATA_OBJECTS.md'), encoding='utf-8').read()
            self.assertIn('## Account', dto)

    def test_the_gap_list_of_the_workflow_renders_and_splits(self):
        # extract-rules returns rerunModules as re-passable {name, domain?, files, loc?} entries.
        result = {'confirmedRules': [], 'rerunModules': [{'name': 'auth-identity.auth', 'domain': 'auth', 'files': ['a.java', 'b.java'], 'loc': 900}, 'plain-name'],
                  'stats': {'failedModules': ['auth-identity.auth']}}
        with tempfile.TemporaryDirectory() as ws:
            write(ws, 'assessment/rules_result.json', json.dumps(result))
            done = run('render_rules.py', 's', '--assessment', os.path.join(ws, 'assessment'), '--out', os.path.join(ws, 'out'))
            self.assertEqual(done.returncode, 0, done.stderr)
            text = open(os.path.join(ws, 'out/BUSINESS_RULES.md'), encoding='utf-8').read()
            self.assertIn('A follow-up run for the 2 affected shard(s) covers them.', text)

    def test_a_malformed_gap_entry_is_still_refused(self):
        for bad in ([1], [{'files': ['a.java']}], [{'name': 'm', 'files': 'a.java'}], [{'name': 'm', 'files': [3]}]):
            with tempfile.TemporaryDirectory() as ws:
                write(ws, 'assessment/rules_result.json', json.dumps({'confirmedRules': [], 'rerunModules': bad}))
                done = run('render_rules.py', 's', '--assessment', os.path.join(ws, 'assessment'), '--out', os.path.join(ws, 'out'))
                self.assertNotEqual(done.returncode, 0, bad)
                self.assertIn('rerunModules', done.stderr)

    def test_a_rule_keeps_one_citation_and_the_rest_moves_to_also_cited(self):
        sources = ['wwwroot/a.pl:100-120 (aggregation); family table at lib/b.pm:31-40',
                   'lib/x.pm:966,1018,1238 (order lists)', 'no citation here', 'c.cbl:7']
        result = {'confirmedRules': [
            {'name': f'R{i}', 'category': 'Policy', 'priority': 'P1', 'source': src, 'plainEnglish': 'x',
             'given': 'g', 'when': 'w', 'then': 't', 'confidence': 'High'} for i, src in enumerate(sources)]}
        with tempfile.TemporaryDirectory() as ws:
            write(ws, 'assessment/rules_result.json', json.dumps(result))
            self.assertEqual(run('render_rules.py', 's', '--assessment', os.path.join(ws, 'assessment'), '--out', os.path.join(ws, 'out')).returncode, 0)
            text = open(os.path.join(ws, 'out/BUSINESS_RULES.md'), encoding='utf-8').read()
            cites = re.findall(r'^\| RULE-APP00-\d+ \|.*\| `([^`]*)` \| \[RULE', text, re.M)
            self.assertEqual(sorted(cites), sorted(['wwwroot/a.pl:100-120', 'lib/x.pm:966', 'no citation here', 'c.cbl:7']))
            files = [open(os.path.join(ws, 'out/rules', name), encoding='utf-8').read() for name in sorted(os.listdir(os.path.join(ws, 'out/rules')))]
            self.assertEqual(len(files), 4)
            self.assertEqual(sum('| Also cited |' in body for body in files), 2)
            self.assertTrue(any('| (aggregation); family table at lib/b.pm:31-40 | Also cited |' in body for body in files))

    def test_folded_rules_are_listed_so_nothing_disappears_untraceably(self):
        result = {'confirmedRules': [{'name': 'Twiddle table', 'category': 'Calculation', 'priority': 'P0', 'source': 'a.c:1-2 ; also b.c:3-4',
                                      'plainEnglish': 'x', 'given': 'g', 'when': 'w', 'then': 't', 'confidence': 'Low'}],
                  'foldedRules': [{'name': 'Twiddle factors', 'source': 'b.c:3-4', 'into': 'Twiddle table'}, 'junk', {'name': 'X\n# fake heading', 'source': 's', 'into': 'i'}]}
        with tempfile.TemporaryDirectory() as ws:
            write(ws, 'assessment/rules_result.json', json.dumps(result))
            self.assertEqual(run('render_rules.py', 's', '--assessment', os.path.join(ws, 'assessment'), '--out', os.path.join(ws, 'out')).returncode, 0)
            text = open(os.path.join(ws, 'out/BUSINESS_RULES.md'), encoding='utf-8').read()
            self.assertIn('## Rules folded into another', text)
            self.assertIn('- Twiddle factors (b.c:3-4) into Twiddle table', text)
            self.assertIn('| `b.c:3-4` | Also cited |', open(os.path.join(ws, 'out/rules/RULE-APP00-0001.md'), encoding='utf-8').read())
            self.assertNotIn('\n# fake heading', text)

    def test_retirement_and_reactivation_keep_ledger_file_and_catalog_history_consistent(self):
        from pathlib import Path
        import docmd
        rule = {'name': 'Round', 'category': 'Calculation', 'priority': 'P1', 'source': 'a.cbl:10', 'confidence': 'High'}
        with tempfile.TemporaryDirectory() as ws:
            root = Path(ws)
            args = ('s', '--assessment', str(root / 'assessment'), '--out', str(root / 'out'))
            def render(rules):
                write(ws, 'assessment/rules_result.json', json.dumps({'confirmedRules': rules}))
                result = run('render_rules.py', *args)
                self.assertEqual(result.returncode, 0, result.stderr)
            def front(path):
                return docmd.split_front_matter((root / 'out' / path).read_text())[0]
            render([rule])
            render([])
            self.assertEqual(front('rules/RULE-APP00-0001.md')['status'], 'retired')
            self.assertEqual(front('rules/RULE-APP00-0001.md')['version'], 2)
            self.assertEqual(front('BUSINESS_RULES.md')['catalogVersion'], 2)
            retired = (root / 'out/rules/RULE-APP00-0001.md').read_text()
            render([])
            self.assertEqual((root / 'out/rules/RULE-APP00-0001.md').read_text(), retired)
            self.assertEqual(front('BUSINESS_RULES.md')['catalogVersion'], 2)
            render([rule])
            self.assertEqual(front('rules/RULE-APP00-0001.md')['status'], 'confirmed')
            self.assertEqual(front('rules/RULE-APP00-0001.md')['version'], 3)
            self.assertEqual(front('BUSINESS_RULES.md')['catalogVersion'], 3)
            _, body = docmd.split_front_matter((root / 'out/identifiers/rules-ids.md').read_text())
            self.assertEqual([(r['id'], r['status']) for r in docmd.records_in(body)], [('RULE-APP00-0001', 'active')])

    def test_unreadable_result_is_an_error(self):
        with tempfile.TemporaryDirectory() as ws:
            self.assertEqual(run('render_rules.py', 's', '--assessment', os.path.join(ws, 'assessment'), '--out', os.path.join(ws, 'out')).returncode, 1)
            self.assertEqual(run('render_rules.py', 's', '--out', os.path.join(ws, 'out')).returncode, 2)


if __name__ == '__main__':
    unittest.main()
