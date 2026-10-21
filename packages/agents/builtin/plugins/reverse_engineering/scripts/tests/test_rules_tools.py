import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.dirname(HERE)


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
            self.assertIn('### RULE-001: Late fee', text)
            self.assertIn('### RULE-002: Bad', text)
            headings = [line for line in text.splitlines() if line.startswith('### ')]
            self.assertEqual(len(headings), 2, headings)
            self.assertNotIn('\n# injected heading', text)
            ids = [int(n) for n in re.findall(r'^### RULE-(\d+): ', text, re.M)]
            self.assertEqual(ids, list(range(1, len(ids) + 1)), 'rule numbers read in sequence down the document')
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
            cites = re.findall(r'^\*\*Source:\*\* `([^`]*)`', text, re.M)
            self.assertEqual(sorted(cites), sorted(['wwwroot/a.pl:100-120', 'lib/x.pm:966', 'no citation here', 'c.cbl:7']))
            self.assertIn('**Also cited:** (aggregation); family table at lib/b.pm:31-40', text)
            self.assertEqual(text.count('**Also cited:**'), 2)

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
            self.assertIn('**Also cited:** b.c:3-4', text)
            self.assertNotIn('\n# fake heading', text)

    def test_unreadable_result_is_an_error(self):
        with tempfile.TemporaryDirectory() as ws:
            self.assertEqual(run('render_rules.py', 's', '--assessment', os.path.join(ws, 'assessment'), '--out', os.path.join(ws, 'out')).returncode, 1)
            self.assertEqual(run('render_rules.py', 's', '--out', os.path.join(ws, 'out')).returncode, 2)


if __name__ == '__main__':
    unittest.main()
