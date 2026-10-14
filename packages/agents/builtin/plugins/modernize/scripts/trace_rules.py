#!/usr/bin/env python3
"""Trace every business rule to the code and the tests that name it, and to the tests that ran.

    python3 trace_rules.py <app> --source <checkout> --assessment <assessment/app> \\
        --target <checkout> --out <folder> [--module NAME] [--runs <run-folder> ...]

Reads assessment/<app>/BUSINESS_RULES.md (rule cards: "### RULE-NNN: name" with **Priority:**,
**Confidence:** and **Source:** lines), then scans the read-only target checkout (never build output:
target/, build/, dist/, node_modules/, bin/, obj/, __pycache__/, or any folder starting with a dot) for
mentions of each rule id, and sorts every file into "test" or "main" code. One row per rule.

Evidence, strongest first:
  tested          executed evidence backs it, from the per-test results of that run (JUnit or TRX XML; --runs
                  reads them here, the proof pack passes them in): a test that ran and passed names the rule in
                  its test or class name, or a test file names it on a line not marked skipped and that file's
                  name is the class or file of a test that ran and passed. Without per-test results nothing is
                  "tested"
  named, not run  a test file names it, but nothing that ran backs it: the test is skipped, pending or failing,
                  its class never ran, or no per-test results were given
  code only       only main code names it
  claimed only    only the mapping table in TRANSFORMATION_NOTES.md or UPLIFT_NOTES.md names it, on a
                  row that also names a file that exists in the module
  none            nothing names it

A mention is RULE-017 (any case, or RULE_017), rule017 or Rule017 inside an identifier such as
rule017_emptyInput or testRule017, and the shorthand RULE-002/003 and RULE-001, -018. Nothing is
guessed from words. A line is marked skipped when it, or one of the 3 lines above it, holds @Disabled,
@Ignore, [Ignore], #[ignore], xit(, xdescribe, skip (so also @Skip, t.Skip, it.skip, test.skip,
describe.skip and @pytest.mark.skip), pending or todo, in any case. A mention shows that a test names
the rule, not that the test is good.

A test is a file under a folder called test, tests, __tests__, spec or specs, or named like
FooTest.java, FooTests.cs, TestFoo.java, test_foo.py, foo_test.go, foo.spec.ts or foo.test.js.
Documentation files (.md, .txt, .rst, .adoc) are never code. Symbolic links are never followed.
A built folder that holds only test files and the files that build them (pom.xml, mvnw, package.json,
...) is test tooling, not a module: tooling_only() says so.
Everything read is untrusted text: it is never executed and only shortened, never trusted.

Exit 0 when every P0 rule is "tested", 1 when some are not, 2 when the rules file cannot be read.
Standard library only.
"""
import argparse
import bisect
import collections
import json
import os
import re
import sys
from typing import Any

SKIP_DIRS = {"target", "build", "dist", "node_modules", "bin", "obj", "__pycache__", "venv"}
DOC_EXT = {".md", ".markdown", ".rst", ".txt", ".adoc"}
TEST_DIRS = {"test", "tests", "__tests__", "spec", "specs"}
TEST_NAME = re.compile(r"^test_|_tests?\.[^.]+$|\.(?:spec|test)\.[^.]+$|(?:Test|Tests|TestCase|IT)\.[^.]+$|^Test[A-Z0-9_]")
NOTES_NAMES = ("TRANSFORMATION_NOTES.md", "UPLIFT_NOTES.md")
TRACKS = (("rewrite", ""), ("uplift", "-uplifted"), ("reimagine", "-reimagined"))
FILE_CAP, RULES_CAP, NOTES_CAP, LINE_CAP, MAX_FILES, SAMPLES = 2 << 20, 8 << 20, 1 << 20, 4000, 200000, 3
MENTION = [re.compile(r"(?<![A-Za-z0-9])rule[-_](\d{1,6})(?!\d)", re.I),
           re.compile(r"(?<![A-Za-z0-9])rule(\d{3,6})(?!\d)", re.I),
           re.compile(r"(?<=[a-z])Rule[-_]?(\d{3,6})(?!\d)")]
