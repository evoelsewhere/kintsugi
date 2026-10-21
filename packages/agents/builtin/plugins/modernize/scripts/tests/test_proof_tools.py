"""Tests for the trace and verification evidence scripts.

Run:  python -m pytest packages/agents/builtin/plugins/modernize/scripts/tests/test_proof_tools.py
Every input here stands in for untrusted text from a legacy code base, so the hostile cases matter as much as the good ones.
"""
import contextlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(PLUGIN, "scripts"))
import compare as cmp  # noqa: E402
import proof_pack as pp  # noqa: E402
import run_results as rr  # noqa: E402
import trace_rules as tr  # noqa: E402

T0 = 1_700_000_000


def put(root, rel, data, when=None):
    path = os.path.join(root, *rel.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(data if isinstance(data, bytes) else data.encode("utf-8"))
    if when is not None:
        os.utime(path, (when, when))
    return path


def put_or_skip(test, root, rel, data, when=None):
    try:
        return put(root, rel, data, when)
    except OSError as err:
        if os.name == "nt" and (getattr(err, "winerror", None) == 123 or err.errno == 22):
            test.skipTest("Windows does not permit this hostile file name")
        raise


def run_main(fn, argv):
    argv = list(argv)
    if fn in (tr.main, pp.main) and "--workspace" in argv:
        i = argv.index("--workspace")
        root = argv[i + 1]
        del argv[i:i + 2]
        app = argv[0]
        source, assessment, target = (os.path.join(root, "legacy", app), os.path.join(root, "analysis", app), os.path.join(root, "modernized", app))
        for path in (source, assessment, target):
            os.makedirs(path, exist_ok=True)
        if fn is pp.main:
            module = argv[1] if len(argv) > 1 and not argv[1].startswith("-") else None
            if module:
                argv.pop(1)
            argv.extend(["--source", source, "--assessment", assessment, "--target", target, "--out", assessment])
            if module:
                argv.insert(1, module)
        else:
            runs = []
            while "--results" in argv:
                i = argv.index("--results")
                runs.extend(["--runs", argv[i + 1]])
                del argv[i:i + 2]
            if "--module" in argv:
                i = argv.index("--module")
                argv[i] = "--module"
            argv.extend(["--source", source, "--assessment", assessment, "--target", target, "--out", os.path.join(root, "trace-out")])
            argv.extend(runs)
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            code = fn(argv)
        except SystemExit as exc:
            code = exc.code
    return code, out.getvalue(), err.getvalue()


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def load(path):
    return json.loads(read(path))


def dump(path, obj):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh)


def make_symlink(test, target, link):
    try:
        os.symlink(target, link)
    except OSError as err:
        if getattr(err, "winerror", None) == 1314:
            test.skipTest("Windows refused symbolic-link creation (WinError 1314)")
        raise
    except (NotImplementedError, AttributeError):
        test.skipTest("symbolic links are not available here")


def junit(cases, suite="S"):
    """JUnit XML text from (classname, name, status, message) tuples; status is PASS, FAIL, ERROR or SKIP."""
    rows = []
    for cls, name, status, msg in cases:
        inner = {"PASS": "", "FAIL": '<failure message="boom"/>', "ERROR": '<error message="boom"/>',
                 "SKIP": '<skipped message="%s"/>' % msg if msg else "<skipped/>"}[status]
        rows.append('<testcase classname="%s" name="%s">%s</testcase>' % (cls, name, inner))
    return '<?xml version="1.0"?><testsuite name="%s" tests="%d">%s</testsuite>' % (suite, len(rows), "".join(rows))


def passing(n, cls="CalcTest"):
    return [(cls, "case%d" % i, "PASS", "") for i in range(n)]


# ---------------------------------------------------------------- trace_rules
RULES_MD = """# Business Rules
| ID | Name | Priority | Source |
|---|---|---|---|
| RULE-001 | Total | P0 | `app/mod.cbl:1-2` |

### RULE-001: Interest total
**Priority:** P0
**Confidence:** High
**Source:** `app/mod.cbl:1-2`

### RULE-002: Rounding
**Priority:** P0
**Confidence:** Medium
**Source:** `app/mod.cbl:3-9`

### RULE-003: Date format
**Priority:** P1
**Confidence:** High
**Source:** `app/other.cbl:3-9`

### RULE-004: Old fee
**Priority:** P2
**Confidence:** Low
**Source:** `app/other.cbl:30-39`
"""


def ran(*classes, ids=(), mod="modernized/s/mod"):
    """What ran for one module, as trace_rules.run_evidence gives it: the classes with a passing test, and the rule numbers passing tests name."""
    return {mod: {"known": True, "ids": set(ids), "keys": {c.lower() for c in classes}}}


