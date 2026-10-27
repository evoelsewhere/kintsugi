# ADR-0083: Design in dependency order and verify until a round finds nothing open

- Status: Accepted
- Date: 2026-10-27
- Decision register: D97
- Amends: [ADR-0054](0054-design-run-reviewer-and-pull-request-description.md) decisions 1, 4, 5 and 6, and its rejected alternative "A second review after the fix"; [ADR-0049](0049-design-sets-generated-by-the-runtime.md) step table.

## Context

The design run was a straight line: scaffold, a designer per unit, a structural check, a reviewer per unit, one fix round, a structural check, a summary. Reading it end to end showed four weaknesses:

1. **A fix was never verified.** ADR-0054 chose one review per unit per run for cost. After the fix round only the structural check ran again, so a blocker the designer "fixed" could be unchanged or replaced by another, and the pull request still called the unit `ready-with-findings` with no sign of which.
2. **Units were designed in isolation.** A designer saw the common design and the specification of its own unit, never the design of a unit it calls. Nothing checked the interfaces between units, the shared identifiers or the shared data. ADR-0054 listed a contract pass among its next steps.
3. **Nothing showed which requirement no design takes.** The checks cover the rules of each unit and that a `REQ-` id exists, not that every requirement is referred to.
4. **One lens.** The reviewer judged fidelity to the specification; the application's own design had no skeptical architecture review (`architecture-critic` is run by no stage).

## Decision

1. **Order by what units call.** A script, `map_design.py`, reads the `Depends on` and `Used by` links of the catalog cards and writes a map (scratch): the selected units in **waves**, a unit after the units it calls (units that call each other share a wave), and **clusters** of selected units that are linked, with the neighbours outside the run that already have a design of the set (read-only **peers**). A designer is told to read the designs of the units it calls and to meet their interfaces exactly, or to write the open question. The stage runs the waves as rounds of a `repeat` step.
2. **Verify until clean, with no round limit.** After the first structural check the stage repeats a round: the design-reviewer reads each unit that needs it, the contract-reviewer reads each cluster, `check_review.py` merges their notes, a designer fixes each unit with a blocker, a major or a failing check, and the structural check runs again. The first round reviews every unit; a later round reviews again only the units the previous one fixed (or whose note could not be read) and the clusters they belong to. There is **no maximum number of rounds**. The loop ends when:
   - **clean**: a round's review finds no blocker, no major, no failing check and no unreadable note (so nothing was fixed after it);
   - **stalled**: `open`, the sum of blockers, majors, failing units and unreadable notes, did not fall below the lowest earlier value for two rounds in a row, or the same blocker/major fingerprints came back with no improvement. No fix runs after a stall, because it could not be reviewed;
   - **the stage's agent cap** (`maxAgents`) leaves no job for another round, or a round starts no agent job (executor guards, `repeat` without `max`).
   A unit that is still wrong is carried by the pull request, never a failure of the run (unchanged from ADR-0049). An unreadable reviewer note stays open and is asked again; it is never read as clean.
3. **A contract reviewer.** A new runtime agent, `contract-reviewer`, runs per cluster. It reads the designs of the cluster's units together with the specifications, the catalog links, the common design and the peers' merged designs, and reports where two designs disagree about an interface, message, identifier or shared data, or where nobody takes a responsibility that crosses a boundary. Its note has the same table as a unit review, and each finding names the **document of a unit of the cluster that has to change**, so the finding is fixed by the designer of that unit. Categories `contract` and `architecture` are added to the closed list.
4. **An architecture lens.** For a set of scope `application`, the design-reviewer also applies a skeptical architecture lens (seams, simpler alternatives, unstated non-functional requirements, migration and failure paths). `architecture-critic` stays as an agent; no stage runs it.
5. **Findings have identity.** `check_review.py` gives each finding a fingerprint (unit, document, section, category and normalised wording) and keeps the rounds in a scratch history, so a finding that disappeared is counted as fixed and one that stays is recognised. The reviewers are told to repeat a remaining problem in the same words.
6. **Coverage is reported.** `check_coverage.py` lists the requirements that no design of the set refers to, across the merged designs and the run. It is information for the pull request and never fails a run.
7. **The pull request says how it ended.** The description gives the rounds, the reason the loop stopped (verified after its fixes, stalled, or stopped at a limit with the last fix unreviewed), the number of findings fixed, the open findings and the requirement coverage. A unit is `ready` only when the last review round found nothing for it.

The mechanical vocabulary of ADR-0045 is unchanged: a check that a column's ids exist in other units' designs (`refs-resolve(Column -> peers)`) is not added; the contract reviewer covers it.

## Consequences

- A design run costs more: at least a writer and a reviewer per unit and a reviewer per cluster, and every fix adds a review. The start check requires `2 × units + clusters` agent jobs; the loop spends what is left and stops at the cap. A wider selection or a stubborn finding raises the cost; the stall rule bounds it, and the stage's agent cap and the job cost limits remain the final bound.
- Waves make a long dependency chain sequential (one wave per level), so such a selection takes longer than the old fully parallel write.
- A reviewer can be wrong, and the loop can spend rounds on a finding a person would dismiss; the stall rule and the pull request's open list are the answer, not an override.
- The reviewers and the designer are told they may see the same unit again; a fix can open a new finding, which the next round reports.
- The structural check and the reviewers still do not prove that the design is right; a person reviews the pull request.
- New scratch files under `scratch/<app>/design/`: `map.json`, `contract/<cluster>.md`, `progress.json`, `coverage.json`. The plugin `modernize` becomes 5.0.0 and the plan gains `repeat` members that fan out (`RepeatStep`, without `max`).

## Alternatives considered

- **A fixed number of rounds.** Simple and bounded, but it stops a design that is one fix from clean or keeps going on one that cannot improve; the stall rule measures progress instead.
- **Review every unit in every round.** Safer against a fix that damages another document, but several times the cost; a unit that was not fixed was not changed.
- **Contract checks as a script only.** Cheap, but the interface of a unit is prose in a project-defined template; a script cannot compare two designs it cannot parse.
- **One designer for all units of a cluster.** Consistent by construction, but a large context and a single point of failure; one job per unit with the callee first keeps jobs small.
- **Run `architecture-critic` as a second reviewer of every unit.** Doubles the review cost for a lens that matters most for the application's own design.
