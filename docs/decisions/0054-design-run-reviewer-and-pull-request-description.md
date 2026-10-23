# ADR-0054: A design run is reviewed by an independent reviewer and arrives with a review as its description

- Status: Accepted (amends [0049](0049-design-sets-generated-by-the-runtime.md); the first step of the design pipeline, the other roles are listed as follow-up)
- Date: 2026-10-22
- Decision register: D70

## Context

The design stage ([ADR-0049](0049-design-sets-generated-by-the-runtime.md)) has one agent, the `designer`, which writes a document, and later fixes it from the report of `check_design.py`. The checks are mechanical: every required section, the table columns, the ids, every rule named in a column. They cannot tell whether a design is *right*:

- A rule can be "covered" by an id in a cell while the logic written for it is wrong or empty of detail.
- Behaviour of the old system that the unit specification describes can be missing from the design, with no rule pointing at it.
- Nobody but the author reads the result before a person does. The person who reviews the pull request sees a list of files and has to find the weak spots alone.

The same agent that wrote a document is a poor judge of it. A review needs a different job with its own instructions, reading the result against the specification of the old system rather than against the author's intent.

Nobody takes part in a run; a person reviews the merge request only. The reviewer must therefore leave the person something to read first.

## Decision

**1. A design run has a review step**, between the first check and the fix round:

```text
scaffold → designer per unit → check → reviewer per unit → check-review → fix (flagged units) → check-final → summary
```

The reviewer is a second agent of the `design` plugin, `design-reviewer`. It runs per unit, read-only, in its own job, and does not see the designer's reasoning: it reads the documents as written, the unit's AS-IS specification and rules, the set's templates and instructions, the example of each document where there is one, and the check report.

**2. It audits what the checks cannot.** For each document and section it reports a finding with a severity and a category:

| Severity | Meaning |
|---|---|
| `blocker` | wrong or missing behaviour a builder would get wrong; a rule left uncovered in substance |
| `major` | detail a builder would have to guess; a clarify rule decided instead of asked |
| `minor` | wording, order, or something a person can fix in review |

| Category | What it looks at |
|---|---|
| `fidelity` | behaviour of the AS-IS specification that the design drops or changes without saying so |
| `coverage` | a rule named in a cell but not designed (empty or generic logic) |
| `consistency` | an id, name or type that differs between documents of the set or the unit |
| `clarity` | too vague to build from: names, types, conditions, messages and codes unwritten |
| `convention` | a project standard (`01-standards/`) or a common component not followed |
| `id` | an id used that does not exist, or reused for something else |

**3. The reviewer writes a note per unit**, a Markdown document in the run's scratch (intermediate, never published): `scratch/<app>/design/review/<module>/<unit>.md`, with front matter `unit` and a table `Severity | Document | Section | Category | Finding | Suggestion`. `check_review.py` reads the notes, rejects one that does not parse (that unit counts as *not reviewed*, not as clean) and writes `scratch/<app>/design/review-report.json`: per unit the counts and the findings. The plan reads that report, as it reads the check report.

**4. The fix round takes both reports.** A unit is fixed when the check flagged it or the review found a `blocker` or a `major`. The designer is told to change only what the check problems and the blockers and majors name, and to leave the minors to the person. After the fix the check runs again; the reviewer does not run a second time (a bound on cost: one review per unit per run).

**5. A unit ends in one of three states**, computed by `render_design_review.py` from the final check and the review: `ready` (the final check passes and the review found nothing), `ready-with-findings` (the final check passes and the review reported findings: the blockers and majors went to the fix round and are not reviewed again, the minors are left for the person), `incomplete` (the final check fails, or the unit was not reviewed). No state is a failure of the run; a run never stops on a finding.

**6. The review is the description of the pull request.** The script writes `scratch/<app>/design/review.md` (intermediate): the state of each unit, the counts, and the open findings with their document and section, the largest first. The stage plan names it as its `description`; the runner reads it from the run's work area (at most 60,000 characters, redacted) and passes it in the write request; the writer puts it between the message and the file list. The reviewer's notes themselves are not committed.

**7. Agents are roles in the pipeline, not types of document** ([ADR-0050](0050-design-sets-scope-and-instructions.md)). What differs by kind of design stays in the set, its profile and its instructions ([ADR-0053](0053-design-template-profiles-by-unit-kind.md)); the reviewer reads the same files as the designer.

## Consequences

- A run costs one more agent job per unit. The run is capped by the stage's agent limit; a design run counts the reviewer jobs in it (units × (2 + a fix)), so the number of units one run takes drops (`min(20, maxAgents/3)`).
- The person reviewing the pull request starts from what the reviewer found, and from which units to read first.
- The reviewer can be wrong. Its findings are advice to the fix round and to the person; only the check can fail a file.
- Not in this decision, kept as the next steps of the pipeline: a mapper that builds the AS-IS ⇔ rule ⇔ requirement ⇔ component map before drafting, a contract pass for what the units share, and a fidelity probe that rebuilds behaviour from the design and compares it with the specification.

## Alternatives considered

- **The designer reviews its own work in a second pass.** Cheaper, but it shares the blind spots of the first pass. Rejected.
- **More mechanical checks instead of a reviewer.** The closed vocabulary of checks stays small on purpose ([ADR-0045](0045-design-templates-are-project-data.md)); fidelity and clarity are judgements.
- **Commit the reviewer's notes.** They would age with the next run and clutter the document repo; the pull request description is read once.
- **A second review after the fix.** Doubles the cost for the units that most need attention; the person reads what is left.