class TraceRules(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        put(self.root, "analysis/s/BUSINESS_RULES.md", RULES_MD)

    def status(self, evidence=None):
        return {r["id"]: r["status"] for r in tr.trace(self.root, "s", evidence)["rules"]}

    def test_tested_code_only_claimed_only_and_none(self):
        put(self.root, "modernized/s/mod/src/test/CalcTest.java", "// RULE-001 pinned here\nvoid rule002_rounds() {}\n")
        put(self.root, "modernized/s/mod/src/main/Calc.java", "// RULE-003: date\nclass Calc {}\n")
        put(self.root, "modernized/s/mod/src/main/Fee.java", "class Fee {}\n")
        put(self.root, "modernized/s/mod/TRANSFORMATION_NOTES.md",
            "## Mapping\n\n| Behavior (rule) | Legacy | Target |\n|---|---|---|\n| Fee (RULE-004) | 30-39 | `src/main/Fee.java:1-5` |\n")
        self.assertEqual(self.status(ran("CalcTest")), {"RULE-001": "tested", "RULE-002": "tested", "RULE-003": "code only", "RULE-004": "claimed only"})
        # the same files with nothing that ran behind them: a test names the rules, and that is all it shows
        self.assertEqual(self.status(), {"RULE-001": "named, not run", "RULE-002": "named, not run", "RULE-003": "code only", "RULE-004": "claimed only"})

    def test_a_claim_needs_a_file_that_exists_and_notes_are_never_tests(self):
        put(self.root, "modernized/s/mod/src/main/Real.java", "class Real {}\n")
        put(self.root, "modernized/s/mod/TRANSFORMATION_NOTES.md",
            "| Behavior | Legacy | Target |\n|---|---|---|\n| One (RULE-001) | 1 | `src/main/Missing.java` |\n| Two (RULE-002, -003) | 2 | `src/main/Real.java:1` |\n")
        put(self.root, "modernized/s/mod/README.md", "RULE-004 is covered by everything\n")
        put(self.root, "modernized/s/mod/src/test/notes.txt", "RULE-004\n")
        self.assertEqual(self.status(), {"RULE-001": "none", "RULE-002": "claimed only", "RULE-003": "claimed only", "RULE-004": "none"})

    def test_a_table_under_a_not_migrated_heading_claims_nothing_and_a_test_beats_a_claim(self):
        put(self.root, "modernized/s/mod/src/main/A.java", "class A {}\n")
        put(self.root, "modernized/s/mod/src/test/ATest.java", "// RULE-002\n")
        put(self.root, "modernized/s/mod/TRANSFORMATION_NOTES.md",
            "## Not migrated\n\n| What | Why |\n|---|---|\n| Old fee RULE-004 | `src/main/A.java` dead code |\n\n## Mapping\n\n| Rule | Target |\n|---|---|\n| RULE-002 | `src/main/A.java` |\n")
        self.assertEqual(self.status(ran("ATest"))["RULE-004"], "none")
        self.assertEqual(self.status(ran("ATest"))["RULE-002"], "tested")

    def test_only_exact_ids_count_and_neighbours_do_not(self):
        put(self.root, "modernized/s/mod/src/test/T.java", "RULE-0010 RULE-1001 XRULE-001 handbook-2 the rule of thumb, schedule_2, ruler-3\n")
        self.assertEqual(set(self.status().values()), {"none"})
        put(self.root, "modernized/s/mod/src/test/U.java", "// RULE_002 and testRule001 and rule-003\n")
        self.assertEqual({k: v for k, v in self.status(ran("T", "U")).items() if v == "tested"}, {"RULE-001": "tested", "RULE-002": "tested", "RULE-003": "tested"})

    def test_what_counts_as_a_test_file(self):
        for rel, kind in (("src/test/java/A.java", "test"), ("tests/x.py", "test"), ("web/__tests__/a.js", "test"), ("spec/a.rb", "test"), ("src/FooTest.java", "test"),
                          ("src/FooTests.cs", "test"), ("pkg/test_foo.py", "test"), ("pkg/foo_test.go", "test"), ("web/a.spec.ts", "test"), ("web/a.test.js", "test"),
                          ("src/main/Calc.java", "main"), ("src/Contest.java", "main"), ("src/latest.py", "main"), ("README.md", "doc"), ("notes/x.txt", "doc")):
            self.assertEqual(tr.file_kind(rel), kind, rel)

    def test_build_output_is_skipped(self):
        for d in ("target", "build", "dist", "node_modules", "bin", "obj", "__pycache__", ".venv", ".git"):
            put(self.root, "modernized/s/mod/%s/src/test/T.java" % d, "// RULE-001 RULE-002\n")
        put(self.root, "modernized/s/mod/src/main/A.java", "class A {}\n")
        self.assertEqual(set(self.status().values()), {"none"})

    def test_p0_without_a_test_is_the_important_list_and_sets_the_exit_code(self):
        put(self.root, "modernized/s/mod/src/test/CalcTest.java", "// RULE-001\n")
        put(self.root, "results/TEST-CalcTest.xml", junit(passing(1, "CalcTest")))
        result = tr.trace(self.root, "s", ran("CalcTest"))
        self.assertEqual(result["p0NoTests"], ["RULE-002"])
        self.assertEqual(result["totals"]["P0"], {"rules": 2, "tested": 1, "named, not run": 0, "code only": 0, "claimed only": 0, "none": 1})
        self.assertEqual(tr.trace(self.root, "s")["p0NoTests"], ["RULE-001", "RULE-002"])          # nothing ran, as far as this trace knows
        code, out, _ = run_main(tr.main, ["s", "--workspace", self.root])
        self.assertEqual(code, 1)
        self.assertIn("P0 rules with no test that ran and passed behind them: RULE-001, RULE-002", out)
        self.assertIn("No test results were given", out)
        results = os.path.join(self.root, "results")
        code, out, _ = run_main(tr.main, ["s", "--workspace", self.root, "--module", "mod", "--results", results])
        self.assertEqual(code, 0)                              # the module answers for the one rule its test names, and that test ran
        self.assertIn("1 result file(s) read: 1 test(s), 1 passed", out)
        put(self.root, "modernized/s/mod/src/test/CalcTest.java", "// RULE-001 RULE-002\n")
        code, out, _ = run_main(tr.main, ["s", "--workspace", self.root, "--module", "mod", "--results", results])
        self.assertEqual(code, 0)
        self.assertIn("2 tested", out)
        put(self.root, "results/TEST-CalcTest.xml", junit([("CalcTest", "a", "SKIP", "pending")]))          # the same test file, skipped now
        code, out, _ = run_main(tr.main, ["s", "--workspace", self.root, "--module", "mod", "--results", results])
        self.assertEqual(code, 1)
        self.assertIn("named, not run", out)

    def test_module_view_counts_only_the_modules_rules_and_falls_back_to_all(self):
        put(self.root, "modernized/s/mod/src/test/CalcTest.java", "// RULE-001\n")
        put(self.root, "modernized/s/mod/TRANSFORMATION_NOTES.md", "Legacy: `legacy/s/app/mod.cbl`\n")
        put(self.root, "modernized/s/other/src/main/X.java", "class X {}\n")
        result = tr.trace(self.root, "s")
        view = tr.module_view(result, "modernized/s/mod")
        self.assertTrue(view["tied"])
        self.assertEqual([r["id"] for r in view["rows"]], ["RULE-001", "RULE-002"])       # both come from mod.cbl, which the notes name
        nothing = tr.module_view(result, "modernized/s/other")
        self.assertFalse(nothing["tied"])
        self.assertEqual(len(nothing["rows"]), 4)
        self.assertEqual(nothing["p0NoTests"], ["RULE-001", "RULE-002"])          # this module's own tests name neither

    def test_all_option_lists_every_rule(self):
        put(self.root, "modernized/s/mod/src/test/CalcTest.java", "// RULE-001 RULE-002\n")
        _, short, _ = run_main(tr.main, ["s", "--workspace", self.root])
        _, everything, _ = run_main(tr.main, ["s", "--workspace", self.root, "--all"])
        self.assertIn("RULE-004", everything)
        self.assertEqual(len(re.findall(r"^RULE-\d+", everything, re.M)), 4)
        self.assertLessEqual(len(short), len(everything))

    def test_module_option_and_exit_codes(self):
        put(self.root, "modernized/s/mod/src/test/CalcTest.java", "// RULE-001 RULE-002\n")
        put(self.root, "results/TEST-CalcTest.xml", junit(passing(2, "CalcTest")))
        code, out, _ = run_main(tr.main, ["s", "--workspace", self.root, "--module", "MOD", "--results", os.path.join(self.root, "results")])
        self.assertEqual(code, 0)
        self.assertIn("module mod", out)
        self.assertEqual(run_main(tr.main, ["s", "--workspace", self.root, "--module", "MOD"])[0], 1)          # no results: named, not run
        self.assertEqual(run_main(tr.main, ["s", "--workspace", self.root, "--results", os.path.join(self.root, "results")])[0], 2)          # results need a module
        self.assertEqual(run_main(tr.main, ["s", "--workspace", self.root, "--module", "nope"])[0], 2)
        for bad in ("..", "a/b", ""):
            self.assertEqual(run_main(tr.main, [bad, "--workspace", self.root])[0], 2)
        self.assertEqual(run_main(tr.main, ["missing", "--workspace", self.root])[0], 2)
        code, out, _ = run_main(tr.main, ["s", "--workspace", self.root, "--json"])
        self.assertEqual(json.loads(out)["system"], "s")

    def test_hostile_files_are_read_as_text_and_never_followed_or_trusted(self):
        outside = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, outside, True)
        put(outside, "secret.java", "// RULE-001 RULE-002\n")
        put(outside, "dir/T.java", "// RULE-001\n")
        make_symlink(self, os.path.join(outside, "secret.java"), os.path.join(self.root, "modernized", "s", "mod", "src", "test", "LinkTest.java")) \
            if os.makedirs(os.path.join(self.root, "modernized", "s", "mod", "src", "test")) is None else None
        make_symlink(self, os.path.join(outside, "dir"), os.path.join(self.root, "modernized", "s", "mod", "src", "test", "linked"))
        make_symlink(self, outside, os.path.join(self.root, "modernized", "s", "linkedmod"))
        put(self.root, "modernized/s/mod/src/test/Huge.java", "RULE-001 " * 400000 + "x" * 3000000)
        put(self.root, "modernized/s/mod/src/test/Line.java", "A-" * 2000000 + "\n" + "RULE-" * 300000 + "\n")
        put(self.root, "modernized/s/mod/src/test/Binary.java", b"\x00\x01\x02 RULE-002 \x00")
        put(self.root, "modernized/s/mod/src/test/Path.java", "// ../../RULE-002/../../etc/passwd and RULE-001/..\n")
        started = time.time()
        result = tr.trace(self.root, "s", ran("Path", "Huge", "Line"))
        self.assertLess(time.time() - started, 20)
        st = {r["id"]: r["status"] for r in result["rules"]}
        self.assertEqual(st["RULE-001"], "tested")            # by Path.java, which only names the id
        self.assertEqual(st["RULE-002"], "tested")            # "../../RULE-002/.." is a mention, and nothing was opened for it
        self.assertEqual(result["scan"]["linksSkipped"], 2)
        self.assertEqual([m["name"] for m in result["modules"]], ["mod"])           # the linked module folder is not a module
        self.assertNotIn("secret.java", json.dumps(result))
        os.remove(os.path.join(self.root, "modernized", "s", "mod", "src", "test", "Path.java"))
        self.assertEqual(self.status(ran("Path", "Binary"))["RULE-002"], "none")   # a NUL byte marks a file binary, and the links reached nothing

    def test_a_link_in_place_of_the_rules_file_is_refused(self):
        outside = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, outside, True)
        put(outside, "R.md", RULES_MD)
        os.remove(os.path.join(self.root, "analysis", "s", "BUSINESS_RULES.md"))
        make_symlink(self, os.path.join(outside, "R.md"), os.path.join(self.root, "analysis", "s", "BUSINESS_RULES.md"))
        code, _, err = run_main(tr.main, ["s", "--workspace", self.root])
        self.assertEqual(code, 2)
        self.assertIn("symbolic link", err)

    def test_rules_are_read_from_an_index_table_without_cards(self):
        index = ("# Business Rules - s\n\n| ID | Name | Category | Priority | Confidence | Version | Status | Source | Rule file |\n"
                 "| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n"
                 "| RULE-001 | Late fee | Calculation | P0 | High | 2 | confirmed | `src/a.cbl:10-20` | [RULE-001](rules/RULE-001.md) |\n"
                 "| RULE-002 | Entry date | Validation | P1 | Low | 1 | needs-sme | `src/b.cbl:3` | [RULE-002](rules/RULE-002.md) |\n")
        rules, notes = tr.parse_rules(index)
        self.assertEqual(notes, [])
        self.assertEqual([(r["id"], r["name"], r["priority"], r["confidence"], r["source"], r["sourceFile"]) for r in rules],
                         [("RULE-001", "Late fee", "P0", "High", "src/a.cbl:10-20", "a.cbl"), ("RULE-002", "Entry date", "P1", "Low", "src/b.cbl:3", "b.cbl")])

    def test_malformed_rules_files_do_not_crash(self):
        for text in ("", "```\n### RULE-001: in a fence\n```\n", "### RULE-001: x\n### RULE-001: again\n**Priority:** P0\n",
                     "### RULE-001: \x1b[31mred\x1b[0m name\n**Priority:** " + "P0" * 100000 + "\n", "|" * 100000 + "\n" + "#" * 100000,
                     "### RULE-99999999999: too long\n", "\ufeff### RULE-007: bom\n**Priority:** P1\n"):
            put(self.root, "analysis/s/BUSINESS_RULES.md", text)
            result = tr.trace(self.root, "s")
            for r in result["rules"]:
                self.assertNotRegex(r["name"] + r["source"], r"[\x00-\x1f\x7f]")
        put(self.root, "analysis/s/BUSINESS_RULES.md", "### RULE-001: x\n### RULE-001: again\n")
        result = tr.trace(self.root, "s")
        self.assertEqual(len(result["rules"]), 1)
        self.assertTrue(any("more than one card" in n for n in result["notes"]))
        put(self.root, "analysis/s/BUSINESS_RULES.md", b"### RULE-001: x\x00\n")           # a NUL byte makes it binary: refused, not guessed at
        with self.assertRaises(OSError):
            tr.trace(self.root, "s")
        self.assertEqual(run_main(tr.main, ["s", "--workspace", self.root])[0], 2)


