# Resolve questions and generate a design

A final unit design needs current, merged understanding and its applicable design prerequisites. Application-scoped design
uses its assessment and application dependencies; it does not certify that every unit has been understood. A draft can help explore
an incomplete unit, but cannot authorize implementation or unlock a later design set.

## Check what is missing

On **Delivery → Design → Units**, choose the design set. **Input needed** and the disabled selection explain what is
missing: a current understand result, the rules/specification, a blocking question, a rule needing clarification, or a
required design set. Generate and Regenerate use the same guard. The API checks again when the run is submitted.

1. Run **Understand** for a unit whose understanding is absent/stale and merge its PR.
2. Review uncertain rules. Correct the rule's own evidence/statement and its existing review ledger at
   `10-applications/<app>/01-legacy/<module>/<unit>/rules-review.md`; a `clarify` verdict is still unresolved.
3. Generate and merge conformant prerequisite design sets. A waived document needs its existing recorded reason.
4. Resolve blocking gaps as below. Risk/note gaps can remain with explicit assumptions. On **Understand → Results →
   Gaps**, filter by **Settled by** to hand each open question to whoever can answer it (the owner of a missing source,
   an expert, production data, or a check); its **Probe** says what to do first.

When the legacy source changes, the next **Plan understand** run lists in `01-legacy/plan.md`, under *Evidence that
moved*, the cited lines of understood units that changed since they were written, with the rules and gaps that cite
them. Understand those units again before a design relies on them.

A catalog unit can appear on Design before Understand creates its card. Its final design remains blocked. Retired or
unknown catalog units must first be reconciled through Assess, including for draft work.

## Answer a gap at its original location

Open **Understand → Results → Gaps**, at the default branch. Select **Answer** on the question, enter the answer and
its evidence, and choose whether the correction will resolve it. This needs `documents.resolve`, granted through the
installation's permission catalog. The writer queues a PR; find it under the project's document writes, review the
specification diff and merge it. A plain Git server produces a branch for the same review.

The change updates the existing specification, for example:

```markdown
## Gaps and questions

| ID | Kind | Question | Where | Impact | Settled by | Probe | Status | Answer | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GAP-BILL01-0001 | ambiguous | Which rounding rule applies? | legacy/tax.cbl:41 | blocking | expert | Ask the finance owner which rounding the invoices must follow. | resolved | Round down to cents after summing the invoice. | REQ-17, confirmed by the finance owner in the reviewed requirement. |
```

Keep the ID, question, impact and source location. Update any affected behavior explanation in this same specification
as part of the PR; correct linked rules/design sections when the decision changes them. Do not create an answers file,
edit `_generated/GAPS.md`, or treat a chat answer as a merged project decision. An assumption without evidence stays
open. `TODO`, `TBD`, empty answers and an unsupported status do not resolve a blocking gap.

Use **Reopen / edit** when an answer is withdrawn; explain why and cite the new evidence in the same row. When the
specification has changed since it was read, reload before proposing the correction: the API and writer protect the
newer content. A second correction based on an older pending PR may conflict; merge the first, reload and propose again.

For older specifications with no gaps section, run Understand again or repair the original specification through a
reviewed PR. A missing register is not proof of no gaps. An explicit empty register is `None.`.

After merge, allow the mirror to sync and rebuild the application views. Start a new Generate/Regenerate run to use
the new answers; Resume intentionally keeps a failed run's original pinned inputs. Readiness checks the original specification
at the chosen commit. Re-understanding preserves merged answers in that location, but reopens them if the unit's
catalog digest changes; review the old answer against the new evidence.

## Deliberately generate a draft

On Design → Units, enable **Generate as draft**, then select units and confirm **Generate draft design**. Use Regenerate
with the same option to explore a revision of a design that already exists. Invalid templates, busy units and unknown
scope still block the run.

Every generated document is stamped `draft: true`, and the PR lists the missing evidence. Drafts remain drafts after
merge. Resolve the inputs and merge the corrections, then choose **Regenerate** with draft off to propose the final
design. Review its PR before merging. A final run can still report conformance/reviewer findings; inspect those findings
instead of treating the run's success as an approval.

Design-origin questions are answered in the design section/table that asked them, with their evidence, using the
project's template. During regeneration the designer reads the previous design to preserve supported decisions in
corresponding sections. Inspect the PR diff: preserving free-form decisions is a semantic review, not a guaranteed
mechanical merge.

## Continue with the member build

Use `/modernize:build` only with the current merged evidence and a final design. The member command stops for draft
markers, unresolved blocking questions and missing prerequisites before writing code. Its plan still needs the member's
approval. Build activity records the application id as well as the unit key; re-record older activity in projects with
several applications so that another application's merge request cannot be selected accidentally.
