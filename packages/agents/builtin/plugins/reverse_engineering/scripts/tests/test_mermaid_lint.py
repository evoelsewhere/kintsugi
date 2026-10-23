import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.dirname(HERE)
BUILTIN = os.path.dirname(SCRIPTS)
LINT = os.path.join(SCRIPTS, 'mermaid_lint.py')

spec = importlib.util.spec_from_file_location('mermaid_lint', LINT)
mermaid_lint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mermaid_lint)


def rules(text, path='x.mmd'):
    return sorted({problem.rule for problem in mermaid_lint.lint_text(path, text)})


def lines_of(text, rule, path='x.mmd'):
    return [problem.line for problem in mermaid_lint.lint_text(path, text) if problem.rule == rule]


ARCHITECTURE = '''%% domains of the billing estate
flowchart TB
    subgraph dom_billing["Billing"]
        job_nightly["NIGHTLY (JCL)"]:::batch
        svc_invoice["INVOICE"]:::service
    end
    db_invoices[("INVOICES")]:::store
    ext_bank["Bank gateway"]:::external
    job_nightly --> svc_invoice
    svc_invoice -->|W| db_invoices
    db_invoices -.->|"R #59; nightly"| svc_invoice
    svc_invoice & job_nightly --> ext_bank
    classDef service fill:#eef7ee,stroke:#3c7a3c
    classDef batch fill:#fff4e0
    classDef store fill:#f3eefb
    classDef external fill:#f2f2f2,stroke-dasharray:4 3
'''

SEQUENCE = '''sequenceDiagram
    autonumber
    actor usr_clerk as Clerk
    participant svc_ordupd as ORDUPD
    participant db_orders as ORDERS
    usr_clerk->>+svc_ordupd: Enter order
    alt credit limit exceeded
        svc_ordupd-->>usr_clerk: Reject (RULE-014)
    else within limit
        loop each line
            svc_ordupd->>db_orders: Insert line #59; commit
        end
        svc_ordupd-->>-usr_clerk: Order number
    end
    Note over svc_ordupd,db_orders: one transaction
'''

ER = '''erDiagram
    CUSTOMER ||--o{ ORDER_HDR : places
    ORDER_HDR ||--|{ ORDER_LINE : "contains lines"
    CUSTOMER |o..o| LOYALTY : "may hold"
    CUSTOMER {
        int cust_id PK
        varchar email UK "unique"
    }
    ORDER_HDR {
        int order_id PK
        int cust_id FK "CUSTOMER.cust_id"
    }
'''

STATE = '''stateDiagram-v2
    [*] --> st_draft
    st_draft --> st_submitted : submit
    state st_open {
        [*] --> st_new
    }
    st_submitted --> [*]
    st_draft : Draft (status D)
'''

C4 = '''C4Container
    title Target
    Person(per_clerk, "Clerk")
    System_Boundary(bnd_orders, "Orders") {
        Container(ctr_api, "Order service", "Java", "Rules")
        ContainerDb(ctr_db, "Orders DB", "PostgreSQL", "Orders")
    }
    Rel(per_clerk, ctr_api, "Uses", "HTTPS")
    Rel(ctr_api, ctr_db, "Reads and writes", "JDBC")
'''


class CleanDiagrams(unittest.TestCase):
    def test_every_kintsugi_type_passes(self):
        for name, text in [('architecture', ARCHITECTURE), ('sequence', SEQUENCE), ('er', ER), ('state', STATE), ('c4', C4)]:
            with self.subTest(name):
                self.assertEqual(mermaid_lint.lint_text('x.mmd', text), [])

    def test_markdown_fences_are_extracted_with_file_lines(self):
        text = '# Doc\n\n```mermaid\n' + SEQUENCE + '```\n\nText.\n\n```mermaid\nflowchart LR\n    svc_a["A"] --> end\n```\n'
        problems = mermaid_lint.lint_text('doc.md', text)
        self.assertEqual([(problem.line, problem.rule) for problem in problems], [(len(SEQUENCE.splitlines()) + 10, 'reserved-id')])

    def test_other_fences_and_plain_text_are_ignored(self):
        self.assertEqual(mermaid_lint.lint_text('doc.md', '```python\nend --> x\n```\nflowchart TD\n'), [])