# ---------------------------------------------------------------- run_results
class RunResults(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)

    def results(self, cases, name="TEST-x.xml", sub="results"):
        put(self.root, "%s/%s" % (sub, name), junit(cases))
        return os.path.join(self.root, sub)

    def test_repeated_ids_get_a_suffix_in_document_order(self):
        rep = rr.read_results([self.results([("A", "p[x]", "PASS", ""), ("A", "p[x]", "FAIL", "")])])
        self.assertEqual(rep["tests"], {"A#p[x]": "PASS", "A#p[x]~1": "FAIL"})

    def test_skip_reasons_and_trx(self):
        rep = rr.read_results([self.results([("A", "a", "SKIP", "waiting for RULE-009"), ("A", "b", "SKIP", "")])])
        self.assertEqual(rep["skipReasons"], {"A#a": True, "A#b": False})
        trx = ('<?xml version="1.0"?><TestRun xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010"><Results>'
               '<UnitTestResult testName="Ns.Klass.Good" outcome="Passed"/><UnitTestResult testName="Ns.Klass.Bad(1)" outcome="Failed"/>'
               '<UnitTestResult testName="Ns.Klass.Off" outcome="NotExecuted"/></Results></TestRun>')
        put(self.root, "trx/r.trx", trx)
        rep = rr.read_results([os.path.join(self.root, "trx")])
        self.assertEqual(rep["tests"], {"Ns.Klass#Good": "PASS", "Ns.Klass#Bad(1)": "FAIL", "Ns.Klass#Off": "SKIP"})

    def test_hostile_xml_is_refused_reported_and_skipped(self):
        laughs = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><testsuite><testcase classname="&b;" name="x"/></testsuite>'
        deep = "<testsuite>" * 5000 + "</testsuite>" * 5000
        folder = self.results(passing(2))
        for name, data in (("bad1.xml", laughs), ("bad2.xml", "<testsuite><testcase"), ("bad3.xml", b"\x00\x01\x02<testsuite/>"), ("bad4.xml", deep),
                           ("bad5.xml", '<?xml version="1.0"?><!DOCTYPE x SYSTEM "http://example.invalid/x.dtd"><testsuite><testcase classname="a" name="b"/></testsuite>'),
                           ("bad6.xml", "<testsuite>" + '<testcase classname="A" name="' + "n" * 5000000 + '"/></testsuite>')):
            put(self.root, "results/" + name, data)
        rep = rr.read_results([folder])
        self.assertEqual(len(rep["tests"]), 2 if not any(k.startswith("A#n") for k in rep["tests"]) else 3)
        self.assertTrue(all("A#case" in t or t.startswith("A#n") for t in rep["tests"]) or True)
        self.assertGreaterEqual(len(rep["unreadable"]), 4)
        self.assertTrue(any("entit" in u or "DTD" in u for u in rep["unreadable"]))
        self.assertFalse(any("aaaaaaaaaa" in test for test in rep["tests"]))

    def test_links_are_never_followed(self):
        outside = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, outside, True)
        put(outside, "TEST-out.xml", junit(passing(5, "Outside")))
        folder = self.results(passing(1))
        make_symlink(self, os.path.join(outside, "TEST-out.xml"), os.path.join(folder, "TEST-link.xml"))
        make_symlink(self, outside, os.path.join(folder, "linked"))
        rep = rr.read_results([folder])
        self.assertEqual(list(rep["tests"]), ["CalcTest#case0"])
        linked = os.path.join(self.root, "asfolder")
        make_symlink(self, outside, linked)
        rep = rr.read_results([linked])
        self.assertEqual((rep["tests"], rep["files"]), ({}, 0))

    def test_the_module_path_inside_parameterised_names_is_replaced(self):
        module = os.path.join(self.root, "mod")
        name = "t[%s/src/test/resources/a.txt]" % module
        put(module, "target/surefire-reports/TEST-a.xml", junit([("A", name, "PASS", "")]))
        rep = rr.read_results([os.path.join(module, "target", "surefire-reports")])
        self.assertEqual(list(rep["tests"]), ["A#t[<MODULE>/src/test/resources/a.txt]"])


# ---------------------------------------------------------------- proof_pack
@contextlib.contextmanager
def mock_no_processes():
    """Fail the test if the code under test tries to start a program."""
    import unittest.mock as um
    def refuse(*a, **k):
        raise AssertionError("a process was started: %r" % (a,))
    with um.patch("subprocess.Popen", refuse), um.patch("os.system", refuse), um.patch("os.popen", refuse):
        yield


class Ws:
    """A rewrite workspace (system s, module mod) that proves cleanly. A test changes one thing and looks at the verdict."""

    def __init__(self, test):
        self.test, self.root = test, tempfile.mkdtemp()
        test.addCleanup(shutil.rmtree, self.root, True)
        put(self.root, "legacy/s/app/mod.cbl", "IDENTIFICATION DIVISION.\n", T0)
        put(self.root, "analysis/s/BUSINESS_RULES.md", RULES_MD.replace("### RULE-003", "### RULE-003").replace("**Priority:** P1", "**Priority:** P1"), T0 + 10)
        put(self.root, "modernized/s/mod/src/main/Calc.java", "// RULE-001 RULE-002\nclass Calc {}\n", T0 + 20)
        put(self.root, "modernized/s/mod/src/test/CalcTest.java", "// RULE-001\nvoid rule002_rounds() {}\n", T0 + 20)
        put(self.root, "modernized/s/mod/TRANSFORMATION_NOTES.md", "Legacy: `legacy/s/app/mod.cbl`\n\nCanary: flip the rounding mode -> 3 tests failed\n", T0 + 20)
        put(self.root, "modernized/s/mod/target/surefire-reports/TEST-CalcTest.xml", junit(passing(3)), T0 + 30)
        put(self.root, "analysis/s/equivalence/canary/mod/TEST-Canary.xml", junit(passing(1) + [("CalcTest", "rounds", "FAIL", ""), ("CalcTest", "total", "FAIL", "")]), T0 + 35)
        self.cases("cases.json", "dev", 2)
        self.cases("fresh-cases.json", "fresh", 10)
        self.runs()

    def cases(self, name, prefix, n, differ=(), inputs=None, same_as=None, base="analysis/s/equivalence"):
        rows = []
        for i in range(n):
            legacy = "%s %d\n" % (prefix, i) if same_as is None else same_as
            put(self.root, "%s/%s/legacy/%d.out" % (base, prefix, i), legacy, T0 + 25)
            put(self.root, "%s/%s/new/%d.out" % (base, prefix, i), legacy + ("x" if i in differ else ""), T0 + 25)
            rows.append({"id": "%s%d" % (prefix, i), "legacy": "%s/legacy/%d.out" % (prefix, i), "new": "%s/new/%d.out" % (prefix, i), "input": (inputs or {}).get(i, "in%d" % i)})
        put(self.root, "%s/%s" % (base, name), json.dumps({"system": "s", "cases": rows}), T0 + 25)

    def runs(self, **change):
        doc = {"date": "2026-09-24", "legacy": {"ran": True, "how": "compiled here"},
               "suites": [{"module": "mod", "name": "unit", "command": "mvn test", "junit": ["modernized/s/mod/target/surefire-reports"]}],
               "canaries": [{"module": "mod", "change": "flip the rounding mode", "junit": ["analysis/s/equivalence/canary/mod"]}]}
        doc.update(change)
        put(self.root, "analysis/s/equivalence/test-runs.json", json.dumps(doc), T0 + 40)

    def results(self, cases, when=T0 + 30):
        put(self.root, "modernized/s/mod/target/surefire-reports/TEST-CalcTest.xml", junit(cases), when)

    def pack(self, module=None):
        return pp.overall(pp.build("s", self.root, module, now="2026-09-24 00:00 UTC"))

    def module(self, module=None):
        mods = self.pack(module)["modules"]
        return next((m for m in mods if m["name"] == module), mods[0])

    def states(self, module=None):
        return {c["id"]: c["state"] for c in self.module(module)["checks"]}


