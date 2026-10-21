---
description: Prove the modernized code behaves like the legacy, with an independent re-check and one verdict per module
argument-hint: <app> [module]
arguments: app module
metadata:
  audience: member
  upstream: commands/modernize-verify.md
  agents: []
  reads: [applications/<app>/inputs/INTENT.md, applications/<app>/generated/BUSINESS_RULES.md, applications/<app>/units/<module>/TRANSFORMATION_NOTES.md, applications/<app>/units/<module>/<unit>/verify/golden/cases.json, applications/<app>/units/<module>/<unit>/verify/golden/fresh-cases.json]
  writes: [applications/<app>/units/<module>/<unit>/verify/golden/fresh/, applications/<app>/units/<module>/<unit>/verify/golden/fresh-cases.json, applications/<app>/units/<module>/<unit>/verify/runs/<run-id>/, applications/<app>/generated/VERIFICATION.md, applications/<app>/generated/VERIFICATION.json]
  gates: ["approval of each difference (fresh-input or case)", "sign-off of the verification by a named person"]
---

Re-check, independently, that the modernized code of `$app` behaves like the legacy, and give each module one
verdict: **PROVEN**, **PARTLY PROVEN** or **NOT PROVEN**. Run it after `implement`, in a
fresh session if you can: what the build left behind is a claim, and this command re-runs it. **A script computes
the verdict, not you** (fixed rules, written into the output), and it counts tests only from files it parses
itself: **keep the result file or the raw log of every test run and every canary run, and never type a count into
`test-runs.json`.** You write nothing in the legacy repository, never hand-edit the built code, the tests, an output or a
result to improve a verdict, and never tick or approve anything a person owns. Run every command from the root of your
**document repository** checkout, with your clone of the **legacy repository** of `$app` (read-only: Kintsugi's member hooks
refuse writes to it) and your checkout of the **target repository** of `$app` (the branch being verified) beside it.

This command runs in your own harness through Kintsugi's member plugin. Say in one line which source commit you compare
against (the one the assessment recorded for `$app`, in `sourceCommit` of `applications/$app/assessment/inventory.md` and in the portal; check out
exactly that commit) and which target branch and commit you verify. Everything this command writes goes to
`applications/$app/assessment/` on your own branch of the document repository and reaches the project through a pull request. Run any
subagent in the foreground and wait for its result: never end your turn while one is still running. Stop any server or other
process you started before you finish, and say you did. Before running any suite or the legacy code, read its configuration
for the databases and services it connects to: if any is not a local or throwaway instance, stop and ask which environment to use.

## 1 — What was built

Each module folder in the target repository that has notes in `applications/$app/units/<module>/TRANSFORMATION_NOTES.md`. Name them.
With a `$module` re-run only that one; the pack still judges every built module from its current evidence, never from an earlier run.
A folder that holds only test code and the files that build it (a parity harness, say) is test tooling: the pack lists it as not judged and leaves it out of the verdict.
If nothing is built, say so and stop: the next step is `/kintsugi:modernize-implement`.

## 2 — Which rules do the tests name?

`python3 scripts/trace_rules.py $app --source <source clone> --assessment applications/$app/assessment --target <target checkout> --out applications/<app>/units/<module>/<unit>/verify/runs/<run-id> --module <module>` (after step 3 add `--runs <the module's result folder>`;
before it nothing has run, so a named rule reads "named, not run"). A rule counts as tested only when a test that ran and passed backs it: the id
(`RULE-017`, or `rule017`) is in the name of a passing test or of its class, or a test file names it on a line not marked skipped or pending and
that file's class passed. A rule only a skipped, pending or failing test names is "named, not run", and one only the notes name is "claimed":
neither is tested. The pack repeats this: read it to know the gaps, and do not fix them here.

## 3 — Run the tests again from clean, and run your own canary

Equivalence data follows the document repository's layout: development cases (inputs and the legacy outputs)
live in `applications/<app>/units/<module>/<unit>/verify/golden/cases/<id>/`, listed in `applications/<app>/units/<module>/<unit>/verify/golden/cases.json`; each comparison run writes its small
reports to `applications/<app>/units/<module>/<unit>/verify/runs/<run-id>/` (`<run-id>` is `<YYYYMMDD-HHMM>-<short target commit>`). The new side's raw
outputs are never committed: keep them in a scratch folder outside the three checkouts. Start one run folder per module now and write every report of this verification into it.

