---
description: Rewrite one legacy module in the target stack, with tests that prove it behaves the same
argument-hint: <app> [module] [target-stack]
arguments: app module target_stack
metadata:
  audience: member
  upstream: commands/modernize-transform.md
  agents: [test-engineer, architecture-critic]
  reads: [standards/, assessment/<app>/MODERNIZATION_BRIEF.md, assessment/<app>/INTENT.md, assessment/<app>/BUSINESS_RULES.md, assessment/<app>/RULE_REVIEWS.json, assessment/<app>/PREFLIGHT.md]
  writes: [assessment/<app>/modules/<module>/TRANSFORMATION_NOTES.md, golden/<module>/cases/, golden/<module>/cases.json, runs/<module>/<run-id>/EQUIVALENCE.json]
  gates: [transform plan approval, approval of each accepted equivalence difference]
---

Transform module **`$module`** of `$app` into **$target_stack**, with proof of behavioral
equivalence. This is one vertical slice of the strangler fig; the code goes to the **target repository** of `$app`,
under the module's folder (`<module>/`, or the target path the brief or the unit file in `units/$app/` names), on your
own branch, committed with an `Assisted-by: <harness>` trailer.

This command runs in your own harness through Kintsugi's member plugin. Inputs come from the **document repository**
(`assessment/$app/...`), checked out next to the target repository; the **legacy repository** of `$app` is your local
clone, **read-only** (Kintsugi's member hooks refuse writes to it). Before you start, say in one line which source commit
you read: the one the assessment recorded for `$app` (named in `assessment/$app/PREFLIGHT.md` and in the portal); check out
exactly that commit. If you have no clone of the legacy repository, stop and say so: nothing can run without the code, and
the fix is to clone the repositories the portal lists for `$app`. Analysis outputs (`TRANSFORMATION_NOTES.md` under
`assessment/$app/`, the golden cases under `golden/<module>/` and the comparison report under `runs/<module>/<run-id>/`) go
on your own branch of the document repository and reach the project through a pull request. Equivalence data follows the document repository's layout: development cases (inputs and the legacy outputs)
live in `golden/<module>/cases/<id>/`, listed in `golden/<module>/cases.json`; each comparison run writes its small
reports to `runs/<module>/<run-id>/` (`<run-id>` is `<YYYYMMDD-HHMM>-<short target commit>`). The new side's raw
outputs are never committed: keep them in a scratch folder outside the three checkouts. Run every subagent in the foreground and wait for its result: never end your turn while
one is still running. Stop any server or other process you started (a legacy app on a local port, a watcher) before you
finish, and say you did. **If `$module` or `$target_stack` is empty**, read
`assessment/$app/MODERNIZATION_BRIEF.md`: take the target stack it names, and the first module of
the earliest phase whose `Command:` is `transform` that has no
`assessment/$app/modules/<module>/TRANSFORMATION_NOTES.md` yet (with no brief, the target in `INTENT.md`). Say which you picked.

## Step 0 — Toolchain, then the plan (human gate)

**Target stack (required).** The runtime, package manager and test framework must respond
(`java -version` and `mvn -v`, `node -v` and `npm -v`, `python3 -V` and `pytest --version`). If not,
stop and say what to install: a plan gate now would only defer the failure an hour. Point to
the `preflight` stage in the portal (`assessment/$app/PREFLIGHT.md`).

**Legacy stack (advisory, never a blocker).** Try a syntax-only compile of the module, from a scratch copy of the source
clone (never build inside it). Legacy code
often cannot build locally by nature (CICS and IMS programs have no local translator; the real runtime
is a mainframe you do not have). If it cannot, dual execution is off the table: the tests assert
against **recorded traces and golden-master fixtures** (real production outputs, captured reports,
SME-confirmed examples). Say so in the plan and in `TRANSFORMATION_NOTES.md` ("equivalence is
trace-based; legacy was not executable here"), so reviewers know how strong the proof is.

**Run the old system only where it is safe.** Record baselines from the legacy code running on this
machine, or against a test environment the person named. Never call a production or third-party
service, register an account, or send or change real data to record a baseline unless the plan approved
at the gate names that exact target (say which calls, and which of them write). A token, password
or session cookie in a recorded response is a secret: replace it with a fixed fake value before
anything is saved, and never print it.

**The brief is binding.** If `MODERNIZATION_BRIEF.md` exists, find the phase whose `Command:` is this
one and whose `Modules:` include `$module`, and treat its scope, entry criteria, exit criteria and any
edits people made as binding. An unmet entry criterion is the next step: meet it, never re-plan
around it. If no phase covers `$module`, stop and ask which phase this is.

Read the module's source and the rules in `BUSINESS_RULES.md` that reference it, and any verdicts on them in `assessment/$app/RULE_REVIEWS.json`: a rule marked `wrong` is not pinned as the oracle (use the reviewer's note for what is right, and if the note does not say, ask for it through the rule review in the portal), and a P0 rule marked `discuss` is a question to settle at this plan gate before any code. Then prepare the
plan and **stop: write no code until the plan is approved** (plan mode if available): which
source files are in scope, the target structure, which rules and behaviors it implements, how you will
prove equivalence, and anything ambiguous that needs a human decision now. Tell the user to request the
**transform plan** gate in the portal with this plan, and to re-run `/kintsugi:modernize-transform $app $module` once the
portal shows it approved (the result is recorded under `gates` in the unit file in `units/$app/` of the workspace
repository: pull it). Edits a reviewer makes to the plan at the gate are binding.

## Step 1 — Characterization tests first

Spawn the **test-engineer** subagent: "Write characterization tests for module $module of the legacy repository of $app
(read-only, at the recorded commit).
Read the source, identify every observable behavior and encode each as a test with concrete input and
expected output derived from the legacy logic. Target framework: <right for $target_stack>. Write to
`<module>/src/test/` in the target repository. These tests define 'done'. Name the `RULE-NNN` id(s) each test pins
(from `assessment/$app/BUSINESS_RULES.md`) in its name or a one-line comment, so the trace can find it. Follow your secret-handling rules:
no credential from legacy code becomes a fixture; use fake same-shape values and read anything live
from environment variables." Show the user the test file and get a yes before going on.

## Step 2 — Idiomatic transformation

Write the implementation in `<module>/src/main/` in the target repository. **Write what a senior
$target_stack engineer would write from the *specification*, not from the legacy structure:** do not
mirror COBOL paragraphs as methods or keep names like `WS-TEMP-AMT-X`; use the target's idioms
(records, streams, injection, proper error types). Include the domain model, service logic, API
surface and configuration, and link each class to the rule IDs it implements in a short comment.

## Step 3 — Prove it, and prove the proof can fail

While iterating, run only this module's tests; run the whole suite once before Step 4.

1. **Run the tests** (`cd <module>` in the target repository and the stack's test command) and show the
   output. Fix and rerun until green.
2. **Count what ran.** Report `equivalence cases executed: N`. A run that executed **zero** cases proved
   nothing, and a comparison test must **fail, never skip,** when its legacy oracle or fixture is
   missing: a suite that is green because everything skipped is not green. If the oracle was
   unreachable, fix that; do not report the suite as passing.
3. **Show the tests can fail.** Temporarily break the new code in one small way that matters (change a
   rounding mode, shift a threshold by one, flip a comparison), confirm at least one test goes red,
   restore it, and record `Canary: <the change> → <N> tests failed` in the notes. If nothing failed,
   the tests do not pin the behavior: strengthen them before going on.
4. **When the legacy code can run here** (built and run from a scratch copy of the source clone, never inside it), also
   run both systems on the same inputs: save each input and its legacy output under `golden/$module/cases/<id>/`
   and each new output in your scratch folder, list the pairs in `golden/$module/cases.json` (legacy paths relative
   to `golden/$module/`, new paths relative to the scratch folder; the schema is at the top of `scripts/compare.py`),
   and run, from the root of the document repo checkout,
   `python3 scripts/compare.py $app --source <source clone> --assessment assessment/$app --target <target checkout> --cases golden/$module/cases.json --runs <scratch folder> --out runs/$module/<run-id>`,
   which writes `runs/$module/<run-id>/EQUIVALENCE.json`.
   That script, not your judgment, decides same or different. Mask only fields that legitimately vary
   (timestamps, generated ids) and say what each mask hides. A difference you accept is recorded with a
   reason in the case's `approvedDifference`, and only a person accepts it, at a gate in the portal: list the
   difference for approval, never write the `approvedDifference` yourself.
   Floating-point numbers that another compiler or math library prints slightly differently are not a
   mask: give that case a `tolerance` (`rel` or `abs`, and a `why`), which compares numbers written with a
   decimal point or exponent within it, every other byte exactly, and is listed in the result.

## Step 4 — Notes and a side-by-side

Write `assessment/$app/modules/$module/TRANSFORMATION_NOTES.md`: the target repository, branch and commit it describes; a
mapping table (legacy file:lines at the recorded source commit to target file:lines, per behavior); deliberate deviations
with rationale; what was NOT migrated (dead code, unreachable branches) and why; the canary result and the executed-case
count; follow-ups for the next dependent module. Show one representative behavior side by side
(`diff -y --width=160 <(sed -n '<lines>p' <legacy file>) <target file>`). Never pick a credential-bearing
range, and mask any credential-like literal in the notes: they are committed to the document repository.
This is your own evidence: `/kintsugi:modernize-verify $app $module` is the independent re-check
(it re-runs the tests and the comparison, tries new inputs, and gives one verdict).

## Step 5 — Architecture review

Kintsugi's review stage runs the **architecture-critic** server-side on your pushed branch: if its record for this commit is
in `reviews/` of the document repository, reuse it; otherwise spawn the **architecture-critic** subagent here to review
the code against $target_stack best practice.
Apply HIGH-severity feedback and list the rest in the notes.

Push the target branch and open the target pull request; open (or update) the document repo pull request with everything under
`assessment/$app/` this command wrote. Report: tests passing, cases executed, lines of legacy retired, where the artifacts
are (the portal shows them once the document repo pull request is merged). The next step is the brief's next module, or the
`understand` stage on the remaining items when the phase is done.