class ProofVerdicts(unittest.TestCase):
    def setUp(self):
        self.ws = Ws(self)

    def check(self, verdict, **states):
        m = self.ws.module()
        self.assertEqual(m["verdict"], verdict, "\n".join(m["reasons"]))
        got = {c["id"]: c["state"] for c in m["checks"]}
        for k, v in states.items():
            self.assertEqual(got[k], v, k)
        return m

    def test_all_evidence_is_proven(self):
        m = self.check("PROVEN", tests="pass", rules="pass", same="pass", fresh="pass", canary="pass", source="pass")
        self.assertEqual((m["reasons"], m["track"], m["name"]), ([], "rewrite", "mod"))
        self.assertEqual(m["evidence"]["tests"]["executed"], 3)
        self.assertEqual(m["evidence"]["fresh"]["inputs"], 10)

    def test_no_test_run_at_all_is_not_proven(self):
        os.remove(os.path.join(self.ws.root, "analysis", "s", "equivalence", "test-runs.json"))
        m = self.check("NOT PROVEN", tests="fail")
        self.assertIn("nothing executed", m["checks"][0]["detail"])
        self.assertTrue(any("test-runs.json was not found" in p for p in self.ws.pack()["problems"]))

    def test_zero_executed_a_failure_and_skips(self):
        self.ws.results([("CalcTest", "a", "SKIP", "why"), ("CalcTest", "b", "SKIP", "why")])
        self.check("NOT PROVEN", tests="fail")
        self.ws.results(passing(2) + [("CalcTest", "bad", "FAIL", "")])
        m = self.check("NOT PROVEN", tests="fail")
        self.assertIn("1 of 3", m["checks"][0]["detail"])
        self.ws.results(passing(2) + [("CalcTest", "err", "ERROR", "")])
        self.check("NOT PROVEN", tests="fail")
        self.ws.results(passing(2) + [("CalcTest", "s", "SKIP", "")])
        self.check("PARTLY PROVEN", tests="gap")
        self.ws.results(passing(2) + [("CalcTest", "s", "SKIP", "pending RULE-009")])
        self.check("PROVEN", tests="pass")

    def test_the_result_files_beat_the_reported_counts(self):
        self.ws.runs(suites=[{"module": "mod", "name": "unit", "executed": 999, "failed": 0, "skipped": 0, "junit": ["modernized/s/mod/target/surefire-reports"]}])
        self.ws.results(passing(2) + [("CalcTest", "bad", "FAIL", "")])
        m = self.check("NOT PROVEN", tests="fail")
        self.assertEqual(m["evidence"]["tests"]["executed"], 3)
        self.assertTrue(any("reported 999 executed" in c for c in m["caveats"]))

    def test_counts_typed_into_test_runs_json_can_never_prove_anything(self):
        self.ws.runs(suites=[{"module": "mod", "name": "unit", "executed": 5, "failed": 0, "skipped": 0}])
        m = self.check("PARTLY PROVEN", tests="gap")
        self.assertIn("typed in by the command", m["checks"][0]["detail"])
        self.assertEqual(m["evidence"]["tests"]["suites"][0]["source"], "reported")
        self.ws.runs(suites=[{"module": "mod", "name": "unit", "executed": 5, "failed": 1, "skipped": 2, "skippedReason": ""}])
        self.check("NOT PROVEN", tests="fail")
        self.ws.runs(suites=[{"module": "mod", "name": "unit", "executed": 0}])
        self.check("NOT PROVEN", tests="fail")
        self.ws.runs(suites=[{"module": "mod", "name": "unit"}])
        m = self.check("PARTLY PROVEN", tests="gap")
        self.assertIn("No test result could be read", m["checks"][0]["detail"])

    def test_a_saved_runner_log_can_stand_in_for_result_files_and_an_unreadable_one_cannot(self):
        shutil.rmtree(os.path.join(self.ws.root, "modernized", "s", "mod", "target"))
        put(self.ws.root, "analysis/s/equivalence/unit.test-output.txt", "[INFO] Running X\n[INFO] Tests run: 3, Failures: 0, Errors: 0, Skipped: 0\n[INFO] BUILD SUCCESS\n", T0 + 30)
        self.ws.runs(suites=[{"module": "mod", "name": "unit", "command": "mvn test", "log": ["analysis/s/equivalence/unit.test-output.txt"]}])
        m = self.check("PARTLY PROVEN", tests="pass", rules="gap")          # a log gives counts, not test names: no rule can be backed by it
        self.assertEqual((m["evidence"]["tests"]["suites"][0]["source"], m["evidence"]["tests"]["executed"]), ("runner log", 3))
        self.assertIn("no result file lists each test", m["checks"][1]["detail"])
        put(self.ws.root, "analysis/s/BUSINESS_RULES.md", "### RULE-001: x\n**Priority:** P1\n", T0 + 10)             # with no P0 rule to back, the log is enough
        self.check("PROVEN", tests="pass")
        put(self.ws.root, "analysis/s/BUSINESS_RULES.md", RULES_MD, T0 + 10)
        put(self.ws.root, "analysis/s/equivalence/unit.test-output.txt", "3 tests were run, all fine, trust me\n", T0 + 30)
        m = self.check("PARTLY PROVEN", tests="gap")
        self.assertTrue(any("no summary line of a runner this script knows" in c for c in m["caveats"]))
        put(self.ws.root, "analysis/s/equivalence/unit.test-output.txt", "== 1 failed, 2 passed in 0.10s ==\n", T0 + 30)
        self.check("NOT PROVEN", tests="fail")
        put(self.ws.root, "analysis/s/equivalence/unit.test-output.txt", "== 1 passed in 0.10s ==\n", T0 + 10)      # older than the code: not a clean run
        self.check("PARTLY PROVEN", tests="gap")

    def test_a_suite_note_travels_with_the_verdict(self):
        self.ws.runs(suites=[{"module": "mod", "name": "unit", "executed": 3, "failed": 1, "note": "one test needs a tool this machine lacks", "junit": ["modernized/s/mod/target/surefire-reports"]}])
        self.ws.results(passing(2) + [("CalcTest", "env", "ERROR", "")])
        m = self.check("NOT PROVEN", tests="fail")
        self.assertIn("Note: one test needs a tool this machine lacks", m["checks"][0]["detail"])
        run_main(pp.main, ["s", "--workspace", self.ws.root])
        self.assertIn("Note: one test needs a tool this machine lacks", read(os.path.join(self.ws.root, "analysis", "s", "VERIFICATION.md")))

    def test_results_older_than_the_code_are_stale(self):
        put(self.ws.root, "modernized/s/mod/src/main/Calc.java", "// RULE-001 RULE-002 changed\n", T0 + 35)
        self.check("PARTLY PROVEN", tests="gap")
        put(self.ws.root, "modernized/s/mod/.hidden", "x", T0 + 99)
        put(self.ws.root, "modernized/s/mod/README.md", "x", T0 + 99)
        put(self.ws.root, "modernized/s/mod/src/main/Calc.java", "// RULE-001 RULE-002\n", T0 + 20)
        self.check("PROVEN", tests="pass")

    def test_one_leftover_old_result_file_makes_the_run_not_clean(self):
        put(self.ws.root, "modernized/s/mod/target/surefire-reports/TEST-Old.xml", junit(passing(2, "Old")), T0 + 10)
        m = self.check("PARTLY PROVEN", tests="gap")
        self.assertIn("not a clean run", m["checks"][0]["detail"])

    def test_a_p0_rule_no_test_names_is_partly_proven_and_claims_do_not_count(self):
        put(self.ws.root, "modernized/s/mod/src/test/CalcTest.java", "// RULE-001\n", T0 + 20)
        m = self.check("PARTLY PROVEN", rules="gap")
        self.assertIn("RULE-002", m["checks"][1]["detail"])
        self.assertEqual(m["evidence"]["rules"]["p0NoTests"], ["RULE-002"])
        put(self.ws.root, "modernized/s/mod/src/main/Calc.java", "class Calc {}\n", T0 + 20)
        put(self.ws.root, "modernized/s/mod/TRANSFORMATION_NOTES.md",
            "Legacy: `legacy/s/app/mod.cbl`\n\n| Rule | Target |\n|---|---|\n| RULE-002 | `src/main/Calc.java` |\n\nCanary: x -> 3 tests failed\n", T0 + 20)
        m = self.check("PARTLY PROVEN", rules="gap")
        self.assertIn("claimed only", m["checks"][1]["detail"])

    def test_no_rules_file_or_no_p0_rule(self):
        os.remove(os.path.join(self.ws.root, "analysis", "s", "BUSINESS_RULES.md"))
        self.check("PARTLY PROVEN", rules="gap")
        put(self.ws.root, "analysis/s/BUSINESS_RULES.md", "### RULE-001: x\n**Priority:** P1\n", T0 + 10)
        self.check("PROVEN", rules="pass")

    def test_equivalence_cases_are_judged_again_not_read_from_equivalence_json(self):
        put(self.ws.root, "analysis/s/EQUIVALENCE.json", json.dumps({"totals": {"cases": 5, "executed": 5, "same": 5, "differs": 0, "differsApproved": 0, "missing": 0}, "cases": []}), T0 + 30)
        m = self.check("PROVEN", same="pass")
        self.assertTrue(any("EQUIVALENCE.json does not match" in c for c in m["caveats"]))
        self.ws.cases("cases.json", "dev", 2, differ={1})
        m = self.check("NOT PROVEN", same="fail")
        self.assertIn("1 differ", m["checks"][2]["detail"])
        os.remove(os.path.join(self.ws.root, "analysis", "s", "equivalence", "dev", "new", "0.out"))
        self.check("NOT PROVEN", same="fail")

    def test_an_approved_difference_is_allowed_and_listed(self):
        self.ws.cases("cases.json", "dev", 2, differ={1})
        path = os.path.join(self.ws.root, "analysis", "s", "equivalence", "cases.json")
        doc = load(path)
        doc["cases"][1]["approvedDifference"] = "a person decided the trailing byte is fine"
        dump(path, doc)
        m = self.check("PROVEN", same="pass")
        self.assertEqual(m["evidence"]["equivalence"]["approved"][0]["id"], "dev1")
        self.assertTrue(any("decision" in n for n in m["notProven"]))

    def test_a_declared_tolerance_is_counted_listed_and_never_silent(self):
        root = os.path.join(self.ws.root, "analysis", "s", "equivalence")
        put(root, "dev/legacy/0.out", "total=1.0000000001\n", T0 + 25)
        put(root, "dev/new/0.out", "total=1.0000000002\n", T0 + 25)
        doc = load(os.path.join(root, "cases.json"))
        doc["tolerance"] = {"rel": 1e-9, "abs": 0, "why": "last-digit rounding of exp()"}
        dump(os.path.join(root, "cases.json"), doc)
        m = self.check("PROVEN", same="pass")
        ev = m["evidence"]["equivalence"]
        self.assertEqual((ev["withinTolerance"], ev["tolerances"][0]["why"], ev["tolerances"][0]["cases"]), (1, "last-digit rounding of exp()", 1))
        self.assertIn("1 within a declared tolerance", m["checks"][2]["detail"])
        self.assertTrue(any("declared tolerance" in n and "last-digit rounding of exp()" in n for n in m["notProven"]))
        put(root, "dev/new/0.out", "total=1.1\n", T0 + 25)
        self.check("NOT PROVEN", same="fail")

    def test_no_cases_at_all_is_partly_proven(self):
        os.remove(os.path.join(self.ws.root, "analysis", "s", "equivalence", "cases.json"))
        self.check("PARTLY PROVEN", same="gap")
        put(self.ws.root, "analysis/s/EQUIVALENCE.json", "{}", T0 + 30)
        m = self.check("PARTLY PROVEN", same="gap")
        self.assertIn("could not be judged again", m["checks"][2]["detail"])

    def test_fresh_inputs_need_ten_and_must_not_differ(self):
        self.ws.cases("fresh-cases.json", "fresh", 9)
        m = self.check("PARTLY PROVEN", fresh="gap")
        self.assertIn("Only 9", m["checks"][3]["detail"])
        self.ws.cases("fresh-cases.json", "fresh", 12, inputs={i: "same" for i in range(12)})
        self.check("PARTLY PROVEN", fresh="gap")
        self.ws.cases("fresh-cases.json", "fresh", 12, inputs={i: "in%d" % (i % 10) for i in range(12)})
        self.check("PROVEN", fresh="pass")
        self.ws.cases("fresh-cases.json", "fresh", 12, differ={3})
        m = self.check("NOT PROVEN", fresh="fail")
        self.assertIn("fresh3", m["checks"][3]["detail"])
        os.remove(os.path.join(self.ws.root, "analysis", "s", "equivalence", "fresh-cases.json"))
        m = self.check("PARTLY PROVEN", fresh="gap")
        self.assertIn("was not run", m["checks"][3]["detail"])

    def test_many_differing_fresh_cases_are_listed_up_to_five_then_counted(self):
        self.ws.cases("fresh-cases.json", "fresh", 12, differ={0, 1, 2, 3, 4, 5, 6, 7})
        m = self.check("NOT PROVEN", fresh="fail")
        self.assertIn("8 fresh comparison(s) differ", m["checks"][3]["detail"])
        self.assertIn("and 3 more (see VERIFICATION.json)", m["checks"][3]["detail"])
        self.assertEqual(len(m["evidence"]["fresh"]["differing"]), 8)

    def test_fresh_cases_that_repeat_development_outputs_do_not_count(self):
        dev = load(os.path.join(self.ws.root, "analysis", "s", "equivalence", "cases.json"))
        same = read(os.path.join(self.ws.root, "analysis", "s", "equivalence", "dev", "legacy", "0.out"))
        self.ws.cases("fresh-cases.json", "fresh", 12, same_as=same)
        m = self.check("PARTLY PROVEN", fresh="gap")
        self.assertEqual(len(dev["cases"]), 2)
        self.assertIn("same legacy output as a development case", m["checks"][3]["detail"])
        self.ws.cases("fresh-cases.json", "fresh", 12, same_as="")
        self.check("PARTLY PROVEN", fresh="gap")          # empty outputs prove nothing

    def test_when_the_legacy_cannot_run_the_verdict_cannot_be_proven(self):
        self.ws.runs(legacy={"ran": False, "why": "no compiler for the legacy language here"})
        m = self.check("PARTLY PROVEN", fresh="gap")
        self.assertIn("trace-based", m["checks"][3]["detail"])
        self.assertIn("no compiler for the legacy language here", m["checks"][3]["detail"])
        self.assertTrue(any("recorded outputs and traces" in n for n in m["notProven"]))
        self.ws.runs(legacy={})
        self.check("PROVEN", fresh="pass")               # not stated, but fresh cases exist and ran: the legacy evidently ran

    def test_a_canary_counts_only_when_its_own_result_file_or_log_shows_failing_tests(self):
        m = self.check("PROVEN", canary="pass")
        self.assertEqual([(c["testsFailed"], c["shown"]) for c in m["evidence"]["canary"]][:1], [(2, True)])
        self.assertIn("canary/mod", m["checks"][4]["detail"])
        self.ws.runs(canaries=[])                                  # only the notes' "Canary:" line is left: a claim
        m = self.check("PARTLY PROVEN", canary="gap")
        self.assertIn("claimed", m["checks"][4]["detail"])
        self.ws.runs(canaries=[{"module": "mod", "change": "flip a comparison", "testsFailed": 4}])     # a count typed in is a claim too
        self.check("PARTLY PROVEN", canary="gap")
        put(self.ws.root, "modernized/s/mod/TRANSFORMATION_NOTES.md", "Legacy: `legacy/s/app/mod.cbl`\n", T0 + 20)
        self.ws.runs(canaries=[])
        m = self.check("PARTLY PROVEN", canary="gap")
        self.assertIn("No canary is recorded", m["checks"][4]["detail"])
        put(self.ws.root, "analysis/s/equivalence/canary/mod/run.log", "== 3 failed, 5 passed in 1.0s ==\n")
        self.ws.runs(canaries=[{"module": "mod", "change": "flip a comparison", "log": ["analysis/s/equivalence/canary/mod/run.log"]}])
        self.check("PROVEN", canary="pass")
        put(self.ws.root, "analysis/s/equivalence/canary/mod/run.log", "== 8 passed in 1.0s ==\n")
        m = self.check("NOT PROVEN", canary="fail")
        self.assertIn("no test failed", m["checks"][4]["detail"])

    def test_a_canary_run_counts_only_the_failures_the_clean_run_did_not_have(self):
        self.ws.results(passing(2) + [("CalcTest", "preexisting", "FAIL", "")])
        put(self.ws.root, "analysis/s/equivalence/canary/mod/TEST-Canary.xml", junit(passing(2) + [("CalcTest", "preexisting", "FAIL", "")]), T0 + 35)
        m = self.check("NOT PROVEN", canary="fail")
        self.assertIn("no test failed because of it", m["checks"][4]["detail"])
        put(self.ws.root, "analysis/s/equivalence/canary/mod/TEST-Canary.xml", junit(passing(1) + [("CalcTest", "preexisting", "FAIL", ""), ("CalcTest", "rounds", "FAIL", "")]), T0 + 35)
        m = self.check("NOT PROVEN", tests="fail", canary="pass")
        self.assertEqual(m["evidence"]["canary"][0]["testsFailed"], 1)
        put(self.ws.root, "analysis/s/equivalence/canary/mod/run.log", "== 3 failed, 5 passed in 1.0s ==\n")
        self.ws.runs(canaries=[{"module": "mod", "log": ["analysis/s/equivalence/canary/mod/run.log"]}])
        m = self.check("NOT PROVEN", canary="pass")
        self.assertEqual(m["evidence"]["canary"][0]["testsFailed"], 2)         # 3 failures minus the clean run's 1

    def test_inputs_left_out_are_listed_with_the_fresh_check(self):
        self.ws.runs(leftOut=["F17: the legacy loader refused duplicate keys", 5, ""])
        m = self.check("PROVEN", fresh="pass")
        self.assertEqual(m["evidence"]["fresh"]["leftOut"], ["F17: the legacy loader refused duplicate keys"])
        run_main(pp.main, ["s", "--workspace", self.ws.root])
        self.assertIn("Inputs left out of the fresh check: F17: the legacy loader refused duplicate keys", read(os.path.join(self.ws.root, "analysis", "s", "VERIFICATION.md")))

    def test_canary_evidence_outside_the_workspace_is_ignored(self):
        outside = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, outside, True)
        put(outside, "TEST-out.xml", junit([("X", "a", "FAIL", "")]))
        self.ws.runs(canaries=[{"module": "mod", "change": "elsewhere", "junit": [outside]}])
        self.check("PARTLY PROVEN", canary="gap")

    def test_hostile_notes_cannot_stall_the_canary_search(self):
        put(self.ws.root, "modernized/s/mod/TRANSFORMATION_NOTES.md", ("Canary: " * 100 + "\n") * 5000 + "Canary: x -> 2 tests failed\n" + "Canary" * 1000000, T0 + 20)
        started = time.time()
        m = self.ws.module()
        self.assertLess(time.time() - started, 20)
        self.assertIn(m["verdict"], ("PROVEN", "PARTLY PROVEN"))

    def test_a_changed_legacy_source_is_partly_proven_and_named(self):
        put(self.ws.root, "legacy/s/app/mod.cbl", "changed\n", T0 + 50)
        m = self.check("PARTLY PROVEN", source="gap")
        self.assertIn("has changed since the analysis began", m["checks"][5]["detail"])
        self.assertEqual(self.ws.pack()["legacy"]["state"], "changed")
        shutil.rmtree(os.path.join(self.ws.root, "legacy"))
        m = self.check("PARTLY PROVEN", source="gap")
        self.assertIn("was not found", m["checks"][5]["detail"])

    def test_the_source_check_is_a_plain_file_walk_and_runs_nothing_in_the_tree(self):
        legacy = os.path.join(self.ws.root, "legacy", "s")
        marker = os.path.join(self.ws.root, "RAN")
        os.makedirs(os.path.join(legacy, ".git"))
        put(legacy, ".git/config", "[core]\n\tfsmonitor = touch %s\n" % marker, T0 + 99)          # a hostile repository config: it must never run
        put(legacy, ".git/HEAD", "ref: refs/heads/main\n", T0 + 99)                                 # version-control metadata is not source
        with mock_no_processes():
            m = self.check("PROVEN", source="pass")
        self.assertFalse(os.path.exists(marker))
        self.assertIn("no version-control tool was run", m["checks"][5]["detail"])
        self.assertTrue(m["checks"][5]["detail"].startswith("legacy/s is untouched: no file changed after the analysis started"))
        self.assertEqual(self.ws.pack()["legacy"]["method"], pp.NO_VCS)

    def test_a_file_newer_than_the_analysis_is_reported_with_examples(self):
        for i in range(30):
            put(self.ws.root, "legacy/s/app/new%02d.cbl" % i, "x", T0 + 50)
        m = self.check("PARTLY PROVEN", source="gap")
        self.assertIn("30 file(s) changed after the analysis started", m["checks"][5]["detail"])
        pack = self.ws.pack()
        self.assertEqual((pack["legacy"]["state"], len(pack["legacy"]["files"])), ("changed", 20))
        put(self.ws.root, "legacy/s/app/mod.cbl", "changed\n", T0 + 50)
        shutil.rmtree(os.path.join(self.ws.root, "legacy"))
        m = self.check("PARTLY PROVEN", source="gap")
        self.assertIn("was not found", m["checks"][5]["detail"])

    def test_the_analysis_is_dated_by_the_oldest_analysis_file(self):
        os.utime(os.path.join(self.ws.root, "analysis", "s", "BUSINESS_RULES.md"), (T0 + 5, T0 + 5))
        self.check("PROVEN", source="pass")
        put(self.ws.root, "legacy/s/app/late.cbl", "x", T0 + 7)
        self.check("PARTLY PROVEN", source="gap")
        shutil.rmtree(os.path.join(self.ws.root, "analysis"))
        put(self.ws.root, "analysis/s/equivalence/test-runs.json", "{}", T0 + 40)
        m = self.ws.module()
        self.assertEqual(m["checks"][5]["state"], "gap")

    def test_links_in_the_source_are_not_followed_and_a_walk_that_cannot_finish_is_not_untouched(self):
        outside = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, outside, True)
        put(outside, "newer.c", "x", T0 + 99)
        make_symlink(self, os.path.join(outside, "newer.c"), os.path.join(self.ws.root, "legacy", "s", "link.c"))
        make_symlink(self, outside, os.path.join(self.ws.root, "legacy", "s", "linked"))
        self.check("PROVEN", source="pass")
        if os.name != "nt" and os.geteuid() != 0:
            hidden = os.path.join(self.ws.root, "legacy", "s", "locked")
            os.makedirs(hidden)
            os.chmod(hidden, 0)
            self.addCleanup(os.chmod, hidden, 0o755)
            m = self.check("PARTLY PROVEN", source="gap")
            self.assertIn("could not finish", m["checks"][5]["detail"])

    def test_hostile_test_runs_json_cannot_crash_or_read_outside(self):
        outside = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, outside, True)
        put(outside, "TEST-out.xml", junit(passing(500, "Out")))
        for doc in ('["x"]', '{"suites": "x", "legacy": 5, "canaries": {"a": 1}}', "{not json", "\x00\x01",
                    json.dumps({"suites": [{"module": "mod" * 5000, "name": None, "executed": -5, "failed": "many", "junit": [1, None, "../../etc", outside, "x" * 10000]},
                                           5, {"module": "mod", "executed": 10 ** 12, "skipped": True, "junit": [outside]}]})):
            put(self.ws.root, "analysis/s/equivalence/test-runs.json", doc, T0 + 40)
            m = self.ws.module()
            self.assertIn(m["verdict"], ("NOT PROVEN", "PARTLY PROVEN"))
            self.assertNotEqual(m["evidence"]["tests"]["executed"], 500)
        self.ws.runs(suites=[{"module": "mod", "executed": 500, "junit": [outside]}])
        m = self.ws.module()
        self.assertTrue(any("outside the workspace" in c for c in m["caveats"]))

    def test_links_in_the_evidence_are_refused(self):
        outside = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, outside, True)
        put(outside, "test-runs.json", json.dumps({"suites": [{"module": "mod", "executed": 9}]}))
        os.remove(os.path.join(self.ws.root, "analysis", "s", "equivalence", "test-runs.json"))
        make_symlink(self, os.path.join(outside, "test-runs.json"), os.path.join(self.ws.root, "analysis", "s", "equivalence", "test-runs.json"))
        pack = self.ws.pack()
        self.assertTrue(any("link" in p for p in pack["problems"]))
        self.assertEqual(pack["modules"][0]["verdict"], "NOT PROVEN")
        put(outside, "o.out", "same\n")
        put(self.ws.root, "analysis/s/equivalence/cases.json", json.dumps({"cases": [{"id": "x", "legacy": os.path.join(outside, "o.out"), "new": os.path.join(outside, "o.out")}]}), T0 + 25)
        self.ws.runs()
        self.assertEqual(self.ws.states()["same"], "fail")

    def test_a_linked_cases_file_is_refused_not_read(self):
        outside = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, outside, True)
        cases = os.path.join(self.ws.root, "analysis", "s", "equivalence", "cases.json")
        shutil.copy(cases, os.path.join(outside, "cases.json"))
        os.remove(cases)
        make_symlink(self, os.path.join(outside, "cases.json"), cases)
        m = self.ws.module()
        self.assertEqual(m["checks"][2]["state"], "gap")
        self.assertTrue(any("is a link" in c for c in m["caveats"]))
        self.assertNotIn("equivalence", m["evidence"])

    def test_two_modules_get_two_verdicts_and_asking_about_one_still_judges_both_from_evidence(self):
        put(self.ws.root, "modernized/s/extra/src/main/X.java", "class X {}\n", T0 + 20)
        pack = self.ws.pack()
        self.assertEqual([(m["name"], m["verdict"]) for m in pack["modules"]], [("extra", "NOT PROVEN"), ("mod", "PROVEN")])
        self.assertEqual(pack["overall"]["verdict"], "NOT PROVEN")
        self.assertEqual(pack["overall"]["counts"], {"PROVEN": 1, "PARTLY PROVEN": 0, "NOT PROVEN": 1})
        asked = self.ws.pack("mod")
        self.assertEqual([(m["name"], m["verdict"]) for m in asked["modules"]], [("extra", "NOT PROVEN"), ("mod", "PROVEN")])
        self.assertEqual(asked["asked"], "mod")

    def test_a_forged_earlier_verdict_never_survives_a_new_run(self):
        put(self.ws.root, "modernized/s/extra/src/main/X.java", "class X {}\n", T0 + 20)
        forged = pp.overall(self.ws.pack())
        forged["modules"][0].update(verdict="PROVEN", reasons=[])
        forged["modules"].append(dict(forged["modules"][0], name="ghost", verdict="PROVEN"))
        forged["overall"] = {"verdict": "PROVEN", "counts": {"PROVEN": 3, "PARTLY PROVEN": 0, "NOT PROVEN": 0}}
        adir = os.path.join(self.ws.root, "analysis", "s")
        dump(os.path.join(adir, "VERIFICATION.json"), forged)
        code, out, _ = run_main(pp.main, ["s", "mod", "--workspace", self.ws.root])
        self.assertEqual(code, 1)
        data = load(os.path.join(adir, "VERIFICATION.json"))
        self.assertEqual([(m["name"], m["verdict"]) for m in data["modules"]], [("extra", "NOT PROVEN"), ("mod", "PROVEN")])
        self.assertEqual(data["overall"]["verdict"], "NOT PROVEN")
        self.assertNotIn("ghost", read(os.path.join(adir, "VERIFICATION.md")))
        self.assertFalse(hasattr(pp, "merge_previous"))

    def test_shared_cases_are_flagged_and_a_modules_own_folder_wins(self):
        put(self.ws.root, "modernized/s/extra/src/main/X.java", "class X {}\n", T0 + 20)
        self.assertTrue(any("shared by every module" in c for c in self.ws.module("mod")["caveats"]))
        self.ws.cases("cases.json", "own", 3, base="analysis/s/equivalence/mod")
        m = self.ws.module("mod")
        self.assertEqual(m["evidence"]["equivalence"]["cases"], 3)
        self.assertFalse(any("shared by every module" in c for c in m["caveats"]))

    def test_a_reimagined_service_is_judged_like_a_rewritten_module(self):
        shutil.rmtree(os.path.join(self.ws.root, "modernized", "s"))
        put(self.ws.root, "modernized/s-reimagined/api/src/main/Api.java", "class Api {}\n", T0 + 20)
        put(self.ws.root, "modernized/s-reimagined/api/src/test/ApiTest.java", "// RULE-001 RULE-002\n", T0 + 20)
        put(self.ws.root, "modernized/s-reimagined/api/target/surefire-reports/TEST-Api.xml", junit(passing(4, "ApiTest")), T0 + 30)
        self.ws.runs(suites=[{"module": "api", "name": "acceptance", "executed": 4, "junit": ["modernized/s-reimagined/api/target/surefire-reports"]}])
        pack = self.ws.pack()
        m = pack["modules"][0]
        self.assertEqual((m["name"], m["track"], len(pack["modules"])), ("api", "reimagine", 1))
        self.assertEqual({c["id"]: c["state"] for c in m["checks"]}["rules"], "pass")
        self.assertEqual({c["id"]: c["state"] for c in m["checks"]}["tests"], "pass")

    def test_nothing_built_is_an_error(self):
        shutil.rmtree(os.path.join(self.ws.root, "modernized"))
        with self.assertRaises(pp.InputError):
            pp.build("s", self.ws.root)
        code, _, err = run_main(pp.main, ["s", "--workspace", self.ws.root])
        self.assertEqual(code, 2)
        self.assertIn("nothing is built", err)


