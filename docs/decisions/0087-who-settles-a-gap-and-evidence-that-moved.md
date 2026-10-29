# ADR-0087: Say who settles a gap, and tell which cited lines moved

- Status: Accepted
- Date: 2026-10-29
- Decision register: D101
- Amends: [ADR-0057](0057-evidence-marks-and-gaps.md) (the gaps table and its view)

## Context

The gaps table of [ADR-0057](0057-evidence-marks-and-gaps.md) says what the analysis could not settle and what it would cost, but not who can settle it. A project with forty open questions has four kinds of people to ask: whoever owns the source or configuration that is missing, an expert of the business, someone who can read production data or run the system, and someone who can run a check (a tool, the tests). Today the portal's Gaps tab filters by kind and impact; the step from "a question" to "a task for the right person" is left to whoever reads the table. Evidence-first analysis tooling records for each open question the authority required to answer it and the probe that would; the same two fields make a gap actionable here.

The second weakness is staleness. A unit becomes `stale` when the catalog digest of its files moves (ADR-0033): one changed line anywhere marks the whole specification. Nothing says which statements depended on what changed, so a reviewer either re-understands everything or trusts everything. A digest of the lines each citation names, kept when the documents are written, tells exactly which citations the change touched; the rules and gaps that cite them are the statements to check.

## Decision

1. **Two optional columns in the gaps table.** `Settled by` is one of `source-owner`, `expert`, `data`, `check` (`GAP_SETTLERS` in `@kintsugi/domain` and in `gap_resolution.py`, which both plugins share). `Probe` is the one concrete step that would settle the gap. Both are advisory: a row without `Settled by`, or with a value outside the list, reads as its kind's default (`missing-source` → `source-owner`, `unresolved` → `data`, `ambiguous` → `expert`, `unverified` → `check`) and never makes the table invalid, so neither the finish step nor design readiness can fail on them. The skill `evidence-marks` asks the agents to fill them; older tables keep working.
2. **They travel with the gap.** Re-understanding keeps them when it carries answers (`carry_resolutions`); `GAPS.md` gains the two columns and counts the open gaps per settler in its front matter (`openForSourceOwner`, `openForExpert`, `openForData`, `openForCheck`); the reader (`hooks/reader/gaps.ts`) returns `settledBy` (effective) and `probe` and counts `bySettler`; the portal's Gaps view shows them and filters by settler. The shared fixture `scripts/tests/fixtures/gaps/spec.md` holds both parsers to the same reading.
3. **The understanding record keeps a digest per cited range.** With `--src`, `finish_items.py` writes a section *Cited lines* (`Citation | Digest`: each range of source lines the unit's `spec.md`, `rules.md` and `findings.md` cite and that resolves, with the first 16 hex digits of the sha256 of those lines, line endings ignored) and `citedLines` in the front matter.
4. **The plan reports the evidence that moved.** The `plan-understand` stage passes `{src}` to `plan_graph.py`, which, for each understood item, recomputes the digests on the current source and lists the ranges that changed or are gone, each with the rule and gap ids whose citation overlaps it (`drift` in the graph, `evidenceMoved` per item). `check_plan.py` writes them into `01-legacy/plan.md` under *Evidence that moved*. It is advice, like the rest of the plan: it changes no state, and an item stays understood or stale as before.

## Consequences

- The Gaps view becomes a list of tasks per audience, and a probe gives the first step without reading the analysis again.
- After the legacy code changes, a reviewer knows which rules and gaps of an understood unit to check, instead of the whole unit.
- An understanding record grows by one row per cited range. Records written before this change have no section and report no drift.
- A digest compares lines, not meaning: a moved block (lines inserted above it) reads as changed although its text is the same. The report says "check", never "wrong".

## Not done

- Reopening only the answers whose evidence moved: re-understanding still reopens every merged answer of a unit whose catalog digest changed (ADR-0082). The digests make a finer rule possible once the report has proved itself.
- Showing the drift in the portal; it is in `plan.md` for now.
- A required `Settled by`: it stays optional until the agents fill it reliably, which the known-answer eval can measure.

## Alternatives considered

- **Settled by as a strict, validated column.** A wrong value would fail the finish step or block a design over advice; the kind already gives a sound default.
- **A fifth gap kind per audience.** The kind says what is missing, the settler who can supply it; folding them together loses one of the two.
- **Drift by diffing the repository between two commits.** It needs both commits in the workspace and maps poorly to citations; a digest per cited range needs only the current checkout.
