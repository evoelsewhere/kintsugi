---
description: Prove the modernized code behaves like the legacy, with an independent re-check and one verdict per module
argument-hint: <app> [module]
arguments: app module
metadata:
  audience: member
  upstream: commands/modernize-verify.md
  agents: []
  reads: [assessment/<app>/MODERNIZATION_BRIEF.md, assessment/<app>/INTENT.md, assessment/<app>/PREFLIGHT.md, assessment/<app>/BUSINESS_RULES.md, assessment/<app>/DELTA_CATALOG.md, assessment/<app>/BASELINE.md, assessment/<app>/baseline/, assessment/<app>/UPLIFT_NOTES.md, assessment/<app>/modules/<module>/TRANSFORMATION_NOTES.md, assessment/<app>/equivalence/cases.json, assessment/<app>/equivalence/fresh-cases.json]
  writes: [assessment/<app>/equivalence/, assessment/<app>/EQUIVALENCE.json, assessment/<app>/VERIFICATION.md, assessment/<app>/VERIFICATION.json]
  gates: [approval of each difference (fresh-input, case or baseline), sign-off of the verification by a named person]
---

Re-check, independently, that the modernized code of `$app` behaves like the legacy, and give each module one
verdict: **PROVEN**, **PARTLY PROVEN** or **NOT PROVEN**. Run it after `transform`, `uplift` or `reimagine`, in a
fresh session if you can: what the build left behind is a claim, and this command re-runs it. **A script computes
the verdict, not you** (fixed rules, written into the output), and it counts tests only from files it parses
itself: **keep the result file or the raw log of every test run and every canary run, and never type a count into
`test-runs.json`.** You write nothing in the source repository, never hand-edit the built code, the tests, an output or a
result to improve a verdict, and never tick or approve anything a person owns. Run every command from the root of your
**workspace repository** checkout, with your clone of the **source repository** of `$app` (read-only: Kintsugi's member hooks
refuse writes to it) and your checkout of the **target repository** of `$app` (the branch being verified) beside it.

This command runs in your own harness through Kintsugi's member plugin. Say in one line which source commit you compare
against (the one the assessment recorded for `$app`, named in `assessment/$app/PREFLIGHT.md` and in the portal; check out
exactly that commit) and which target branch and commit you verify. Everything this command writes goes to
`assessment/$app/` on your own branch of the workspace repository and reaches the project through a pull request. Run any
subagent in the foreground and wait for its result: never end your turn while one is still running. Stop any server or other
process you started before you finish, and say you did. Before running any suite or the legacy code, read its configuration
for the databases and services it connects to: if any is not a local or throwaway instance, stop and ask which environment to use.

## 1 — What was built

**Rewrite:** each module folder in the target repository that has notes in `assessment/$app/modules/<module>/`.
**Same-stack uplift:** the working copy, your uplift branch of the target repository (its units are named in the Code and
Command lines of `BASELINE.md`). **Reimagine:** each service folder in the target repository named in
`assessment/$app/REIMAGINED_ARCHITECTURE.md`. Name them. With a `$module` (for an uplift, a unit)
re-run only that one; the pack still judges every built module from its current evidence, never from an earlier run.
A folder that holds only test code and the files that build it (a parity harness, say) is test tooling: the pack lists it as not judged and leaves it out of the verdict.
If nothing is built, say so and stop: the next step is the brief's Phase 1 command (the portal's `status` view names it).

## 2 — Which rules do the tests name?

Rewrite and reimagine: `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/trace_rules.py" $app --target <target checkout> --module <module>` (after step 3 add `--results <the module's result folder>`;
before it nothing has run, so a named rule reads "named, not run"). A rule counts as tested only when a test that ran and passed backs it: the id
(`RULE-017`, or `rule017`) is in the name of a passing test or of its class, or a test file names it on a line not marked skipped or pending and
that file's class passed. A rule only a skipped, pending or failing test names is "named, not run", and one only the notes name is "claimed":
neither is tested. The pack repeats this: read it to know the gaps, and do not fix them here.

## 3 — Run the tests again from clean, and run your own canary