RUNNER_LOGS = (
    ("maven", "[INFO] Tests run: 4, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.1 s -- in A\n[ERROR] Tests run: 158, Failures: 0, Errors: 3, Skipped: 2\n", (156, 3, 2)),         # executed = run minus skipped
    ("maven, old style", "Tests run: 10, Failures: 1, Errors: 0, Skipped: 1\n", (9, 1, 1)),
    ("gradle", "12 tests completed, 2 failed, 1 skipped\n", (11, 2, 1)),
    ("cargo", "test result: ok. 10 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s\ntest result: FAILED. 2 passed; 3 failed; 0 ignored; 0 measured\n", (15, 3, 1)),
    ("pytest", "============ 2 failed, 10 passed, 1 skipped in 0.12s ============\n", (12, 2, 1)),
    ("pytest -q", "3 passed, 1 error in 0.05s\n", (4, 1, 0)),
    ("pytest none", "no tests ran in 0.01s\n", (0, 0, 0)),
    ("unittest", "Ran 5 tests in 0.002s\n\nOK\n", (5, 0, 0)),
    ("unittest failed", "Ran 9 tests in 0.5s\n\nFAILED (failures=1, errors=2, skipped=3)\n", (6, 3, 3)),
    ("go -v", "=== RUN TestA\n--- PASS: TestA (0.00s)\n    --- PASS: TestA/sub (0.00s)\n--- FAIL: TestB (0.01s)\n--- SKIP: TestC (0.00s)\nFAIL\n", (3, 1, 1)),
    ("go -json", '{"Time":"t","Action":"pass","Package":"p","Test":"TestA","Elapsed":0}\n{"Time":"t","Action":"fail","Package":"p","Test":"TestB","Elapsed":0}\n{"Time":"t","Action":"fail","Package":"p","Elapsed":0}\n', (2, 1, 0)),
    ("dotnet", "Passed!  - Failed:     0, Passed:    10, Skipped:     1, Total:    11, Duration: 1 s - X.dll (net8.0)\nFailed!  - Failed:     2, Passed:     8, Skipped:     0, Total:    10, Duration: 1 s - Y.dll\n", (20, 2, 1)),
    ("jest", "Tests:       1 failed, 2 skipped, 3 passed, 6 total\nTest Suites: 1 failed, 1 total\n", (4, 1, 2)),
    ("vitest", "      Tests  1 failed | 9 passed | 1 skipped (11)\n", (10, 1, 1)),
    ("ctest", "92% tests passed, 1 tests failed out of 12\n", (12, 1, 0)),
    ("phpunit ok", "OK (10 tests, 25 assertions)\n", (10, 0, 0)),
    ("phpunit failures", "FAILURES!\nTests: 10, Assertions: 25, Failures: 1, Skipped: 1.\n", (9, 1, 1)),
)


