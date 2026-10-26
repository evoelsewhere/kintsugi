# ADR-0082: Check design readiness, distinguish drafts and resolve questions in place

- Status: Accepted
- Date: 2026-10-26
- Decision register: D96

## Context

A successful assess run does not prove that a selected unit has been understood. A unit card can exist without a
current specification or rules; a specification can still contain a blocking gap; regeneration previously bypassed
prerequisites. The portal and worker also need to agree about what constitutes an acceptable input. Refusing work
without explaining how to unblock it invites guessed answers or repeated failed jobs.

ADR-0057 recorded gaps but had no explicit resolution state. Answers must update the original question, never create
a separate answer register. ADR-0081 deliberately discarded decisions made in the previous design; that is unsuitable
for reviewed answers. The runtime/member ownership and the Git write boundary remain those of ADR-0029/0071.

## Decision

1. **Final generation checks evidence.** Unit-scoped Generate and Regenerate require an active catalog unit, its merged
   understanding record matching the catalog digest, the specification and rules, the specification profile's
   required sections, a readable gaps register, no open blocking gap, and no unresolved rule clarification. A
   zero-rule unit is valid when its rules document explicitly records that result. Applicable `needs` sets must be
   conformant or explicitly waived; the existing policy for designs from an earlier template version stays valid.
   A deliberately inapplicable unit-kind dependency requires no document. An undefined dependency is never accepted.
   Application-scoped design uses its merged assessment and application dependencies; it does not certify that every unit has been understood.
2. **One revision.** The API reads the overview first and loads the template definitions at that commit, pins it in
   the run, and refuses incomplete final selections with actionable conflicts. The worker's scaffold repeats the
   evidence and dependency checks before any designer starts, including on retries. Missing mandatory input never
   becomes an empty successful result. Before generation, the worker also checks capacity for generation and independent
   review. The generic workflow executor rechecks its shared token budget after taking a concurrency slot.
3. **Draft is an explicit request.** `draft: true` in a design selection permits incomplete evidence and design
   dependencies. It bypasses neither the active catalog scope, template validity, busy selection, authorization nor
   repository isolation. Before publication the stage rejects any file outside the selected design-set folders or any non-Markdown output; the marker script is bounded to those same folders. Catalog units can appear before understand has created their unit card, so a person can
   deliberately explore their draft design. After the agent and fix round the worker stamps every generated design
   document `draft: true`; the PR title and description say draft and list the missing evidence. The checkers treat
   the marker as a conformance problem. Merging the draft does not make it final or satisfy a dependency. Resolve and
   merge the inputs, then regenerate without draft. The Build view and review preparation reject draft designs; the
   member build command checks the same boundary before implementation.
4. **Answers stay with their questions.** The specification's existing `Gaps and questions` table gains optional
   `Status`, `Answer`, `Evidence` columns. No status means open for older documents. Only `resolved` with a meaningful
   answer and evidence clears a blocking row. Unknown states, placeholders, malformed rows and orphaned gap references
   are preflight problems. Keep the ID, original question, impact and source location; reopening changes the status
   and records why in the same row. An accepted expert decision is evidence of that decision, not a claim that code
   was observed. Rule corrections belong in the rule/card and existing `rules-review.md`; design-origin questions
   belong in the design section that raised them.
5. **Portal corrections are reviewed writes.** `documents.resolve`, added by migration and granted initially only
   to admin, permits a bounded answer edit to a named gap at its canonical specification path. The API checks the
   document the user read against the current default branch; the shared writer checks its SHA-256 again before
   modifying files. A correction always proposes one PR (or branch on plain Git), even for auto-commit paths. Git
   merge is when it takes effect; audit stores identity and paths, not answer contents. An unrelated file change
   does not invalidate the edit; a changed specification requires reload. No arbitrary path/content write API is added.
6. **Regeneration preserves decisions.** Re-understanding carries previously merged answers at their original
   specification rows, retaining answered rows the model omitted. Changed unit evidence reopens them while preserving
   the answer for review. Newly generated text cannot resolve a question on its own. Design regeneration reads the
   previous design retained in private job scratch before skeletons overlay the inputs, and preserves supported reviewed
   answers/decisions in the corresponding sections of the current
   template; contradictions become explicit review points. This is a semantic task reviewed in the PR, not an
   automatic text merge. A previous draft/assumption never becomes evidence just because it existed.
7. **Build activity belongs to an application.** Member `build.test`/`build.mr` records include `detail.application`.
   The Build view filters on it before joining records to unit keys. Legacy records without an application are
   accepted only for projects with one application; ambiguous records must be recorded again. This prevents a unit
   key shared by two applications from selecting the other application's merge request.

## Consequences

- Earlier incomplete inputs can now yield a final-run conflict. The response names the missing evidence, and the
  portal offers a distinct draft mode; this is an intentional policy tightening.
- There is one Markdown source for each answer. `_generated/GAPS.md` and question counts are rebuilt views; a merge
  can need a mirror sync/rebuild before the application aggregate catches up. Final readiness reads specifications
  directly at the pinned revision and does not trust a stale aggregate.
- Older five-column tables remain readable and open. No project document migration or extra datastore is required.
- The worker remains generic at the kernel boundary. Evidence/dependency checks live in the delivery application
  and built-in plugin scripts, never in runtime model/tool policy.
- This amends the gap/draft policy of ADR-0057 and the readiness/decision-preservation policy of ADR-0081. It does not
  replace human PR review, prove semantic completeness, execute target code in the runtime, or implement `verify`.

## Alternatives considered

- A separate answers file or database register: duplicates the question's truth and requires joins/version reconciliation.
- Always refuse incomplete work: prevents useful exploratory designs; an explicitly marked draft provides that path.
- Prompt-only guards: a retry/direct worker run or a dropped draft marker can bypass them; deterministic checks are required.
- Always carry a previous answer as resolved: unsafe when the supporting unit evidence has changed.