For each module (uplift: the units the baseline covers) delete its build output and runner caches first (`target/`, `build/`,
`bin/`, `obj/`, `__pycache__/`, `.pytest_cache/`, `.jqwik-database`, or the stack's clean command when it works offline) and run
the **full** suite (uplift: the command `BASELINE.md` records; Maven also `-Dmaven.test.failure.ignore=true`). Keep the runner's
JUnit-style XML where it can write it (Maven writes `target/surefire-reports`; `pytest --junitxml=<file>`;
`dotnet test --logger "junit;LogFilePath=<file>"` or `trx`; `jest-junit`; `gotestsum --junitfile <file>`) and the raw output
either way: `<test command> 2>&1 | tee assessment/$app/equivalence/<suite>.test-output.txt`. The pack reads the XML, else the summary
lines of Maven and Gradle, cargo, pytest, unittest, go test, dotnet test, jest, vitest, ctest and phpunit. Only the XML lists each test, so only it can
show that a rule's test ran; a log gives counts. A failure caused by this
machine (a missing tool, a sandbox limit) is still a failure: say why in the suite `note`. If the toolchain will not run here, record the
suite with `"executed": 0` and a `note`: nothing executed is NOT PROVEN, not a pass.

**Canary.** Copy the module (with what it builds from, such as a parent POM) to a scratch folder outside all three checkouts.
Break one line that matters (a rounding mode, a threshold by one, a comparison), run the tests that cover it (at least their class or
file) and keep that run's XML or raw log in `assessment/$app/equivalence/canary/<module>/`. The pack compares its failures with the
clean run's. A `Canary:` line in the notes is a claim; the pack does not count it.

**Uplift:** also run `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/baseline_diff.py" assessment/$app/BASELINE.md --junit <results folder>`.
A test that pins the old version's behavior and fails on the new one is a difference, not a test bug, and tests the pilot added after
the baseline show as new failures (say so in the suite `note`). A person decides each, at a gate in the portal: fix the code, update the
test, or approve it in a table headed "Approved differences", `| Test | Reason |`, in `BASELINE.md`. You never edit or approve.

**Uplift: three more checks the pack makes by itself.** (1) *The baseline must be measured.* `BASELINE.md`'s numbers count only when a
per-test result file (JUnit or `.trx` XML), a per-test JSON map (`{"<test id>": "PASS"}`) or a raw runner log with a summary line backs
them, kept in `assessment/$app/baseline/` or named on a line of `BASELINE.md` that starts with `Recorded:` or `Machine-readable:`. A
table typed by hand, or a file of bare counts, is only PARTLY PROVEN. If the old version's results were never saved, run its suite again
from a scratch copy of the source clone at the recorded commit and keep them now; never write them in by hand. (2) *Tests kept.* The pack
walks the test files of the source clone and of the working copy and lists what was removed, added or changed: a removed file, or more
than a quarter changed, is a gap for a person to review (weakened assertions cannot be detected, only that files changed). (3) *Deltas
covered.* Every Behavioral-silent delta in `DELTA_CATALOG.md` needs a test in the working copy that names its site's file; if none does,
the pack lists it (add a characterization test at that site).

## 4 — Judge equivalence again, then on inputs nobody used

Read any development generator or runner before you run it (some delete their own inputs or outputs). The inputs, the legacy outputs
and `cases.json` are the development cases: never touch them.

1. If `assessment/$app/equivalence/cases.json` exists, re-run the new side (its `new.command` names the script when one was
   recorded), then run `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/compare.py" assessment/$app/equivalence/cases.json --out assessment/$app/EQUIVALENCE.json`.
   With several modules keep each module's `cases.json` and `fresh-cases.json` in `assessment/$app/equivalence/<module>/` and run
   `compare.py` on each; the pack judges the cases files itself, so `--out` only feeds the portal.
2. **Fresh-input check.** Invent inputs that development did not use, so that **at least 10 remain** after the ones the legacy
   refuses are left out. Rewrite: read `cases.json`, `BUSINESS_RULES.md` and the notes' deliberate deviations (an input that hits one
   is a difference for a person to approve, not a defect). Uplift: no rules or cases exist, so read `DELTA_CATALOG.md`; for a library
   an input is one call with one argument set, saved as one output per call or per site. Take the edge cases the rules or deltas
   mention and add boundaries (zero, one either side of a threshold, the largest size), empty and huge values, unusual order.
   **Malformed records** (a field that breaks the input's own format: blanks or letters in a numeric field, a stray tab, a wrong
   length, a blank line) have no end: every round can invent new ones and the old system tolerates each in its own odd way. Read
   `assessment/$app/INTENT.md` ("What must stay true"). Try malformed records only when it says behavior must match exactly,
   quirks included, or when there is no `INTENT.md`; otherwise keep the fresh inputs to records that are valid for the input's format,
   and add one line to `leftOut` saying malformed records were not tried and why, so a person sees where the check stops.