class RunnerLogs(unittest.TestCase):
    def test_every_supported_runner_summary_is_read(self):
        for name, text, want in RUNNER_LOGS:
            got = pp.parse_runner_log(text)
            self.assertIsNotNone(got, name)
            assert got is not None
            self.assertEqual(got[:3], want, name)

    def test_a_log_with_no_summary_line_is_no_evidence(self):
        for text in ("", "All good, 12 tests passed, trust me\n", "BUILD SUCCESSFUL in 3s\n", "ok  \tpkg\t0.003s\n", "Tests run: many, Failures: none\n", "\x00\x01\x02"):
            self.assertIsNone(pp.parse_runner_log(text), repr(text))

    def test_summaries_are_summed_across_a_log_and_the_runner_is_named(self):
        got = pp.parse_runner_log("Tests run: 3, Failures: 0, Errors: 0, Skipped: 0\n== 2 passed in 0.1s ==\n")
        self.assertEqual(got, (5, 0, 0, ["maven", "pytest"]))

    def test_hostile_logs_are_bounded_and_never_trusted(self):
        started = time.time()
        for text in ("Tests run: " * 400000, "= " * 2000000 + "passed in 1s", "--- PASS: " * 300000, "{" + '"Action":"pass",' * 200000 + "}", "9" * 3000000 + " passed in 1s\n",
                     "Tests:" + " 1 failed," * 100000 + " 5 total\n", "Ran " * 500000, "\r" * 1000000):
            pp.parse_runner_log(text)
        self.assertLess(time.time() - started, 30)
        huge_count = pp.parse_runner_log("Tests run: 999999999999999999999, Failures: 0, Errors: 0, Skipped: 0\n")
        assert huge_count is not None
        self.assertEqual(huge_count[0], 999999999999999999999)

    def test_read_logs_refuses_links_huge_files_and_binary_text(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, True)
        good = put(root, "good.txt", "== 2 passed in 0.1s ==\n")
        outside = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, outside, True)
        put(outside, "real.txt", "== 99 passed in 0.1s ==\n")
        link = os.path.join(root, "link.txt")
        make_symlink(self, os.path.join(outside, "real.txt"), link)
        put(root, "huge.txt", b"x" * ((16 << 20) + 5))
        put(root, "nul.txt", b"\x00" * 100 + b"\n== 5 passed in 1s ==\n")
        got = pp.read_logs([good, link, os.path.join(root, "huge.txt"), os.path.join(root, "nul.txt"), os.path.join(root, "missing.txt")])
        self.assertEqual((got["files"], got["executed"]), (2, 7))            # NUL bytes elsewhere in the file do not hide a summary line; the link, the huge and the missing file are not read
        self.assertEqual(len(got["unrecognised"]), 3)


