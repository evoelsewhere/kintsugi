import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, '..', 'style_architecture.py')
LINT = os.path.join(HERE, '..', 'mermaid_lint.py')

spec = importlib.util.spec_from_file_location('style_architecture', SCRIPT)
sa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sa)

# What an agent drew without any styling: groups of controller and service nodes, a data store group and an external group.
PLAIN = '''flowchart TB
    subgraph AUTH["1 · Auth"]
        AUTH_UI["AuthController\\nLogin · Refresh"]
        AUTH_SVC["AccountService\\nTokenService"]
        AUTH_UI --> AUTH_SVC
    end
    subgraph JOBS["2 · Reports"]
        NIGHTLY["Nightly batch job"]
    end
    subgraph STORE["Data Stores"]
        PG[("PostgreSQL\\n12 schemas")]
        CACHE["Redis cache"]
    end
    subgraph EXT["External Services"]
        MAIL["Mailgun"]
    end
    AUTH_SVC --> PG
    AUTH_SVC --> CACHE
    NIGHTLY --> PG
    AUTH_SVC --> MAIL
'''


class StyleTests(unittest.TestCase):
    def test_an_unstyled_flowchart_gets_the_standard_classes_by_what_each_node_is(self):
        out = sa.style(PLAIN)
        for name in ('ui', 'service', 'batch', 'store', 'external'):
            self.assertIn(f'classDef {name} ', out)
        self.assertIn('class AUTH_UI ui', out)
        self.assertIn('class AUTH_SVC service', out)
        self.assertIn('class NIGHTLY batch', out)
        self.assertIn('class PG,CACHE store', out)
        self.assertIn('class MAIL external', out)

    def test_nothing_the_agent_drew_is_removed_and_labels_get_real_line_breaks(self):
        out = sa.style(PLAIN)
        self.assertTrue(out.startswith('flowchart TB\n'))
        for line in PLAIN.splitlines():
            self.assertIn(line.replace('\\n', '<br/>'), out.splitlines())
        self.assertNotIn('\\n', out)
        self.assertIn('AUTH_UI["AuthController<br/>Login · Refresh"]', out)

    def test_a_diagram_that_styles_itself_is_left_alone(self):
        styled = PLAIN + '    classDef mine fill:#fff\n    class AUTH_UI mine\n'
        self.assertEqual(sa.style(styled).replace('<br/>', '\\n'), styled.rstrip('\n') + '\n')
        inline = 'flowchart LR\n    A["a"]:::entry --> B["b"]\n    classDef entry stroke-width:3px\n'
        self.assertNotIn('classDef service', sa.style(inline))

    def test_other_diagram_types_are_copied_unchanged(self):
        sequence = 'sequenceDiagram\n    A->>B: hi\n'
        self.assertEqual(sa.style(sequence), sequence)

    def test_a_markdown_fence_around_the_diagram_is_dropped(self):
        out = sa.style('```mermaid\nflowchart LR\n    A["Order controller"] --> B["Order service"]\n```\n')
        self.assertTrue(out.startswith('flowchart LR\n'))
        self.assertNotIn('```', out)
        self.assertIn('class A ui', out)

    def test_the_styled_diagram_passes_the_lint_without_undefined_class_problems(self):
        with tempfile.TemporaryDirectory() as ws:
            src = os.path.join(ws, 'in.mmd')
            dst = os.path.join(ws, 'out.mmd')
            with open(src, 'w', encoding='utf-8') as handle:
                handle.write(PLAIN)
            done = subprocess.run([sys.executable, SCRIPT, '--input', src, '--out', dst], capture_output=True, text=True, timeout=30)
            self.assertEqual(done.returncode, 0, done.stderr)
            lint = subprocess.run([sys.executable, LINT, '--no-render', dst], capture_output=True, text=True, timeout=30)
            self.assertNotIn('undefined-class', lint.stdout)
            self.assertNotIn('unparsed-line', lint.stdout)

    def test_a_missing_input_is_a_usage_error_without_a_traceback(self):
        done = subprocess.run([sys.executable, SCRIPT, '--input', os.path.join(HERE, 'nope.mmd'), '--out', os.path.join(HERE, 'x.mmd')], capture_output=True, text=True, timeout=30)
        self.assertEqual(done.returncode, 2)
        self.assertNotIn('Traceback', done.stderr)


if __name__ == '__main__':
    unittest.main()