For each module delete its build output and runner caches first (`target/`, `build/`,
`bin/`, `obj/`, `__pycache__/`, `.pytest_cache/`, `.jqwik-database`, or the stack's clean command when it works offline) and run
the **full** suite (Maven also `-Dmaven.test.failure.ignore=true`). Keep the runner's
JUnit-style XML where it can write it (Maven writes `target/surefire-reports`; `pytest --junitxml=<file>`;
`dotnet test --logger "junit;LogFilePath=<file>"` or `trx`; `jest-junit`; `gotestsum --junitfile <file>`) and the raw output
either way: `<test command> 2>&1 | tee applications/<app>/units/<module>/<unit>/verify/runs/<run-id>/<suite>.test-output.txt`. The pack reads the XML, else the summary
lines of Maven and Gradle, cargo, pytest, unittest, go test, dotnet test, jest, vitest, ctest and phpunit. Only the XML lists each test, so only it can
show that a rule's test ran; a log gives counts. A failure caused by this
machine (a missing tool, a sandbox limit) is still a failure: say why in the suite `note`. If the toolchain will not run here, record the
suite with `"executed": 0` and a `note`: nothing executed is NOT PROVEN, not a pass.

**Canary.** Copy the module (with what it builds from, such as a parent POM) to a scratch folder outside all three checkouts.
Break one line that matters (a rounding mode, a threshold by one, a comparison), run the tests that cover it (at least their class or
file) and keep that run's XML or raw log in `applications/<app>/units/<module>/<unit>/verify/runs/<run-id>/canary/`. The pack compares its failures with the
clean run's. A `Canary:` line in the notes is a claim; the pack does not count it.

## 4 — Judge equivalence again, then on inputs nobody used

Read any development generator or runner before you run it (some delete their own inputs or outputs). The inputs, the legacy outputs
and `cases.json` are the development cases: never touch them.

1. For each module with `applications/<app>/units/<module>/<unit>/verify/golden/cases.json`, re-run the new side (its `new.command` names the script when one was
   recorded) into a fresh scratch folder, then run `scripts/compare.py` on `applications/<app>/units/<module>/<unit>/verify/golden/cases.json` with that folder as the
   new side, writing `applications/<app>/units/<module>/<unit>/verify/runs/<run-id>/EQUIVALENCE.json` (`compare.py --help` gives the exact arguments). The pack judges
   the cases files itself, so the report only feeds the portal.
2. **Fresh-input check.** Invent inputs that development did not use, so that **at least 10 remain** after the ones the legacy
   refuses are left out. Read `cases.json`, `BUSINESS_RULES.md` and the notes' deliberate deviations (an input that hits one
   is a difference for a person to approve, not a defect). For a library an input is one call with one argument set,
   saved as one output per call. Take the edge cases the rules
   mention and add boundaries (zero, one either side of a threshold, the largest size), empty and huge values, unusual order.
   **Malformed records** (a field that breaks the input's own format: blanks or letters in a numeric field, a stray tab, a wrong
   length, a blank line) have no end: every round can invent new ones and the old system tolerates each in its own odd way. Read
   `applications/$app/inputs/INTENT.md` ("What must stay true"). Try malformed records only when it says behavior must match exactly,
   quirks included, or when there is no `INTENT.md`; otherwise keep the fresh inputs to records that are valid for the input's format,
   and add one line to `leftOut` saying malformed records were not tried and why, so a person sees where the check stops.
3. Run the legacy and the new code on each (same driver and flags, never while the suite runs,
   the legacy side built from a scratch copy of the source clone, never inside it). If a runner only loops over the development cases,
   call its single-case script or copy it into your scratch folder. Save each fresh input and the legacy's real outputs
   (records, reports, responses, not just a status line) under `applications/<app>/units/<module>/<unit>/verify/golden/fresh/<id>/`, the new side's outputs in your
   scratch folder, and list them in `applications/<app>/units/<module>/<unit>/verify/golden/fresh-cases.json` (legacy paths relative to `applications/<app>/units/<module>/<unit>/verify/golden/`, new paths
   relative to the scratch folder; schema at the top of `compare.py`; `input` groups the outputs of one run and only the pack
   reads it):
   `{"cases": [{"id": "F01-out", "input": "F01", "title": "…", "legacy": "fresh/F01/out.txt", "new": "F01/out.txt", "mask": [...]}]}`.
   An input counts through a non-empty output that differs from every development output (status lines such as COMPLETED repeat by
   nature and do not count). Then run
   `scripts/compare.py` on `applications/<app>/units/<module>/<unit>/verify/golden/fresh-cases.json` with the scratch folder as the new side, writing
   `applications/<app>/units/<module>/<unit>/verify/runs/<run-id>/FRESH_EQUIVALENCE.json`.