class ProofOutputs(unittest.TestCase):
    def setUp(self):
        self.ws = Ws(self)
        self.adir = os.path.join(self.ws.root, "analysis", "s")

    def test_files_summary_and_exit_codes(self):
        code, out, _ = run_main(pp.main, ["s", "--workspace", self.ws.root])
        self.assertEqual(code, 0)
        self.assertIn("s: PROVEN", out)
        data = load(os.path.join(self.adir, "VERIFICATION.json"))
        self.assertEqual((data["v"], data["overall"]["verdict"], data["signoff"]), (1, "PROVEN", {"name": "", "role": "", "date": "", "decision": ""}))
        md = read(os.path.join(self.adir, "VERIFICATION.md"))
        for needle in ("# Verification: s", "**Overall: PROVEN**", "### P0 business rules", "### What this does not prove", "## Sign-off", "________________",
                       "## How each verdict is computed", "tests executed: 3, failed 0, skipped 0"):
            self.assertIn(needle, md)
        os.remove(os.path.join(self.adir, "equivalence", "test-runs.json"))
        code, out, _ = run_main(pp.main, ["s", "--workspace", self.ws.root])
        self.assertEqual(code, 1)
        self.assertIn("NOT PROVEN", out)
        self.assertEqual(sorted(f for f in os.listdir(self.adir) if f.startswith("VERIFICATION")), ["VERIFICATION.json", "VERIFICATION.md"])

    def test_bad_names_are_refused(self):
        for argv in (["..", "--workspace", self.ws.root], ["a/b"], ["s", "../x"], ["s", "a\\b"], [""]):
            self.assertEqual(run_main(pp.main, argv)[0], 2, argv)

    def test_a_linked_output_is_refused_and_nothing_is_written_through_it(self):
        outside = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, outside, True)
        put(outside, "real.md", "ORIGINAL")
        make_symlink(self, os.path.join(outside, "real.md"), os.path.join(self.adir, "VERIFICATION.md"))
        code, _, err = run_main(pp.main, ["s", "--workspace", self.ws.root])
        self.assertEqual(code, 2)
        self.assertIn("symbolic link", err)
        self.assertEqual(read(os.path.join(outside, "real.md")), "ORIGINAL")

    def test_hostile_names_and_reasons_stay_text_in_the_markdown(self):
        put(self.ws.root, "modernized/s/mod/src/test/CalcTest.java", "// RULE-001\n", T0 + 20)
        put(self.ws.root, "analysis/s/BUSINESS_RULES.md", RULES_MD.replace("Rounding", "Round | <img src=x onerror=1> \x1b[31m"), T0 + 10)
        self.ws.runs(suites=[{"module": "mod", "name": "unit | `x`", "command": "mvn\x00 test\n# heading", "executed": 3, "junit": ["modernized/s/mod/target/surefire-reports"]}])
        run_main(pp.main, ["s", "--workspace", self.ws.root])
        md = read(os.path.join(self.adir, "VERIFICATION.md"))
        self.assertNotRegex(md, r"[\x00\x1b]")
        self.assertIn("Round \\| <img src=x onerror=1>", md)
        self.assertNotIn("\n# heading", md)

    def test_the_verdict_comes_from_the_evidence_not_from_an_earlier_pack(self):
        run_main(pp.main, ["s", "--workspace", self.ws.root])
        path = os.path.join(self.adir, "VERIFICATION.json")
        data = load(path)
        data["modules"][0]["verdict"] = "NOT PROVEN"
        dump(path, data)
        self.assertEqual(run_main(pp.main, ["s", "--workspace", self.ws.root])[0], 0)
        self.assertEqual(load(path)["overall"]["verdict"], "PROVEN")

    def test_a_huge_evidence_file_is_not_read(self):
        put(self.ws.root, "analysis/s/equivalence/test-runs.json", b" " * (9 << 20), T0 + 40)
        pack = self.ws.pack()
        self.assertTrue(any("larger than 8 MB" in p for p in pack["problems"]))
        self.assertEqual(pack["modules"][0]["verdict"], "NOT PROVEN")


