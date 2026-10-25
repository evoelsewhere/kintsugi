# ADR-0057: Evidence marks and gaps in reverse engineering and design

- Status: Accepted
- Date: 2026-10-22
- Decision register: D73

Reference ID policy amended by [ADR-0075](0075-compact-stable-document-reference-ids.md). Historical formats below remain readable.

## Context

Reverse engineering works on incomplete evidence. Copybooks, called programs, job and deployment descriptors, table
definitions and libraries are missing from the repositories; some behavior depends on data nobody can see; some rules
look wrong and nobody remembers why. The understanding documents handled this unevenly:

- a rule card has a `Confidence` (High, Medium, Low) with a question below High;
- a specification had a free-text "Open questions" section, and `trace.md` an `openQuestions` number the agent
  supplied itself;
- the analyst was asked to write "(inferred)" and a "Confidence & Gaps" footer;
- nothing said what kind of thing was missing, how much it mattered, or that a later document must not settle it
  silently.

The consequence shows in the design stage. The designer reads the specification and, with no marker, writes a
confident design over a gap: a builder implements the guess. The review (ADR-0054) could only catch it when the
reviewer happened to notice. A survey of public tooling for this problem (Reversa, a reverse documentation framework,
marks every statement as confirmed, inferred or a gap and keeps gaps and questions apart from the text) agrees with
the direction: the value is in separating what the code shows from what it does not, and in keeping the second list.

## Decision

**1. Every statement about the legacy system has one of three marks**, defined by the shared skill `evidence-marks`
(plugin `reverse_engineering`, used by `legacy-analyst`, `business-rules-extractor`, `designer` and
`design-reviewer`):

| Mark | Meaning | Written |
| --- | --- | --- |
| confirmed | the executable code, or config it reads, does this | a citation `<repository id>/<path>:line` |
| inferred | deduced from names, structure or data | `(inferred)` and its evidence |
| gap | the code, as provided, cannot settle it | `(gap: GAP-…)` and a row in the gaps table |

A rule card's `Confidence` is the same scale (High = confirmed, Medium = inferred, Low = gap) and keeps its form:
the readers and the rule files do not change.

**2. A specification ends with `## Gaps and questions`**, a table `ID | Kind | Question | Where | Impact`, one row
per gap (`None.` when there is none). The id is `GAP-<module>.<unit>-NN`, numbered inside the unit. The kind is one of
`missing-source`, `unresolved`, `ambiguous`, `unverified`; the impact is `blocking`, `risk` or `note`. A rule below
High confidence is a row too (`ambiguous`, `Where` = its rule id), so the unit's open questions are in one place.
The section replaces "Open questions"; no old form is read.

**3. The count is derived, not reported.** `finish_items.py` reads the table and writes its number of rows as the
`openQuestions` of `trace.md` (the agent's own count is used only when the specification has no such section). It
reports on its output a table that does not read: a duplicate id, a kind or an impact outside the lists, an id that is
not a gap id, a missing section. It does not fail the run: the pull request is where a person corrects it. The
aggregates, the API and the portal keep reading `openQuestions`.

**4. Design carries the gaps forward.** The `designer` reads the unit's gaps and never decides a `blocking` gap, or a
rule marked `clarify`, silently: it writes an open question by id with the assumption made, and a `risk` gap gets the
assumption in the section it affects. A gap the designer finds itself becomes an open question without a `GAP-` id
(those belong to the specification and are renumbered when it is regenerated). The `design-reviewer` reports a
blocking gap decided silently as a `major` finding of category `clarity` (a risk gap, `minor`); no new category is
added.

**5. The designer's instructions become skills.** The long `designer` prompt is split along what is reused:
`design-template-contract` (how to read and fill the project's template), `design-writing` (the craft: identifiers,
design from the specification, the level for the reader, one diagram per level with prose, gaps) and `evidence-marks`.
The agent file keeps the job's procedure and write scope. The plugins' versions move to `design` 1.2.0 and
`reverse_engineering` 1.1.0; `designer` 2.1.0, `design-reviewer` 1.1.0, `legacy-analyst` 1.2.0 and
`business-rules-extractor` 1.2.0.

## Consequences

- A reviewer of a specification sees, in one table, what the analysis could not establish and what it would cost;
  an answer from a person is written where the gap was found, in the pull request that carries the document.
- A design cannot look surer than its source: the unit's blocking gaps show up in it as questions with assumptions,
  and the reviewer checks it.
- Existing specifications still have "Open questions"; their count falls back to the agent's number until the unit
  is understood again. Nothing reads the old section.
- The deterministic check is shallow on purpose: it checks the shape of the table, not whether a gap is real or
  complete. That stays a judgment of the analyst and the reviewer.

**6. The gaps are one view, not one more document per unit.** The specification's table is the register.
`rebuild_aggregates.py` joins the understood units' tables into `_generated/GAPS.md` (blocking first, counts by impact
and kind in the front matter), like the other aggregates. The reader `hooks/reader/gaps.ts` parses a specification's
table and `GAPS.md`; the shared fixture `scripts/tests/fixtures/gaps/spec.md` keeps it equal to `gaps_common.py`. The
API serves the view `gaps` of the understand results (`GET …/understand/results?view=gaps`, with `item` for one unit:
then its own specification is read, and `noSection` says it predates the table), and the portal's Understand → Results
has a **Gaps** tab: counts per impact and kind that filter the table, a link from a row to its unit. A row whose kind
or impact is not one of the lists is counted in `openQuestions` (a question is never lost) but is left out of the
view, and `finish_items.py` reports it.

## Not done

- A script check that every `blocking` gap is mentioned in a design (`check_design.py`). It would need either a new
  template directive (with its copy in the reader and the shared fixtures) or a warning that is not part of the
  fix round; it waits for the format to prove itself on real runs.
- Gaps of the application as a whole: the assessment's "Documentation gaps" stay free text (bullets in
  `assessment.md`). A table of the same form with ids `GAP-<app>-NN` can join the view when the assessment turns out to
  record `missing-source` gaps that touch every unit.
- A confirmed/inferred/gap column in the rule cards: the `Confidence` field already carries it.

## Alternatives considered

- **Emoji marks** (as in some tools): the repository's documents are plain Markdown tables and front matter, and a
  word survives copy, search and a script's parse.
- **A fourth kind for design-origin questions**: a design question is not a fact about the legacy code; it stays in the
  design's open questions.
