---
description: Implement one unit in the target stack from its approved detail design, with unit tests, and bring the design back in line with what was built
argument-hint: <app> <module/unit> [target-stack]
arguments: app unit target_stack
metadata:
  audience: member
  agents: [test-engineer, architecture-critic]
  reads: [standards/, architecture/common/, applications/<app>/units/<module>/<unit>/design/, applications/<app>/units/<module>/<unit>/understanding/rules-review.md, applications/<app>/generated/BUSINESS_RULES.md, applications/<app>/inputs/INTENT.md]
  writes: [applications/<app>/units/<module>/TRANSFORMATION_NOTES.md, applications/<app>/units/<module>/<unit>/design/, applications/<app>/units/<module>/<unit>/verify/golden/cases/, applications/<app>/units/<module>/<unit>/verify/golden/cases.json, applications/<app>/units/<module>/<unit>/verify/runs/<run-id>/EQUIVALENCE.json]
  gates: [implementation plan approval, approval of each accepted equivalence difference]
---

Implement unit **`$unit`** (`<module>/<unit>`) of `$app` in **$target_stack**, from its **detail design**, with unit tests that pin what
the design says. The code goes to the **target repository** of `$app` that implements the unit's component (the unit's `unit.md`, or
`applications/$app/to-be/design.md`, names it), under the unit's folder, on your own branch, committed with an
`Assisted-by: <harness>` trailer.

This command runs in your own harness through Kintsugi's member plugin. Inputs come from the **document repository**, checked out next
to the target repository: the unit's `design/` folder (the contract), its `understanding/` folder, the common components in
`architecture/common/`, and `standards/`. The **legacy repository** of `$app` is your local clone, **read-only** (Kintsugi's member
hooks refuse writes to it). Before you start, say in one line which source commit you read: the one the assessment recorded for `$app`
(`sourceCommit` in `applications/$app/assessment/inventory.md`, and in the portal); check out exactly that commit. If you have no clone
of the legacy repository, stop and say so: nothing can run without the code, and the fix is to clone the repositories the portal lists
for `$app`. What you write in the document repository (`TRANSFORMATION_NOTES.md`, design corrections, the golden cases and the comparison
report) goes on your own branch of the document repository and reaches the project through a pull request. The new side's raw outputs
are never committed: keep them in a scratch folder outside the checkouts. Run every subagent in the foreground and wait for its result:
never end your turn while one is still running. Stop any server or other process you started (a legacy app on a local port, a watcher)
before you finish, and say you did. **If `$target_stack` is empty**, use the stack named in `architecture/blueprint.md` for the unit's
component (with none, the target in `applications/$app/inputs/INTENT.md`). Say which you picked.

## Step 0 — The design is ready; the toolchain responds; the plan (human gate)

**The detail design is the contract.** Run `python3 scripts/check_design.py $app $unit` from the root of the document repository. It must
exit 0 for every set the unit needs: if a required document is missing or has problems, stop and name them: the next step is
`/kintsugi:modernize-design $app $unit <set>`, not guessing at the design here. The design must be approved at its stage gate in the
portal; if it is not, say so and stop.

**Target stack (required).** The runtime, package manager and test framework must respond (`java -version` and `mvn -v`, `node -v` and
`npm -v`, `python3 -V` and `pytest --version`). If not, stop and say what to install: a plan gate now would only defer the failure an hour.

**Legacy stack (advisory, never a blocker).** Try a syntax-only compile of the unit's source, from a scratch copy of the source clone
(never build inside it). Legacy code often cannot build locally by nature. If it cannot, dual execution is off the table: the
tests assert against **recorded traces and golden-master fixtures** (real production outputs, captured reports, SME-confirmed
examples). Say so in the plan and in `TRANSFORMATION_NOTES.md` ("equivalence is trace-based; legacy was not executable here").

**Run the old system only where it is safe.** Record baselines from the legacy code running on this machine, or against a test
environment the person named. Never call a production or third-party service, register an account, or send or change real data to
record a baseline unless the plan approved at the gate names that exact target (say which calls, and which of them write). A token,
password or session cookie in a recorded response is a secret: replace it with a fixed fake value before anything is saved, and never
print it.