3. Run the legacy and the new code on each (uplift: the old and the new runtime, same driver and flags, never while the suite runs,
   the old side built from a scratch copy of the source clone, never inside it). If a runner only loops over the development cases,
   call its single-case script or copy it into `fresh/`. Write only under `assessment/$app/equivalence/fresh/`, plus
   `fresh-cases.json` and `FRESH_EQUIVALENCE.json` beside it. Save the real outputs (records, reports, responses, not just a status
   line) in `fresh/legacy/<id>/` and `fresh/new/<id>/` and list them in `assessment/$app/equivalence/fresh-cases.json` (paths relative to
   that file's folder; schema at the top of `compare.py`; `input` groups the outputs of one run and only the pack reads it):
   `{"cases": [{"id": "F01-out", "input": "F01", "title": "…", "legacy": "fresh/legacy/F01/out.txt", "new": "fresh/new/F01/out.txt", "mask": [...]}]}`.
   An input counts through a non-empty output that differs from every development output (status lines such as COMPLETED repeat by
   nature and do not count). Then run
   `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/compare.py" assessment/$app/equivalence/fresh-cases.json --out assessment/$app/equivalence/FRESH_EQUIVALENCE.json`.
4. Mask only what legitimately varies (one regex beats a list of byte ranges) and say why; text a runtime generates (an exception
   message) is not product output: print only its class or mask it. Any other difference is a finding: report it, never hand-edit an
   output. If a side legitimately writes no file, save an empty one so a person can approve the difference. If the legacy refuses an
   input, find out why (run its loader by hand), leave it out and list it in `leftOut` with the reason. On a re-run keep
   `fresh-cases.json` and any `approvedDifference` a person added; add new inputs. **If the legacy cannot run here, say so plainly:**
   the proof is then trace-based and the verdict cannot be PROVEN.

## 5 — Record it and write the proof pack

The pack checks by itself that the source clone is untouched (its files against the commit the assessment recorded) and lists the
brief's unticked §7 questions and exit criteria; a person decides those, so never tick one. Write
`assessment/$app/equivalence/test-runs.json` once, from what you did in steps 3 and 4 (paths and words only):

```json
{ "date": "YYYY-MM-DD",
  "legacy": { "ran": true, "how": "one line: how the legacy runs here", "why": "" },
  "leftOut": [ "F17: the legacy loader refused it (duplicate keys)" ],
  "suites": [ { "module": "<module>", "name": "unit tests", "command": "<the exact command>",
                "junit": ["<the result folder in the target checkout: <module>/target/surefire-reports, or for an uplift <unit>/target/surefire-reports>"],
                "log": ["assessment/$app/equivalence/unit.test-output.txt"], "skippedReason": "", "note": "" } ],
  "canaries": [ { "module": "<module>", "change": "<what you broke>",
                 "junit": ["assessment/$app/equivalence/canary/<module>"], "log": [] } ] }
```

`module` is the module or service folder name in the target repository (an uplift's suites and canaries may name a unit). Give `junit`
or `log` for every suite and canary: a file the pack cannot parse is no evidence. `legacy.ran` is `false`, with `why`, when the legacy
cannot run here. `note` is for anything a reader needs, cause first, under 250 characters. Then run
`python3 "${CLAUDE_PLUGIN_ROOT}/scripts/proof_pack.py" $app $module --source <source clone> --target <target checkout>` (no `$module`
for all). It writes `assessment/$app/VERIFICATION.md` and `VERIFICATION.json`; exit 1 only means "not PROVEN". Show the user the
verdict per module, the reasons word for word, for a rewrite the P0 rule table, any folder listed as test tooling (not judged),
**what this does not prove**, and the blank sign-off block. Do not soften a reason or change a verdict; if you think
a rule is wrong, say so and leave the file as it is.

## Finish

Open (or update) the workspace pull request with everything under `assessment/$app/` this command wrote; the portal shows the
verification once it is merged. Then name the next step. **PARTLY PROVEN or NOT PROVEN:** turn each reason, in order, into a
command. A failure caused by this machine: run the suite where the tool works (a terminal outside the sandbox, or CI), then run this
command again. A difference the notes call intended: a person approves it at a gate in the portal, and the approval is recorded (once per
input with `"approvedInputs": {"F23": "why"}` at the top of `fresh-cases.json`, or `approvedDifference` in one case, or the table in
`BASELINE.md`); you never do. P0 rules "named, not run" or named by no test: the test that pins each one must run and pass (write or enable it, keep its result file); adding an id or dropping a skip marker without that proves nothing. Then run this again. Any other failing
test or difference: `/kintsugi:modernize-transform $app <module>`, or for an uplift `/kintsugi:modernize-uplift $app`
(also for a baseline typed by hand, which is measured again in its Step 4, and for a silent delta no test names, which gets a
characterization test there). Removed or changed test files are a person's review, never yours to undo.
**PROVEN:** it is evidence, not approval. Tell the user to request the **verification sign-off** gate in the portal: a named person
signs it there (the sign-off block in `assessment/$app/VERIFICATION.md` records it); then the brief's next module, or the `harden` stage.