MORE = re.compile(r"(?:/|,[ \t]*-)(\d{2,6})(?!\d)")
NOT_A_CLAIM = re.compile(r"(?i)not migrated|not implemented|not ported|removed|retired|dead code|dropped|out of scope")
CARD = re.compile(r"#{2,5}[ \t]+[*`\[]*RULE[-_](\d{1,6})(?![A-Za-z0-9])", re.I)
FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
PATH = re.compile(r"[A-Za-z0-9_@][A-Za-z0-9_@./+-]{0,199}\.[A-Za-z][A-Za-z0-9]{0,7}(?![A-Za-z0-9_])")
SKIPPED_LINE = re.compile(r"@Disabled|@Ignore|\[Ignore\]|#\[ignore\]|xit\(|xdescribe|skip|pending|todo", re.I)    # "skip" also covers @Skip, t.Skip, it.skip, test.skip, describe.skip, @pytest.mark.skip
MARK_LINES = 3                          # a mention is skipped when its own line, or one of this many lines above it, holds a marker
NOT_RUN = "named, not run"
NO_RUN: dict[str, Any] = {"known": False, "ids": frozenset(), "keys": frozenset()}
TOOLING_NAMES = {"pom.xml", "mvnw", "mvnw.cmd", "gradlew", "gradlew.bat", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts", "gradle.properties",
                 "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "pytest.ini", "tox.ini", "setup.cfg", "pyproject.toml", "uv.lock", "poetry.lock", "conftest.py",
                 "cargo.toml", "cargo.lock", "go.mod", "go.sum", "composer.json", "composer.lock", "phpunit.xml", "phpunit.xml.dist", "cmakelists.txt", "makefile", "dockerfile"}
TOOLING_EXT = {".csproj", ".sln", ".props", ".targets", ".runsettings"}
TOOLING_PATTERN = re.compile(r"tsconfig[\w.-]*\.json|[\w-]+\.config\.(?:js|cjs|mjs|ts)|docker-compose[\w.-]*\.ya?ml")