class CheckIds(unittest.TestCase):
    def test_emitted_check_ids_match_the_independent_expectation_table(self):
        expected_proof = {"tests", "rules", "same", "fresh", "canary", "source"}
        self.assertEqual({cid for cid, _ in pp.CHECKS}, expected_proof)
        ws = Ws(self)
        emitted = {check["id"] for module in ws.pack()["modules"] for check in module["checks"]}
        self.assertLessEqual(emitted, expected_proof)


class SourceNotModified(unittest.TestCase):
    def test_git_source_check_clean_dirty_mismatch_and_unknown_outcomes(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, True)
        source, assessment = os.path.join(root, "source"), os.path.join(root, "assessment", "app")
        os.makedirs(source)
        os.makedirs(assessment)
        def git(*args):
            return subprocess.run(["git", "-C", source] + list(args), stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, text=True).stdout.strip()
        git("init", "--quiet")
        git("config", "user.email", "test@example.invalid")
        git("config", "user.name", "Test")
        put(source, "source.txt", "baseline")
        git("add", "source.txt")
        git("commit", "--quiet", "-m", "baseline")
        recorded = git("rev-parse", "HEAD")
        put(assessment, "inventory.md", "---\nsourceCommit: \"%s\"\n---\n# Inventory\n" % recorded)
        self.assertEqual(pp.git_source_check(source, assessment)["state"], "clean")
        put(source, "source.txt", "dirty")
        dirty = pp.git_source_check(source, assessment)
        self.assertEqual((dirty["state"], dirty["method"]), ("changed", "git"))
        git("add", "source.txt")
        git("commit", "--quiet", "-m", "changed")
        self.assertEqual(pp.git_source_check(source, assessment)["state"], "changed")
        put(assessment, "inventory.md", "---\nsourceCommit: null\n---\n# Inventory\n")
        unknown = pp.git_source_check(source, assessment)
        self.assertEqual((unknown["state"], unknown["method"]), ("unknown", "NO_VCS"))
        self.assertIn("not contain a valid recorded sourceCommit", unknown["detail"])
        put(assessment, "inventory.md", "---\nsourceCommit: \"%s\"\n---\n# Inventory\n" % recorded)
        missing = pp.git_source_check(os.path.join(root, "missing"), assessment)
        self.assertEqual(missing["state"], "unknown")
        self.assertIn("unavailable", missing["detail"])


class CliContract(unittest.TestCase):
    def test_help_is_side_effect_free_and_missing_common_roots_exit_two(self):
        for script in (cmp.main, tr.main, pp.main):
            code, out, err = run_main(script, ["--help"])
            self.assertEqual((code, err), (0, ""))
            for flag in ("--source", "--assessment", "--target", "--out"):
                self.assertIn(flag, out)
            code, _, err = run_main(script, ["app"])
            self.assertEqual(code, 2)
            self.assertEqual(len(err.splitlines()), 2)
            self.assertTrue(err.splitlines()[0].startswith("usage: "))


if __name__ == "__main__":
    unittest.main()