4. Mask only what legitimately varies (one regex beats a list of byte ranges) and say why; text a runtime generates (an exception
   message) is not product output: print only its class or mask it. Any other difference is a finding: report it, never hand-edit an
   output. If a side legitimately writes no file, save an empty one so a person can approve the difference. If the legacy refuses an
   input, find out why (run its loader by hand), leave it out and list it in `leftOut` with the reason. On a re-run keep
   `fresh-cases.json` and any `approvedDifference` a person added; add new inputs. **If the legacy cannot run here, say so plainly:**
   the proof is then trace-based and the verdict cannot be PROVEN.

## 5 — Record it and write the proof pack

The pack checks by itself that the source clone is untouched (its files against the commit the assessment recorded); what it
leaves to a person (open questions, unticked criteria, the sign-off) you never tick. Write
`applications/<app>/units/<module>/<unit>/verify/runs/<run-id>/test-runs.json` once per module, from what you did in steps 3 and 4 (paths and words only):

```json
{ "date": "YYYY-MM-DD",
  "legacy": { "ran": true, "how": "one line: how the legacy runs here", "why": "" },
  "leftOut": [ "F17: the legacy loader refused it (duplicate keys)" ],
  "suites": [ { "module": "<module>", "name": "unit tests", "command": "<the exact command>",
                "junit": ["<the result folder in the target checkout: <module>/target/surefire-reports>"],
                "log": ["applications/<app>/units/<module>/<unit>/verify/runs/<run-id>/unit.test-output.txt"], "skippedReason": "", "note": "" } ],
  "canaries": [ { "module": "<module>", "change": "<what you broke>",
                 "junit": ["applications/<app>/units/<module>/<unit>/verify/runs/<run-id>/canary"], "log": [] } ] }
```

`module` is the module or service folder name in the target repository. Give `junit`
or `log` for every suite and canary: a file the pack cannot parse is no evidence. `legacy.ran` is `false`, with `why`, when the legacy
cannot run here. `note` is for anything a reader needs, cause first, under 250 characters. Then run
`python3 scripts/proof_pack.py $app $module --source <source clone> --assessment applications/$app/assessment --target <target checkout> --out applications/$app/generated --runs applications/<app>/units/<module>/<unit>/verify/runs/<run-id>` (no `$module`
for all). It writes `applications/$app/generated/VERIFICATION.md` and `VERIFICATION.json`; exit 1 only means "not PROVEN". Show the user the
verdict per module, the reasons word for word, the P0 rule table, any folder listed as test tooling (not judged),
**what this does not prove**, and the blank sign-off block. Do not soften a reason or change a verdict; if you think
a rule is wrong, say so and leave the file as it is.

## Finish

Open (or update) the document repo pull request with everything this command wrote under `applications/$app/assessment/`, `golden/`
and `runs/` (never the scratch folder); the portal shows the
verification once it is merged. Then name the next step. **PARTLY PROVEN or NOT PROVEN:** turn each reason, in order, into a
command. A failure caused by this machine: run the suite where the tool works (a terminal outside the sandbox, or CI), then run this
command again. A difference the notes call intended: a person approves it at a gate in the portal, and the approval is recorded (once per
input with `"approvedInputs": {"F23": "why"}` at the top of `fresh-cases.json`, or `approvedDifference` in one case); you never do. P0 rules "named, not run" or named by no test: the test that pins each one must run and pass (write or enable it, keep its result file); adding an id or dropping a skip marker without that proves nothing. Then run this again. Any other failing
test or difference: `/kintsugi:modernize-implement $app <module/unit>`. Removed or changed test files are a person's review, never yours to undo.
**PROVEN:** it is evidence, not approval. Tell the user to request the **verification sign-off** gate in the portal: a named person
signs it there (the sign-off block in `applications/$app/generated/VERIFICATION.md` records it); then the next unit of the wave, or the `understand` stage on the next items.
