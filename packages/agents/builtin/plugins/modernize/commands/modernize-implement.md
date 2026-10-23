---
description: Implement one unit in the target stack from its approved detail design, with unit tests, and bring the design back in line with what was built
argument-hint: <app> <module/unit> [target-stack]
arguments: app unit target_stack
metadata:
  audience: member
  agents: [test-engineer, architecture-critic]
  reads: [01-standards/, 02-architecture/common/, 10-applications/<app>/02-modern/<module>/<unit>/, 10-applications/<app>/01-legacy/<module>/<unit>/rules-review.md, 10-applications/<app>/_generated/BUSINESS_RULES.md, 10-applications/<app>/00-inputs/INTENT.md]
  writes: [10-applications/<app>/02-modern/<module>/TRANSFORMATION_NOTES.md, 10-applications/<app>/02-modern/<module>/<unit>/]
  gates: [implementation plan approval]
---

Implement unit **`$unit`** (`<module>/<unit>`) of `$app` in **$target_stack**, from its **detail design**, with unit tests that pin what
the design says. The code goes to the **target repository** of `$app` that implements the unit's component (the unit's card
`10-applications/$app/02-modern/<module>/<unit>/README.md`, or `10-applications/$app/02-modern/design.md`, names it), under the unit's folder, on your own branch, committed with an
`Assisted-by: <harness>` trailer.

This command runs in your own harness through Kintsugi's member plugin. Inputs come from the **document repository**, checked out next
to the target repository: the unit's design set folders in `10-applications/$app/02-modern/<module>/<unit>/` (the contract), what is
known about it in `10-applications/$app/01-legacy/<module>/<unit>/`, the common components in
`02-architecture/common/`, and `01-standards/`. The **legacy repositories** of `$app` (one or several) are your local clones, **read-only** (Kintsugi's member
hooks refuse writes to it). Before you start, say in one line which source commits you read: the ones the assessment recorded for `$app`
(`sources` in `10-applications/$app/01-legacy/inventory.md`, and in the portal); check out exactly those commits. The documents cite a file as `<repository id>/<path>`: the first folder is the repository's id in the portal, whatever your local clone is called. If you have no clone
of a legacy repository, stop and say so: nothing can run without the code, and the fix is to clone the repositories the portal lists
for `$app`. What you write in the document repository (`TRANSFORMATION_NOTES.md` and design corrections) goes on your own branch of the document repository and reaches the project through a
pull request. Run every subagent in the foreground and wait for its result: never end your turn while one is still running. Stop any
server or other process you started (a watcher) before you finish, and say you did. **If `$target_stack` is empty**, use the stack named in `02-architecture/blueprint.md` for the unit's
component (with none, the target in `10-applications/$app/00-inputs/INTENT.md`). Say which you picked.

## Step 0 — The design is ready; the toolchain responds; the plan (human gate)

**The detail design is the contract.** Run `python3 scripts/check_design.py $app $unit` from the root of the document repository. It must
exit 0 for every set the unit needs: if a required document is missing or has problems, stop and name them: the next step is
the **Design page of the portal** (generate the set for the unit and merge its pull request), not guessing at the design here. The design must be approved at its stage gate in the
portal; if it is not, say so and stop.

**Target stack (required).** The runtime, package manager and test framework must respond (`java -version` and `mvn -v`, `node -v` and
`npm -v`, `python3 -V` and `pytest --version`). If not, stop and say what to install: a plan gate now would only defer the failure an hour.

Read the detail design, the unit's rules and any verdicts on them in `10-applications/$app/01-legacy/<module>/<unit>/rules-review.md`
(human-owned): a rule marked `refuted` is not pinned (use the reviewer's note for what is right), and a P0 rule marked `clarify` is a
question to settle at this plan gate before any code. Then prepare the plan and **stop: write no code until the plan is approved**
(plan mode if available): which design items are built in which files, the target structure and the common components used, how each
rule and each error case is tested, and anything ambiguous that needs a human decision now. Tell the user to request the
**implementation plan** gate in the portal with this plan, and to re-run `/kintsugi:modernize-implement $app $unit` once the portal
shows it approved. Edits a reviewer makes to the plan at the gate are binding.

## Step 1 — Unit tests first

Spawn the **test-engineer** subagent: "Write the unit tests for unit $unit of $app from its detail design in
`10-applications/$app/02-modern/<module>/<unit>/` (and the legacy source, read-only, at the recorded commit, where the design leaves an
edge unclear). Every business rule, every branch of the design's logic, every error case and message in it gets at least one test with
concrete input and expected output; boundary values (zero, negative, maximum, empty) get explicit cases. Target framework: <right for
$target_stack>. Write to the unit's test folder in the target repository. These tests define 'done'. Name the `RULE-NNN` id(s) each test
pins (from `10-applications/$app/_generated/BUSINESS_RULES.md`) in its name or a one-line comment, so the trace can find it. Follow your
secret-handling rules: no credential from legacy code becomes a fixture; use fake same-shape values and read anything live from
environment variables." Show the user the test file and get a yes before going on.

## Step 2 — Implementation

Write the code in the unit's main folder in the target repository, **exactly as the detail design says**: its structure, names, types,
conditions, messages and error codes, calling the common components by the interfaces `02-architecture/common/` gives. Write what a senior
$target_stack engineer would write, in the project's conventions (`01-standards/conventions/`): not legacy procedure names or layouts, but
the target's idioms (records, streams, injection, proper error types). Link each class to the rule ids and design items it implements in
a short comment.

## Step 3 — Run the tests, and keep the design true

While iterating, run only this unit's tests; run the whole suite once before Step 4.

1. **Run the tests** (the stack's test command in the unit's folder) and show the output. Fix and rerun until green.
2. **Count what ran.** Report `tests executed: N`. A run that executed **zero** tests proved nothing, and a test must **fail, never skip,**
   when a fixture it needs is missing: a suite that is green because everything skipped is not green.
3. **Design and code agree.** The design is the contract, so if the code had to differ (the design was wrong or incomplete), correct the
   detail design in the same document repo pull request, run `python3 scripts/check_design.py $app $unit` again, and list each
   correction in the pull request and in `TRANSFORMATION_NOTES.md`. Never leave the two disagreeing.

## Step 4 — Notes and a side-by-side

Write `10-applications/$app/02-modern/<module>/TRANSFORMATION_NOTES.md`: the target repository, branch and commit it describes; a mapping table
(legacy file:lines at the recorded source commit to target file:lines, per behavior); deliberate deviations from the legacy with
rationale and the corrections made to the design; what was NOT migrated (dead code, unreachable branches) and why; the executed-test
count; follow-ups for the next dependent unit. Show one representative behavior side by side
(`diff -y --width=160 <(sed -n '<lines>p' <legacy file>) <target file>`). Never pick a credential-bearing range, and mask any
credential-like literal in the notes: they are committed to the document repository.

## Step 5 — Architecture review

Kintsugi's review stage runs the **architecture-critic** server-side on your pushed branch: if its review of this commit is on the
target pull request, reuse it; otherwise spawn the **architecture-critic** subagent here to review the code against
the detail design, the common design and $target_stack best practice. Apply HIGH-severity feedback and list the rest in the notes.

Push the target branch and open the target pull request; open (or update) the document repo pull request with everything this command
wrote. Report: tests passing and executed, design corrections made, lines of legacy retired, where the artifacts are (the portal shows
them once the document repo pull request is merged). The next step is the next unit of the wave, or the `understand` stage on the
remaining items when the wave is done.
