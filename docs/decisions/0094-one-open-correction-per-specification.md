# ADR-0094: One open correction per specification, shown on its gaps

- Status: Accepted
- Date: 2026-11-01
- Decision register: D108
- Amends: [ADR-0019](0019-workspace-repo-write-path.md) (corrections record what they answer), [ADR-0087](0087-who-settles-a-gap-and-evidence-that-moved.md) (the Gaps view shows an answer waiting for review)

## Context

A person answers a gap in the portal (Understand → Gaps → *Answer*). The API edits that gap's row of the specification's *Gaps and questions* table and hands the document to the writer as a correction (`kind: state-change`, every file to review), which opens a pull request on a new branch `kintsugi/<actor>/<write id>`.

Two things went wrong with several answers on one specification. Nothing recorded which gap a write answered, so the Gaps view still read *Open · — · Answer* after an answer was proposed, and the same gap could be answered again. And every answer opened its own branch from the default branch: the first answer adds the *Status*, *Answer* and *Evidence* columns to the table header, so each pull request changes the header, and after one is merged the others conflict on the same lines. The pull request body also did not carry the answer: a reviewer had to open the diff to read it.

Amending an open correction's branch with the next answer would avoid the extra pull requests, but the writer names a branch after the write and never updates the body of a pull request it already opened, on any of the four Git hosts.

## Decision

1. **A correction records what it answers.** `workflow.document_write.correction` (migration `047_document_write_correction.sql`) holds `{ path, gap }`: the specification and the gap id. Other writes leave it empty.
2. **A correction is open** while it is `queued`, or `committed` / `pr-opened` on its review branch. It stops being open when the worker sees its pull request merged or closed (ADR-0019 implementation notes, `merged` / `closed`).
3. **One open correction per specification.** Answering a gap of a specification that has an open correction is refused with `409`: "A correction for this specification is already open: PR #<n>. Review or merge it first." (or, before the writer has opened the pull request, that it is queued). The check and the insert run in one transaction under an advisory lock per project and path, so two answers sent at once cannot both pass. After the pull request is merged or closed, the next answer starts a new branch from the default branch, which then holds the first answer.
4. **The Gaps view shows the open correction.** Each gap of the application's and of a unit's gaps view carries `openWrite { id, status, prUrl?, prNumber? }` when an open correction answers it. The portal shows *Answer proposed · PR #<n>* in its status and turns *Answer* into *View pull request*, or *Proposal queued* before the pull request exists. Gaps without one are shown as before.
5. **The pull request carries the answer.** The correction's description (the `description` of the write request, between the message and the file list) names the gap, the answer and its evidence.
6. An answer still changes only its own row of the table (`answerSpecGap`): other rows stay byte-identical.

## Consequences

- Answers on one specification are reviewed one pull request at a time; nobody redoes a pull request that conflicts with a merged one.
- A person who answers several gaps of one specification waits for the first pull request to be merged or closed before the next answer. That is slower than collecting the answers on one branch; see *Not done*.
- Writes recorded before this change have no `correction`: their gaps show no open answer. A correction opened before the change and still open is not found by the check.

## Not done

- **Amending the open branch** with the next answer, and regenerating the pull request body with every answer on it. It needs a stable branch key in the write request and a body update on an existing pull request in the writer (`services/orchestrator/src/document-write/writer.ts`) and in the four pull-request providers (`packages/git`).

## Alternatives considered

- **A warning instead of a refusal.** The person would still open a pull request that conflicts once the first is merged.
- **Reading the open state from the pull request title** (`Resolve <gap> in <app>/<item>`). The title is free text; a column says it once and can be indexed.