def clean(value, limit=200):
    text = " ".join(re.sub(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]", " ", str(value if value is not None else "")).split())
    return text if len(text) <= limit else text[:limit - 1] + "\u2026"


def read_text(path, cap):
    """Text of a regular, non-binary file (first `cap` bytes), or None."""
    try:
        with open(path, "rb") as fh:
            raw = fh.read(cap)
    except OSError:
        return None
    return None if b"\x00" in raw[:4096] else raw.decode("utf-8", "replace")


def find_ids(text):
    """[(rule number, offset)] for every id named in text, shorthand included."""
    found = []
    for rx in MENTION:
        for m in rx.finditer(text):
            found.append((int(m.group(1)), m.start()))
            pos = m.end()
            more = MORE.match(text, pos)
            while more:
                found.append((int(more.group(1)), m.start()))
                pos = more.end()
                more = MORE.match(text, pos)
    return found


def class_keys(name):
    """The lower-case names a test class goes by in a result file, for matching a test file's name (without its extension): the last two
    parts of a dotted, slashed or $-nested name (a Python module and its class, a Java class), the outermost class of a nested one and,
    for a file path, its file name with and without the extension."""
    text = str(name if name is not None else "")[:400]
    parts = [p for p in re.split(r"[.$:/\\]+", text) if p]
    outer = [p for p in re.split(r"[.:/\\]+", text.split("$")[0]) if p]
    keys = {p.lower() for p in parts[-2:] + outer[-1:]}
    if "/" in text or "\\" in text:
        base = re.split(r"[/\\]", text)[-1]
        keys.update((base.lower(), os.path.splitext(base)[0].lower()))
    return keys


def run_evidence(results):
    """What ran for one module, from its parsed results (baseline_diff.read_results, one per suite): {"known", "ids", "keys"}.
    known: some result lists its tests one by one (a count, or a summary line of a log, names no test).
    ids: the rule numbers named by the test name or class name of a test that ran and passed.
    keys: class_keys of every class that has a test that ran and passed."""
    out = {"known": False, "ids": set(), "keys": set()}
    for res in results:
        if not res or not res.get("tests"):
            continue
        out["known"] = True
        for tid, status in res["tests"].items():
            if status == "PASS" and "rule" in tid.lower():
                out["ids"].update(n for n, _ in find_ids(tid))
        for klass, c in (res.get("classes") or {}).items():
            if c.get("pass"):
                out["keys"] |= class_keys(klass)
    return out


def line_marks(body: str) -> tuple[list[int], list[bool]]:
    """([offset where each line starts], [whether the line holds a skip marker]) for one test file's text."""
    starts, flags, pos = [], [], 0
    for line in body.split("\n"):
        starts.append(pos)
        flags.append(SKIPPED_LINE.search(line) is not None)
        pos += len(line) + 1
    return starts, flags


def is_live(marks: tuple[list[int], list[bool]], at: int) -> bool:
    """True when the mention at text offset `at` is not marked skipped: its own line and the 3 lines above hold no marker."""
    starts, flags = marks
    i = bisect.bisect_right(starts, at) - 1
    return not any(flags[max(0, i - MARK_LINES):i + 1])


def field(lines, name):
    """The value of a "**Name:** value" line, or ''. Linear in the line length whatever the line holds."""
    for line in lines:
        s = line[:LINE_CAP].lstrip(" \t>*-")
        if s[:len(name)].lower() == name.lower():
            rest = s[len(name):].lstrip("*").lstrip(" \t")
            if rest.startswith(":"):
                return rest[1:].lstrip(" \t*").strip()
    return ""


def parse_rules(text):
    """-> ([rule dicts in file order], [notes]). A duplicate id keeps its first card."""
    rules: list[dict[str, Any]] = []
    notes: list[str] = []
    seen: set[int] = set()
    card: dict[str, Any] | None = None
    fence = ""
    rows: dict[int, dict[str, str]] = {}
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    for line in lines:
        if line.lstrip().startswith("|"):
            cells = [re.sub(r"[*`]", "", c).strip() for c in line[:LINE_CAP].strip().strip("|").split("|")]
            ids = [int(m.group(1)) for c in cells for m in [re.fullmatch(r"RULE[-_](\d{1,6})", c, re.I)] if m]
            if ids:
                rows.setdefault(ids[0], {"p": next((c for c in cells if re.fullmatch(r"P\d", c)), ""),
                                         "c": next((c for c in cells if re.match(r"(?i)(high|medium|low)\b", c)), "")})
    for line in lines:
        f = FENCE.match(line)
        if fence:
            fence = "" if f and f.group(1)[0] == fence[0] and len(f.group(1)) >= len(fence) else fence
            if card is not None:
                card["body"].append(line)
            continue
        if f:
            fence = f.group(1)
        m = None if f else CARD.match(line[:LINE_CAP])
        if not f and re.match(r"#{1,6}\s", line):
            card = None
        if m:
            n = int(m.group(1))
            if n in seen:
                notes.append("RULE-%03d has more than one card; the first was used." % n)
                continue
            seen.add(n)
            name = line[m.end():LINE_CAP].lstrip("*`] \t:\u00b7\u2013\u2014-").rstrip("# \t")
            card = {"n": n, "id": "RULE-%03d" % n, "name": clean(name, 160), "body": []}
            rules.append(card)
        elif card is not None:
            card["body"].append(line)
    for r in rules:
        body = r.pop("body")
        prio = re.search(r"\bP\d\b", field(body, "Priority"))
        conf = re.search(r"(?i)\b(high|medium|low)\b", field(body, "Confidence"))
        row = rows.get(r["n"], {})
        source = field(body, "Source")
        first = PATH.search(source)
        r.update({"priority": prio.group(0) if prio else row.get("p", ""),
                  "confidence": conf.group(1).capitalize() if conf else row.get("c", "").capitalize()[:10],
                  "source": clean(source, 160), "sourceFile": os.path.basename(first.group(0)) if first else ""})
    return rules, notes


def file_kind(rel):
    parts = rel.split("/")
    name = parts[-1]
    if os.path.splitext(name)[1].lower() in DOC_EXT:
        return "doc"
    if any(p.lower() in TEST_DIRS for p in parts[:-1]) or TEST_NAME.search(name):
        return "test"
    return "main"


def is_real_dir(path):
    return os.path.isdir(path) and not os.path.islink(path)


def discover_modules(workspace, system, target_root=None, module_name=None):
    """[{name, track, path, rel}] for every built module."""
    if target_root is not None:
        try:
            subs = sorted(d for d in os.listdir(target_root) if not d.startswith(".") and d not in SKIP_DIRS and is_real_dir(os.path.join(target_root, d)))
        except OSError:
            subs = []
        files, _, _ = walk_module(target_root, MAX_FILES)
        if not files:
            return []
        # A checkout with a conventional source tree is one module; a module workspace
        # without a root source tree is a set of immediate module directories.
        if not subs or any(d.lower() in ("src", "source", "app") for d in subs):
            label = module_name or system
            return [{"name": label, "track": "rewrite", "path": target_root, "rel": label}]
        module_dirs = []
        for name in subs:
            path = os.path.join(target_root, name)
            try:
                child_dirs = os.listdir(path)
                has_source_tree = any(d.lower() in ("src", "source", "app") and is_real_dir(os.path.join(path, d)) for d in child_dirs)
                has_root_code = any(os.path.isfile(os.path.join(path, f)) and file_kind(f) == "main" for f in child_dirs)
            except OSError:
                continue
            if has_source_tree or has_root_code:
                module_dirs.append(name)
        if not module_dirs:
            label = module_name or system
            return [{"name": label, "track": "rewrite", "path": target_root, "rel": label}]
        candidates = [{"name": d, "track": "rewrite", "path": os.path.join(target_root, d), "rel": d} for d in module_dirs]
        return [m for m in candidates if m["name"].lower() == module_name.lower()] if module_name else candidates
    out = []
    for track, suffix in TRACKS:
        root = os.path.join(workspace, "modernized", system + suffix)
        if not is_real_dir(root):
            continue
        rel = "modernized/" + system + suffix
        if track == "uplift":
            out.append({"name": system + suffix, "track": track, "path": root, "rel": rel})
            continue
        try:
            subs = sorted(d for d in os.listdir(root) if not d.startswith(".") and d not in SKIP_DIRS and is_real_dir(os.path.join(root, d)))
        except OSError:
            subs = []
        for d in subs:
            out.append({"name": d, "track": track, "path": os.path.join(root, d), "rel": rel + "/" + d})
        if not subs:
            out.append({"name": system + suffix, "track": track, "path": root, "rel": rel})
    return out


def walk_module(path, budget):
    """([(relative posix path, absolute path)] of regular files, links skipped, cut short)."""
    files, skipped = [], 0
    for base, dirs, names in os.walk(path):
        keep = []
        for d in sorted(dirs):
            if d.startswith(".") or d in SKIP_DIRS:
                continue
            if os.path.islink(os.path.join(base, d)):
                skipped += 1
                continue
            keep.append(d)
        dirs[:] = keep
        for n in sorted(names):
            full = os.path.join(base, n)
            if os.path.islink(full):
                skipped += 1
            elif not n.startswith(".") and os.path.isfile(full):
                if len(files) >= budget:
                    return files, skipped, True
                files.append((os.path.relpath(full, path).replace(os.sep, "/"), full))
    return files, skipped, False


def is_tooling(name):
    """A file that builds or runs code without being code: pom.xml, mvnw, package.json, conftest.py, *.csproj, ..."""
    low = name.lower()
    return low in TOOLING_NAMES or os.path.splitext(low)[1] in TOOLING_EXT or TOOLING_PATTERN.fullmatch(low) is not None


def tooling_only(path):
    """True when a built folder holds test code and the files that build or run it, and nothing else that is not a document: at least
    one test file, no main code. A file this does not recognise counts as main code, so a folder is only left out when it is clear."""
    files, _, cut = walk_module(path, MAX_FILES)
    tests = 0
    for rel, _ in files:
        kind = file_kind(rel)
        if kind == "test":
            tests += 1
        elif kind == "main" and not is_tooling(rel.rsplit("/", 1)[-1]):
            return False
    return tests > 0 and not cut


def claims_of(notes, names):
    """(rule numbers claimed, rule rows naming no existing file, basenames of every file the notes name).
    A row claims a rule only when it names the rule AND a file that exists in the module."""
    claimed, unresolved, named, head = set(), 0, set(), ""
    for line in notes.split("\n"):
        line = line[:LINE_CAP]
        tokens = PATH.findall(line)
        named.update(os.path.basename(t) for t in tokens)
        if line.startswith("#"):
            head = line.lstrip("#").strip()
        if not line.lstrip().startswith("|") or NOT_A_CLAIM.search(head):      # a table under "Not migrated" claims nothing
            continue
        ids = {n for n, _ in find_ids(line)}
        if not ids:
            continue
        if any(os.path.basename(t) in names and any(p == t or p.endswith("/" + t) for p in names[os.path.basename(t)]) for t in tokens):
            claimed |= ids
        else:
            unresolved += 1
    return claimed, unresolved, named


def status_of(main, tests, claimed, ran=False):
    """A rule's status. `ran`: executed evidence backs it. A test file that names it without that evidence is "named, not run"."""
    return "tested" if ran else NOT_RUN if tests else "code only" if main else "claimed only" if claimed else "none"


def blank():
    """`tests`: mentions in test files; `live`: those not marked skipped; `by`: how executed evidence backs the rule ("test name", "test file") or ''; `at`: the first
    unskipped mention in a test file that ran (file:line), the one that backs it."""
    return {"main": 0, "tests": 0, "live": 0, "claimed": False, "named": False, "by": "", "at": ""}


def trace(workspace, system, ran: dict[str, dict[str, Any]] | None = None, assessment_dir=None, target_dir=None, module_name=None):
    """-> the trace. Raises OSError when BUSINESS_RULES.md cannot be read.
    ran: {module folder (as "path" in the modules list): run_evidence(...)}: what ran, per module. Without it no rule is "tested"."""
    assessment_was_explicit = assessment_dir is not None
    assessment_dir = assessment_dir or os.path.join(workspace, "analysis", system)
    rules_path = os.path.join(assessment_dir, "BUSINESS_RULES.md")
    if os.path.islink(rules_path):
        raise OSError("BUSINESS_RULES.md is a symbolic link")
    text = read_text(rules_path, RULES_CAP)
    if text is None:
        raise OSError("BUSINESS_RULES.md is missing or is not text")
    rules, notes = parse_rules(text)
    by_n = {r["n"]: r for r in rules}
    per = {r["n"]: {} for r in rules}
    samples = {r["n"]: {"main": [], "tests": []} for r in rules}
    modules, budget = [], MAX_FILES
    scan = {"files": 0, "textFiles": 0, "linksSkipped": 0, "cut": False}
    for mod in discover_modules(workspace, system, target_dir, module_name):
        files, skipped, cut = walk_module(mod["path"], budget)
        budget -= len(files)
        names = collections.defaultdict(list)
        for rel, _ in files:
            names[os.path.basename(rel)].append(rel)
        notes_name = next((n for n in NOTES_NAMES if n in names[n]), "")
        claimed, unresolved, named = set(), 0, set()
        if notes_name:
            ntext = read_text(os.path.join(mod["path"], notes_name), NOTES_CAP)
            if ntext is not None:
                claimed, unresolved, named = claims_of(ntext, names)
        ev: dict[str, Any] = (ran or {}).get(mod["rel"]) or NO_RUN
        test_files = 0
        for rel, full in files:
            kind = file_kind(rel)
            if kind == "doc":
                continue
            key = "tests" if kind == "test" else "main"
            test_files += kind == "test"
            body = read_text(full, FILE_CAP)
            scan["textFiles"] += body is not None
            hits = [(n, None) for n, _ in find_ids(os.path.basename(rel))] + [(n, at) for n, at in find_ids(body or "")]
            # a test file backs the rules it names (on lines not marked skipped) when its name is the class or file of a test that ran and passed here
            marks: tuple[list[int], list[bool]] | None = None
            backed = kind == "test" and bool(ev.get("known")) and os.path.splitext(os.path.basename(rel))[0].lower() in (ev.get("keys") or ())
            for n, at in hits:
                if n not in by_n:
                    continue
                slot = per[n].setdefault(mod["rel"], blank())
                slot[key] += 1
                if kind == "test":
                    line_number = 0
                    live = True
                    if at is not None:
                        if marks is None:
                            marks = line_marks(body or "")
                        line_number = bisect.bisect_right(marks[0], at)
                        live = is_live(marks, at)
                    if live:
                        slot["live"] += 1
                        if backed and not slot["by"]:
                            slot["by"], slot["at"] = "test file", "%s/%s:%d" % (mod["rel"], rel, line_number)
                place = "%s/%s" % (mod["rel"], rel)
                if len(samples[n][key]) < SAMPLES and not any(s.rsplit(":", 1)[0] == place for s in samples[n][key]):
                    samples[n][key].append("%s:%d" % (place, 0 if at is None else body.count("\n", 0, at) + 1))
        for n in (ev.get("ids") or ()):
            if n in by_n:
                per[n].setdefault(mod["rel"], blank())["by"] = "test name"
        for n in claimed & set(by_n):
            per[n].setdefault(mod["rel"], blank())["claimed"] = True
        for r in rules:
            if r["sourceFile"] and r["sourceFile"] in named:
                per[r["n"]].setdefault(mod["rel"], blank())["named"] = True
        scan["files"] += len(files)
        scan["linksSkipped"] += skipped
        scan["cut"] = scan["cut"] or cut
        modules.append({"name": mod["name"], "track": mod["track"], "path": mod["rel"], "files": len(files), "testFiles": test_files,
                        "notes": notes_name, "claimRowsUnresolved": unresolved})
    out = []
    for r in rules:
        slots = per[r["n"]]
        main, tests_n = sum(s["main"] for s in slots.values()), sum(s["tests"] for s in slots.values())
        claim = any(s["claimed"] for s in slots.values())
        out.append({"id": r["id"], "name": r["name"], "priority": r["priority"], "confidence": r["confidence"], "source": r["source"],
                    "main": main, "tests": tests_n, "claimed": claim, "status": status_of(main, tests_n, claim, any(s["by"] for s in slots.values())),
                    "perModule": slots, "samples": samples[r["n"]]})
    if scan["cut"]:
        notes.append("More than %d files were found, so the scan stopped early." % MAX_FILES)
    if scan["linksSkipped"]:
        notes.append("%d symbolic link(s) were not followed." % scan["linksSkipped"])
    if not modules:
        notes.append("No built code was found in the target checkout." if target_dir else "No built code was found under modernized/%s, %s-uplifted or %s-reimagined." % (system, system, system))
    rules_file = "assessment/%s/BUSINESS_RULES.md" % system if assessment_was_explicit else "analysis/%s/BUSINESS_RULES.md" % system
    return {"system": clean(system, 100), "rulesFile": rules_file, "modules": modules, "rules": out,
            "totals": totals(out), "p0NoTests": [r["id"] for r in out if r["priority"] == "P0" and r["status"] != "tested"],
            "scan": scan, "notes": notes}


def totals(rows):
    """Per priority: rules, and how many are tested / named, not run / code only / claimed only / none."""
    out = {}
    for r in rows:
        t = out.setdefault(r["priority"] or "unrated", {"rules": 0, "tested": 0, NOT_RUN: 0, "code only": 0, "claimed only": 0, "none": 0})
        t["rules"] += 1
        t[r["status"]] += 1
    return dict(sorted(out.items()))


def module_row(r, slot):
    """A rule as one module sees it: the module's own counts and the status they give."""
    return dict(r, main=slot["main"], tests=slot["tests"], live=slot["live"], claimed=slot["claimed"], by=slot["by"], at=slot["at"],
                status=status_of(slot["main"], slot["tests"], slot["claimed"], bool(slot["by"])))


def module_view(result, rel):
    """The rules one module answers for, each with the module's own status. A rewrite answers for the rules its code,
    tests or notes name, that a test of its run names, or whose legacy file its notes name; an uplift keeps the whole
    code, so it answers for all. When nothing ties any rule to the module, every rule counts (`tied` is then False):
    an empty list must never pass. `p0NoTests` lists the P0 rules that are not "tested": no executed test backs them."""
    mod = next((m for m in result["modules"] if m["path"] == rel), None)
    rows, tied = [], True
    for r in result["rules"]:
        slot = r["perModule"].get(rel) or blank()
        if mod and (mod["track"] == "uplift" or slot["main"] or slot["tests"] or slot["claimed"] or slot["named"] or slot["by"]):
            rows.append(module_row(r, slot))
    if mod and not rows and result["rules"]:
        tied = False
        rows = [module_row(r, r["perModule"].get(rel) or blank()) for r in result["rules"]]
    return {"rows": rows, "totals": totals(rows), "outOfScope": len(result["rules"]) - len(rows), "tied": tied,
            "p0NoTests": [r["id"] for r in rows if r["priority"] == "P0" and r["status"] != "tested"]}


def render(result, everything=False, view=None, module=None):
    """The matrix as text. With `view` (from module_view) only the rules that module answers for are listed."""
    rows = view["rows"] if view else result["rules"]
    tot = view["totals"] if view else result["totals"]
    missing = view["p0NoTests"] if view else result["p0NoTests"]
    scanned = ", ".join("%s (%d files, %d test)" % (clean(m["name"], 60), m["files"], m["testFiles"]) for m in result["modules"]
                        if not module or m["name"] == module) or "nothing built yet"
    head = "Rule trace for %s%s: %d rule(s) in %s" % (result["system"], ", module " + clean(module, 60) if module else "", len(result["rules"]), result["rulesFile"])
    lines = [head, "Scanned: " + scanned]
    if view:
        lines.append("Counted for this module: %d rule(s)%s" % (len(rows), "" if view["tied"] else " (nothing ties a rule to it by name, so every rule counts)"))
    lines.append("")
    for p, c in tot.items():
        lines.append("%-7s %3d rules: %d tested, %d named not run, %d code only, %d claimed only, %d none" % (p, c["rules"], c["tested"], c[NOT_RUN], c["code only"], c["claimed only"], c["none"]))
    lines += ["", "%-9s %-4s %-7s %5s %5s  %s" % ("Rule", "Pri", "Conf", "Code", "Tests", "Status")]
    shown = [r for r in rows if everything or r["priority"] == "P0"] + ([] if everything else [r for r in rows if r["priority"] != "P0"][:40])
    for r in shown:
        lines.append("%-9s %-4s %-7s %5d %5d  %s  %s" % (r["id"], r["priority"] or "-", r["confidence"] or "-", r["main"], r["tests"], r["status"], clean(r["name"], 60)))
    if len(shown) < len(rows):
        lines.append("... %d more rule(s) not listed (use --all)" % (len(rows) - len(shown)))
    lines += ["", "P0 rules with no test that ran and passed behind them: " + (", ".join(missing) if missing else "none")]
    lines += ["Note: " + n for n in result["notes"]]
    return "\n".join(lines)


def checked_directory(label, value):
    path = os.path.abspath(value)
    if os.path.islink(path) or not os.path.isdir(path):
        raise ValueError("%s must be an existing directory, not a symbolic link" % label)
    return os.path.realpath(path)


def prepare_output(path, *roots):
    path = os.path.abspath(path)
    if os.path.lexists(path) and os.path.islink(path):
        raise ValueError("--out must not be a symbolic link")
    resolved = os.path.realpath(path)
    for root in roots:
        try:
            if os.path.commonpath([root, resolved]) == root:
                raise ValueError("--out must not be inside a source or target checkout")
        except ValueError as err:
            if str(err).startswith("--out"):
                raise
    os.makedirs(path, exist_ok=True)
    resolved = os.path.realpath(path)
    for root in roots:
        try:
            if os.path.commonpath([root, resolved]) == root:
                raise ValueError("--out must not be inside a source or target checkout")
        except ValueError as err:
            if str(err).startswith("--out"):
                raise
    return resolved


def main(argv=None):
    ap = argparse.ArgumentParser(description="Trace the application's business rules to source code and test evidence.",
                                 usage="%(prog)s app --source DIR --assessment DIR --target DIR --out DIR [options]",
                                 formatter_class=lambda prog: argparse.HelpFormatter(prog, width=140))
    ap.add_argument("app", help="application label used in the trace")
    ap.add_argument("--source", required=True, metavar="CHECKOUT", help="read-only source checkout")
    ap.add_argument("--assessment", required=True, metavar="DIR", help="assessment/<app> evidence directory")
    ap.add_argument("--target", required=True, metavar="CHECKOUT", help="target checkout to scan")
    ap.add_argument("--out", required=True, metavar="DIR", help="folder for RULE_TRACE.json")
    ap.add_argument("--runs", action="append", default=[], metavar="DIR", help="test-result file or folder from a run of the target (repeatable)")
    ap.add_argument("--json", action="store_true", help="print the full trace as JSON")
    ap.add_argument("--all", action="store_true", help="list every rule, not just P0 and the first 40 others")
    ap.add_argument("--module", metavar="NAME", help="label for the target module in the trace")
    args = ap.parse_args(argv)
    if not args.app or args.app in (".", "..") or os.path.basename(args.app) != args.app or chr(0) in args.app:
        print("trace_rules.py: app must be a plain application label, not a path", file=sys.stderr)
        return 2
    if args.runs and not args.module:
        print("trace_rules.py: --runs requires --module so result evidence has an owner", file=sys.stderr)
        return 2
    try:
        source = checked_directory("--source", args.source)
        assessment = checked_directory("--assessment", args.assessment)
        target = checked_directory("--target", args.target)
        out = prepare_output(args.out, source, target)
        for run_path in args.runs:
            if os.path.islink(os.path.abspath(run_path)) or not os.path.exists(run_path):
                raise ValueError("--runs must name an existing file or directory and must not be a symbolic link")
    except (OSError, ValueError) as err:
        print("trace_rules.py: %s" % err, file=sys.stderr)
        return 2
    module = args.module or args.app
    modules = discover_modules(os.path.dirname(assessment), args.app, target, args.module)
    if args.module and not modules:
        print("trace_rules.py: no built module called %s" % clean(args.module, 60), file=sys.stderr)
        return 2
    run_key = modules[0]["rel"] if args.module and modules else module
    ran, read_notes = None, []
    if args.runs:
        sys.dont_write_bytecode = True
        import baseline_diff
        res = baseline_diff.read_results(args.runs)
        ran = {run_key: run_evidence([res])}
        read_notes = ["%d result file(s) read: %d test(s), %d passed." % (res["files"], len(res["tests"]), sum(1 for status in res["tests"].values() if status == "PASS"))]
        read_notes += ["result file not used: " + u for u in res["unreadable"][:3]] + [clean(p, 200) for p in res["problems"][:3]]
    try:
        result = trace(os.path.dirname(assessment), args.app, ran, assessment_dir=assessment, target_dir=target, module_name=args.module)
    except OSError as err:
        print("trace_rules.py: %s" % err, file=sys.stderr)
        return 2
    result["notes"] += read_notes or ["No test results were given, so no rule can be 'tested' here: the proof pack reads them from the result files (or add --runs DIR)."]
    view, mod = None, None
    if args.module:
        mod = next((m for m in result["modules"] if m["name"].lower() == args.module.lower()), None)
        if mod is None:
            print("trace_rules.py: no built module called %s" % clean(args.module, 60), file=sys.stderr)
            return 2
        view = module_view(result, mod["path"])
    payload = dict(result, moduleView=view) if view else result
    output = os.path.join(out, "RULE_TRACE.json")
    if os.path.lexists(output) and os.path.islink(output):
        print("trace_rules.py: RULE_TRACE.json must not be a symbolic link", file=sys.stderr)
        return 2
    try:
        with open(output, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(payload, fh, indent=1, ensure_ascii=True)
            fh.write("\n")
    except OSError as err:
        print("trace_rules.py: cannot write RULE_TRACE.json (%s)" % err.__class__.__name__, file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(payload, indent=1, ensure_ascii=True))
    else:
        print(render(result, args.all, view, mod["name"] if mod else None))
    return 1 if (view["p0NoTests"] if view else result["p0NoTests"]) else 0


if __name__ == "__main__":
    sys.exit(main())