class Structure(unittest.TestCase):
    def test_header(self):
        self.assertEqual(rules('flowhcart TD\n    a_1["x"]\n'), ['unknown-header'])
        self.assertEqual(rules('flowchart XY\n'), ['unknown-header'])
        self.assertEqual(rules('graph TD\n    svc_a["A"] --> svc_b["B"]\n'), ['discouraged-type'])
        self.assertEqual(rules('gantt\n    title Plan\n'), ['discouraged-type'])
        self.assertEqual(rules('architecture-beta\n'), ['discouraged-type'])
        self.assertEqual(rules(''), ['empty-diagram'])

    def test_no_theming_or_front_matter(self):
        self.assertIn('no-theming', rules('---\nconfig:\n  theme: dark\n---\nflowchart TD\n'))
        self.assertIn('no-theming', rules("%%{init: {'theme': 'dark'}}%%\nflowchart TD\n"))

    def test_comments(self):
        self.assertEqual(rules('flowchart TD\n    svc_a["A"] --> svc_b["B"] %% trailing\n'), ['inline-comment'])
        self.assertEqual(rules('flowchart TD\n% one percent\n'), ['bad-comment'])
        self.assertEqual(rules('flowchart TD\n    svc_a["100%% sure"]\n'), [])

    def test_colour_functions_in_style_lines_are_refused(self):
        for line in ('classDef ui fill:rgba(37,99,235,0.12),stroke:#2563eb', 'classDef ui fill:hsl(10,50%,50%)', 'style A fill:rgb(1,2,3)', 'linkStyle 0 stroke:rgba(0,0,0,.5)'):
            self.assertIn('color-function', rules('flowchart LR\n    A --> B\n    ' + line + '\n'), line)
        self.assertNotIn('color-function', rules('flowchart LR\n    A:::ui --> B\n    classDef ui fill:#2563eb,fill-opacity:0.12,stroke:#2563eb\n'))

    def test_unbalanced_subgraphs(self):
        self.assertEqual(lines_of('flowchart TD\n    subgraph dom_a["A"]\n    svc_a["A"]\n', 'unbalanced-block'), [2])
        self.assertEqual(lines_of('flowchart TD\n    svc_a["A"]\n    end\n', 'unbalanced-block'), [3])

    def test_unbalanced_sequence_blocks(self):
        text = 'sequenceDiagram\n    svc_a->>svc_b: go\n    alt yes\n        svc_b-->>svc_a: ok\n    opt maybe\n        svc_b-->>svc_a: ok\n    end\n'
        self.assertEqual(lines_of(text, 'unbalanced-block'), [3])
        self.assertEqual(rules('sequenceDiagram\n    else no\n'), ['unbalanced-block'])
        self.assertEqual(rules('sequenceDiagram\n    end\n'), ['unbalanced-block'])

    def test_unbalanced_braces(self):
        self.assertIn('unbalanced-block', rules('stateDiagram-v2\n    state st_a {\n        [*] --> st_b\n'))
        self.assertIn('unbalanced-block', rules('erDiagram\n    CUSTOMER {\n        int id PK\n'))
        self.assertIn('unbalanced-block', rules('C4Container\n    System_Boundary(bnd_a, "A") {\n'))


class Ids(unittest.TestCase):
    def test_reserved_words(self):
        for word in ['end', 'default', 'style', 'class', 'classDef', 'click', 'subgraph', 'graph', 'flowchart', 'End']:
            with self.subTest(word):
                self.assertIn('reserved-id', rules('flowchart TD\n    svc_a["A"] --> ' + word + '\n'))

    def test_invalid_and_ox_ids(self):
        self.assertIn('invalid-id', rules('flowchart TD\n    my-node["A"]\n'))
        self.assertIn('invalid-id', rules('flowchart TD\n    1st["A"]\n'))
        self.assertIn('invalid-id', rules('flowchart TD\n    a.b["A"]\n'))
        self.assertEqual(rules('flowchart TD\n    svc_a["A"] --- orders\n'), ['ox-start'])
        self.assertEqual(rules('flowchart TD\n    xref["A"]\n'), ['ox-start'])
        self.assertIn('reserved-id', rules('sequenceDiagram\n    participant end\n'))
        self.assertIn('invalid-id', rules('sequenceDiagram\n    participant my-svc\n'))

    def test_subgraph_needs_an_id_and_quoted_title(self):
        self.assertIn('subgraph-id', rules('flowchart TD\n    subgraph "Billing"\n    end\n'))
        self.assertIn('unquoted-label', rules('flowchart TD\n    subgraph dom_b [Billing]\n    end\n'))
        self.assertIn('unquoted-label', rules('flowchart TD\n    subgraph Billing domain\n    end\n'))


class Labels(unittest.TestCase):
    def test_labels_are_quoted(self):
        self.assertEqual(rules('flowchart TD\n    svc_a[Start] --> svc_b(Next)\n'), ['unquoted-label'])
        self.assertEqual(rules('flowchart TD\n    svc_a["A"] -->|reads (nightly)| svc_b["B"]\n'), ['unquoted-label'])
        self.assertEqual(rules('flowchart TD\n    svc_a["A"] -->|W| svc_b["B"]\n'), [])

    def test_quotes_and_shapes(self):
        self.assertEqual(rules('flowchart TD\n    svc_a["open] --> svc_b\n'), ['unbalanced-quote'])
        self.assertEqual(rules('flowchart TD\n    svc_a["A" --> svc_b\n'), ['unclosed-shape'])
        self.assertEqual(rules('flowchart TD\n    svc_a["say #quot;hi#quot;"]\n'), [])

    def test_raw_html_and_inline_edge_text(self):
        self.assertEqual(rules('flowchart TD\n    svc_a["a <b>bold</b>"]\n'), ['raw-html'])
        self.assertEqual(rules('flowchart TD\n    svc_a["line<br/>two"]\n'), [])
        self.assertEqual(rules('flowchart TD\n    svc_a["A"] -- calls --> svc_b["B"]\n'), ['inline-edge-label'])

    def test_sequence_semicolons(self):
        self.assertEqual(rules('sequenceDiagram\n    svc_a->>svc_b: one; two\n'), ['unescaped-semicolon'])
        self.assertEqual(rules('sequenceDiagram\n    Note over svc_a: x; y\n'), ['unescaped-semicolon'])
        self.assertEqual(rules('sequenceDiagram\n    svc_a->>svc_b: one #59; two\n'), [])

    def test_no_interaction(self):
        self.assertEqual(rules('flowchart TD\n    svc_a["A"]\n    click svc_a "https://example.invalid"\n'), ['no-click'])
        self.assertEqual(rules('flowchart TD\n    svc_a["A"]\n    href svc_a "x"\n'), ['no-click'])


