#!/usr/bin/env python3
"""Read what a test run left behind: JUnit-style XML, Visual Studio .trx files and a saved raw runner log.

Imported by proof_pack.py and trace_rules.py; it has no command line. Nothing is judged by a model.

Result files: JUnit-style XML (Maven surefire, Gradle, pytest --junitxml, Ant, jest-junit ...) or Visual Studio .trx files.
Give a file or a folder; a folder is searched for result files, links are never followed, and a file that declares a DTD or
entity is refused. A test id is "<classname>#<name>"; a repeated id in one file gets a "~N" suffix in document order (the
first stays plain); the module's own absolute path in a parameterized name is replaced by <MODULE>.

Raw runner logs: the runner's own summary lines (Maven/Gradle, cargo, pytest, unittest, go test, dotnet test, jest, vitest,
ctest, phpunit), summed over the log. A log without a summary line of a known runner is no evidence. Standard library only.
"""
import os
import re
import stat
from typing import Any
from xml.parsers import expat

MAX_FILE, MAX_FILES, MAX_CASES, MAX_DEPTH = 200 << 20, 20000, 2000000, 60
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv"}


def clean(value, limit=200):
    text = " ".join(re.sub(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]", " ", str(value if value is not None else "")).split())
    return text if len(text) <= limit else text[:limit - 1] + "…"


def tally(statuses):
    c = {"pass": 0, "fail": 0, "error": 0, "skip": 0}
    for s in statuses:
        c[s.lower()] += 1
    c["executed"] = c["pass"] + c["fail"] + c["error"]
    return c


# ---------------------------------------------------------------- the fresh results
def refuse(*_):
    raise ValueError("it declares a DTD or an entity, which test results never do")


def parse_results(path):
    """[(classname, name, status, skip message given, suite name)] from one JUnit or TRX file. Raises ValueError."""
    cases, suites, cur, depth = [], [], [], [0]
    trx = {"Passed": "PASS", "Failed": "FAIL", "Error": "ERROR", "Timeout": "ERROR", "Aborted": "ERROR"}

    def start(tag, attrs):
        depth[0] += 1
        if depth[0] > MAX_DEPTH:
            raise ValueError("the XML is nested more than %d levels deep" % MAX_DEPTH)
        if tag == "testsuite":
            suites.append(attrs.get("name", "")[:300])
        elif tag == "testcase":
            if len(cases) >= MAX_CASES:
                raise ValueError("more than %d test cases" % MAX_CASES)
            flag = (attrs.get("status") or attrs.get("result") or "").lower()
            cur[:] = [(attrs.get("classname") or (suites[-1] if suites else ""))[:300], attrs.get("name", "")[:400],
                      "SKIP" if flag in ("skipped", "ignored", "notrun", "notexecuted", "disabled") else "PASS", False]
        elif cur and tag in ("failure", "error", "skipped"):
            if tag == "skipped":
                cur[3] = bool(attrs.get("message", "").strip())
            new = {"failure": "FAIL", "error": "ERROR", "skipped": "SKIP"}[tag]
            if cur[2] == "PASS" or (cur[2] == "SKIP" and new != "SKIP"):
                cur[2] = new
        elif tag == "UnitTestResult":
            name = attrs.get("testName", "")[:400]
            head, sep, tail = name.partition("(")
            klass, dot, method = head.rpartition(".")
            outcome = attrs.get("outcome", "")
            cases.append((klass[:300] if dot else "", (method + sep + tail) if dot else name, trx.get(outcome, "SKIP"), False, ""))

    def end(tag):
        depth[0] -= 1
        if tag == "testcase" and cur:
            cases.append((cur[0], cur[1], cur[2], cur[3], suites[-1] if suites else ""))
            cur.clear()
        elif tag == "testsuite" and suites:
            suites.pop()

    parser = expat.ParserCreate()
    parser.StartDoctypeDeclHandler = refuse
    parser.EntityDeclHandler = refuse
    parser.StartElementHandler = start
    parser.EndElementHandler = end
    try:
        with open(path, "rb") as fh:
            parser.ParseFile(fh)
    except expat.ExpatError as err:
        raise ValueError("the XML is not well formed (%s)" % expat.ErrorString(err.code))
    return cases


def result_files(paths):
    """([files], [problems]) from files and folders. Links are never followed."""
    found, problems = [], []
    for p in paths:
        if os.path.isfile(p) and not os.path.islink(p):
            found.append(p)
        elif os.path.isdir(p) and not os.path.islink(p):
            for base, dirs, names in os.walk(p):
                dirs[:] = [d for d in sorted(dirs) if d not in SKIP_DIRS and not os.path.islink(os.path.join(base, d))]
                for n in sorted(names):
                    full = os.path.join(base, n)
                    if os.path.islink(full) or not n.lower().endswith((".xml", ".trx")):
                        continue
                    try:
                        with open(full, "rb") as fh:
                            head = fh.read(4096)
                    except OSError:
                        continue
                    if b"<testsuite" in head or b"<TestRun" in head:
                        found.append(full)
                if len(found) > MAX_FILES:
                    problems.append("More than %d result files were found; the rest were not read." % MAX_FILES)
                    return found[:MAX_FILES], problems
        else:
            problems.append("%s is not a file or folder that can be read." % clean(p, 120))
    return found, problems


def module_label(path):
    """The module folder a Maven or Gradle report belongs to (its parent of target/ or build/), or ''."""
    parts = os.path.abspath(path).split(os.sep)
    for i in range(len(parts) - 2, 1, -1):
        if parts[i] in ("target", "build") and parts[i + 1] in ("surefire-reports", "failsafe-reports", "test-results"):
            return os.sep.join(parts[:i]) or os.sep
    return ""


def read_results(paths):
    """-> {tests {id: status}, skipReasons {id: bool}, classes, modules, suites, files, unreadable [str], problems [str], oldest, newest}."""
    files, problems = result_files(paths)
    out = {"tests": {}, "skipReasons": {}, "classes": {}, "modules": {}, "suites": {}, "files": 0, "unreadable": [], "problems": problems, "oldest": None, "newest": None}
    for path in files:
        label = clean(os.path.basename(path), 100)
        try:
            if os.path.getsize(path) > MAX_FILE:
                raise ValueError("the file is larger than %d MB" % (MAX_FILE >> 20))
            cases = parse_results(path)
        except (OSError, ValueError) as err:
            out["unreadable"].append("%s: %s" % (label, clean(err, 120)))
            continue
        root = module_label(path)
        roots = sorted({root, os.path.realpath(root), root[len("/private"):] if root.startswith("/private/") else root} - {os.sep}, key=len, reverse=True) if root else []
        seen, mtime = {}, os.path.getmtime(path)
        out["files"] += 1
        out["oldest"] = mtime if out["oldest"] is None else min(out["oldest"], mtime)
        out["newest"] = mtime if out["newest"] is None else max(out["newest"], mtime)
        for klass, name, status, has_reason, suite in cases:
            for r in roots:
                name = name.replace(r, "<MODULE>")
            name = re.sub(r"(test)\d+(\.tmp)", r"\1<N>\2", name)
            base = "%s#%s" % (klass, name) if klass else name
            n = seen.get(base, 0)
            seen[base] = n + 1
            tid = base if n == 0 else "%s~%d" % (base, n)
            out["tests"][tid] = status
            out["skipReasons"][tid] = has_reason
            for key, store in ((klass, out["classes"]), (root and os.path.basename(root), out["modules"]), (suite, out["suites"])):
                if key:
                    store.setdefault(key, []).append(status)
    for store in ("classes", "modules", "suites"):
        out[store] = {k: tally(v) for k, v in out[store].items()}
    return out


# ---------------------------------------------------------------- raw runner logs (a saved run's own summary lines)
LOG_CAP, LOG_LINE = 16 << 20, 2000
NUM_WORD = re.compile(r"(\d+)\s+([A-Za-z]+)")


def words(text):
    """{'passed': 10, 'failed': 2} from '2 failed, 10 passed' style text."""
    out = {}
    for n, w in NUM_WORD.findall(text[:LOG_LINE]):
        out[w.lower()] = out.get(w.lower(), 0) + int(n)
    return out


def _maven(m):
    run, f, e, sk = (int(g) for g in m.groups())
    return max(0, run - f - e - sk), f + e, sk


def _pytest(m):
    w = words(m.group(1))
    return w.get("passed", 0) + w.get("xpassed", 0) + w.get("xfailed", 0), w.get("failed", 0) + w.get("error", 0) + w.get("errors", 0), w.get("skipped", 0)


def _jest(m):
    w = words(m.group(1))
    return w.get("passed", 0), w.get("failed", 0), w.get("skipped", 0)


def _php(m):
    w = {k.lower(): int(v) for k, v in re.findall(r"([A-Za-z]+):\s*(\d+)", m.group(1)[:LOG_LINE])}
    failed, skipped = w.get("failures", 0) + w.get("errors", 0), w.get("skipped", 0) + w.get("incomplete", 0)
    return max(0, w.get("tests", 0) - failed - skipped), failed, skipped


def _ctest(m):
    failed, total = int(m.group(1)), int(m.group(2))
    return max(0, total - failed), failed, 0


def _gradle(m):
    total, failed, skipped = int(m.group(1)), int(m.group(2) or 0), int(m.group(3) or 0)
    return max(0, total - failed - skipped), failed, skipped


# runner, a line pattern, and how to read (passed, failed, skipped) from a match. Every pattern is anchored and bounded.
LOG_LINES = (
    ("maven", re.compile(r"^(?:\[\w+\]\s*)?Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$"), _maven),
    ("gradle", re.compile(r"^(\d+) tests? completed(?:, (\d+) failed)?(?:, (\d+) skipped)?\s*$"), _gradle),
    ("cargo", re.compile(r"^test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored;"), lambda m: (int(m.group(1)), int(m.group(2)), int(m.group(3)))),
    ("pytest", re.compile(r"^(?:=+ )?((?:\d+ [a-z]+(?:, )?)+) in [\d.]+s(?: \([\d:]+\))?(?: =+)?\s*$"), _pytest),
    ("pytest", re.compile(r"^(?:=+ )?no tests ran in [\d.]+s"), lambda m: (0, 0, 0)),
    ("go test", re.compile(r"^\s*--- (PASS|FAIL|SKIP): \S"), lambda m: {"PASS": (1, 0, 0), "FAIL": (0, 1, 0), "SKIP": (0, 0, 1)}[m.group(1)]),
    ("go test -json", re.compile(r'^\{.*"Action":"(pass|fail|skip)".*"Test":"[^"]+"'), lambda m: {"pass": (1, 0, 0), "fail": (0, 1, 0), "skip": (0, 0, 1)}[m.group(1)]),
    ("dotnet test", re.compile(r"^(?:Passed|Failed)!\s+-\s+Failed:\s+(\d+),\s+Passed:\s+(\d+),\s+Skipped:\s+(\d+)"), lambda m: (int(m.group(2)), int(m.group(1)), int(m.group(3)))),
    ("jest", re.compile(r"^\s*Tests:\s+(.*\b\d+ total)\s*$"), _jest),
    ("vitest", re.compile(r"^\s*Tests\s{2,}(.*)\(\d+\)\s*$"), _jest),
    ("ctest", re.compile(r"^\d+% tests passed, (\d+) tests? failed out of (\d+)"), _ctest),
    ("phpunit", re.compile(r"^OK \((\d+) tests?, \d+ assertions?\)"), lambda m: (int(m.group(1)), 0, 0)),
    ("phpunit", re.compile(r"^(Tests: \d+, Assertions: \d+.*?)\.?\s*$"), _php),
)
UNITTEST_RAN = re.compile(r"^Ran (\d+) tests? in [\d.]+s\s*$")
UNITTEST_END = re.compile(r"^(?:OK|FAILED)(?: \(([^)]*)\))?\s*$")


def parse_runner_log(text) -> tuple[int, int, int, list[str]] | None:
    """(executed, failed, skipped, runners) from the runner's own summary lines, summed over the log; None when no line is recognised.
    Recognised: Maven/Gradle, cargo, pytest, unittest, go test (-v or -json), dotnet test, jest, vitest, ctest, phpunit."""
    passed = failed = skipped = 0
    seen, ran = [], None
    for line in text.split("\n")[:3000000]:
        line = line.rstrip("\r")[:LOG_LINE]
        if ran is not None and line.strip():
            m = UNITTEST_END.match(line)
            if m:
                w = {k: int(v) for k, v in re.findall(r"(\w+)=(\d+)", (m.group(1) or "")[:LOG_LINE])}
                f, sk = w.get("failures", 0) + w.get("errors", 0), w.get("skipped", 0)
                passed, failed, skipped = passed + max(0, ran - f - sk), failed + f, skipped + sk
                seen.append("unittest")
            ran = None
        m = UNITTEST_RAN.match(line)
        if m:
            ran = int(m.group(1))
            continue
        for name, rx, read in LOG_LINES:
            m = rx.match(line)
            if m:
                p, f, sk = read(m)
                passed, failed, skipped = passed + p, failed + f, skipped + sk
                seen.append(name)
                break
    return (passed + failed, failed, skipped, sorted(set(seen))) if seen else None


def read_logs(paths) -> dict[str, Any]:
    """Saved runner logs -> {"files", "executed", "failed", "skipped", "runners", "oldest", "newest", "unrecognised"}. A log without a summary line of a known runner is no evidence."""
    out: dict[str, Any] = {"files": 0, "executed": 0, "failed": 0, "skipped": 0, "runners": [], "oldest": None, "newest": None, "unrecognised": []}
    for path in paths:
        try:
            st = os.lstat(path)
            if not stat.S_ISREG(st.st_mode) or st.st_size > LOG_CAP:
                out["unrecognised"].append("%s (a link, not a file, or larger than %d MB)" % (clean(os.path.basename(path), 80), LOG_CAP >> 20))
                continue
            with open(path, "rb") as fh:
                got = parse_runner_log(fh.read(LOG_CAP).decode("utf-8", "replace"))
        except OSError:
            out["unrecognised"].append("%s (could not be read)" % clean(os.path.basename(path), 80))
            continue
        if got is None:
            out["unrecognised"].append("%s (no summary line of a runner this script knows)" % clean(os.path.basename(path), 80))
            continue
        out["files"] += 1
        out["executed"], out["failed"], out["skipped"] = out["executed"] + got[0], out["failed"] + got[1], out["skipped"] + got[2]
        out["runners"] = sorted(set(out["runners"]) | set(got[3]))
        out["oldest"] = st.st_mtime if out["oldest"] is None else min(out["oldest"], st.st_mtime)
        out["newest"] = st.st_mtime if out["newest"] is None else max(out["newest"], st.st_mtime)
    return out