Read the detail design, the unit's rules and any verdicts on them in `applications/$app/units/<module>/<unit>/understanding/rules-review.md`
(human-owned): a rule marked `refuted` is not pinned (use the reviewer's note for what is right), and a P0 rule marked `clarify` is a
question to settle at this plan gate before any code. Then prepare the plan and **stop: write no code until the plan is approved**
(plan mode if available): which design items are built in which files, the target structure and the common components used, how each
rule and each error case is tested, and anything ambiguous that needs a human decision now. Tell the user to request the
**implementation plan** gate in the portal with this plan, and to re-run `/kintsugi:modernize-implement $app $unit` once the portal
shows it approved. Edits a reviewer makes to the plan at the gate are binding.

## Step 1 — Unit tests first

Spawn the **test-engineer** subagent: "Write the unit tests for unit $unit of $app from its detail design in
`applications/$app/units/<module>/<unit>/design/` (and the legacy source, read-only, at the recorded commit, where the design leaves an
edge unclear). Every business rule, every branch of the design's logic, every error case and message in it gets at least one test with
concrete input and expected output; boundary values (zero, negative, maximum, empty) get explicit cases. Target framework: <right for
$target_stack>. Write to the unit's test folder in the target repository. These tests define 'done'. Name the `RULE-NNN` id(s) each test
pins (from `applications/$app/generated/BUSINESS_RULES.md`) in its name or a one-line comment, so the trace can find it. Follow your
secret-handling rules: no credential from legacy code becomes a fixture; use fake same-shape values and read anything live from
environment variables." Show the user the test file and get a yes before going on.

## Step 2 — Implementation

Write the code in the unit's main folder in the target repository, **exactly as the detail design says**: its structure, names, types,
conditions, messages and error codes, calling the common components by the interfaces `architecture/common/` gives. Write what a senior
$target_stack engineer would write, in the project's conventions (`standards/conventions/`): not legacy procedure names or layouts, but
the target's idioms (records, streams, injection, proper error types). Link each class to the rule ids and design items it implements in
a short comment.

## Step 3 — Run the tests, and keep the design true

While iterating, run only this unit's tests; run the whole suite once before Step 4.

1. **Run the tests** (the stack's test command in the unit's folder) and show the output. Fix and rerun until green.
2. **Count what ran.** Report `tests executed: N`. A run that executed **zero** tests proved nothing, and a comparison test must **fail,
   never skip,** when its oracle or fixture is missing: a suite that is green because everything skipped is not green.
3. **Design and code agree.** The design is the contract, so if the code had to differ (the design was wrong or incomplete), correct the
   detail design in the same document repo pull request, run `python3 scripts/check_design.py $app $unit` again, and list each
   correction in the pull request and in `TRANSFORMATION_NOTES.md`. Never leave the two disagreeing.

## Step 4 — Development cases, when the legacy can run here

When the legacy code can run here (built and run from a scratch copy of the source clone, never inside it), run both systems on the same
inputs: save each input and its legacy output under `applications/$app/units/<module>/<unit>/verify/golden/cases/<id>/` and each new
output in your scratch folder, list the pairs in `applications/$app/units/<module>/<unit>/verify/golden/cases.json` (legacy paths
relative to `.../verify/golden/`, new paths relative to the scratch folder; the schema is at the top of `scripts/compare.py`), and run,
from the root of the document repo checkout,
`python3 scripts/compare.py $app --source <source clone> --assessment applications/$app/assessment --target <target checkout> --cases applications/$app/units/<module>/<unit>/verify/golden/cases.json --runs <scratch folder> --out applications/$app/units/<module>/<unit>/verify/runs/<run-id>`
(`<run-id>` is `<YYYYMMDD-HHMM>-<short target commit>`), which writes `EQUIVALENCE.json`. That script, not your judgment, decides same or
different. Mask only fields that legitimately vary (timestamps, generated ids) and say what each mask hides. A difference you accept is
recorded with a reason in the case's `approvedDifference`, and only a person accepts it, at a gate in the portal: list the difference
for approval, never write the `approvedDifference` yourself. Floating-point numbers that another compiler or math library prints slightly
differently are not a mask: give that case a `tolerance` (`rel` or `abs`, and a `why`).

## Step 5 — Notes and a side-by-side

Write `applications/$app/units/<module>/TRANSFORMATION_NOTES.md`: the target repository, branch and commit it describes; a mapping table
(legacy file:lines at the recorded source commit to target file:lines, per behavior); deliberate deviations from the legacy with
rationale and the corrections made to the design; what was NOT migrated (dead code, unreachable branches) and why; the executed-test
count; follow-ups for the next dependent unit. Show one representative behavior side by side
(`diff -y --width=160 <(sed -n '<lines>p' <legacy file>) <target file>`). Never pick a credential-bearing range, and mask any
credential-like literal in the notes: they are committed to the document repository. This is your own evidence:
`/kintsugi:modernize-verify $app <module>` is the independent re-check.

## Step 6 — Architecture review

Kintsugi's review stage runs the **architecture-critic** server-side on your pushed branch: if its record for this commit is in
`reviews/` of the document repository, reuse it; otherwise spawn the **architecture-critic** subagent here to review the code against
the detail design, the common design and $target_stack best practice. Apply HIGH-severity feedback and list the rest in the notes.

Push the target branch and open the target pull request; open (or update) the document repo pull request with everything this command
wrote. Report: tests passing and executed, design corrections made, lines of legacy retired, where the artifacts are (the portal shows
them once the document repo pull request is merged). The next step is the next unit of the wave, or the `understand` stage on the
remaining items when the wave is done.