class References(unittest.TestCase):
    def test_classes_are_defined(self):
        self.assertEqual(rules('flowchart TD\n    svc_a["A"]:::service\n'), ['undefined-class'])
        self.assertEqual(rules('flowchart TD\n    svc_a["A"]\n    class svc_a entry\n'), ['undefined-class'])
        self.assertEqual(rules('flowchart TD\n    svc_a["A"]:::entry\n    classDef entry stroke-width:3px\n'), [])

    def test_er_cardinality(self):
        self.assertEqual(rules('erDiagram\n    A }o--x B : bad\n'), ['er-cardinality'])
        self.assertEqual(rules('erDiagram\n    A ||--o{ B\n'), ['er-cardinality'])
        self.assertEqual(rules('erDiagram\n    A ||--o{ B : has many\n'), ['unquoted-label'])
        self.assertEqual(rules('erDiagram\n    A {\n        int id PRIMARY\n    }\n'), ['er-attribute'])

    def test_c4_references_and_labels(self):
        text = 'C4Container\n    Container(ctr_a, "A", "Java")\n    Rel(ctr_a, ctr_b, "Calls")\n    Rel(ctr_a, ctr_a, Calls)\n'
        self.assertEqual(rules(text), ['undefined-ref', 'unquoted-label'])
        self.assertEqual(rules('C4Container\n    Banana(ctr_a, "A")\n'), ['unknown-statement'])


class Limits(unittest.TestCase):
    def test_edge_and_node_limits(self):
        edges = ''.join('    svc_a --> svc_n{}\n'.format(index) for index in range(41))
        self.assertEqual(rules('flowchart LR\n' + edges), ['too-many-edges', 'too-many-nodes'])
        fan = '    svc_a & svc_b --> ' + ' & '.join('svc_t{}'.format(index) for index in range(21)) + '\n'
        self.assertEqual(rules('flowchart LR\n' + fan), ['too-many-edges'])
        ok = ''.join('    svc_a --> svc_n{}\n'.format(index) for index in range(24))
        self.assertEqual(rules('flowchart LR\n' + ok), [])

    def test_participant_limit(self):
        messages = ''.join('    svc_a->>svc_p{}: call\n'.format(index) for index in range(12))
        self.assertEqual(rules('sequenceDiagram\n' + messages), ['too-many-participants'])


class Cli(unittest.TestCase):
    def run_lint(self, *args):
        # Isolated Python ignores PYTHONUTF8; keep child output and capture decoding explicit.
        return subprocess.run([sys.executable, '-I', '-X', 'utf8', LINT, *args], capture_output=True, text=True, encoding='utf-8')

    def test_exit_codes_and_messages(self):
        with tempfile.TemporaryDirectory() as root:
            good = os.path.join(root, 'ARCHITECTURE.mmd')
            bad = os.path.join(root, 'notes', 'spec.md')
            os.makedirs(os.path.dirname(bad))
            with open(good, 'w', encoding='utf-8') as handle:
                handle.write(ARCHITECTURE)
            with open(bad, 'w', encoding='utf-8') as handle:
                handle.write('# Spec\n\n```mermaid\nflowchart TD\n    svc_a["A"] --> end\n```\n')
            self.assertEqual(self.run_lint('--no-render', good).returncode, 0)
            result = self.run_lint('--no-render', root)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout.strip(), '{}:5: reserved-id: node id `end` is a Mermaid keyword; prefix it (e.g. `n_end`)'.format(bad))
            unclosed = os.path.join(root, 'open.md')
            with open(unclosed, 'w', encoding='utf-8') as handle:
                handle.write('```mermaid\nflowchart TD\n')
            self.assertIn('{}:1: unclosed-fence'.format(unclosed), self.run_lint('--no-render', unclosed).stdout)
        self.assertEqual(self.run_lint().returncode, 2)

    def test_lint_reads_the_shipped_skill_without_failing(self):
        # The mermaid-diagrams skill is third-party material shipped as published (ADR-0036): its
        # examples do not follow Kintsugi's id and label rules, so they are read, not required clean.
        result = self.run_lint('--no-render', os.path.join(BUILTIN, 'skills'))
        self.assertIn(result.returncode, (0, 1))


if __name__ == '__main__':
    unittest.main()
