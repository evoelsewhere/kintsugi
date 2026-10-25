# ADR-0078: Give project agents an immediate memory learning lifecycle

- Status: Accepted
- Date: 2026-10-25
- Decision register: D92
- Supersedes: [ADR-0076](0076-project-memory-for-understand.md) navigation-only and acceptance-before-retrieval policy; [ADR-0077](0077-agent-directed-live-memory.md) staging, Understand-only participation and four-tool subset. Its live, caller-bound IPC and no-snapshot/no-injection decisions remain.

## Context

The initial memory implementation copied the tool names from pi-memory but only saved navigation proposals after output checks and human review. An agent could not write a lesson and read it back, and other stages could not share it. This acted as a document-review queue instead of memory. The user requested the complete agent learning loop while retaining live reads, no snapshots and no automatic context injection.

## Decision

1. Store operational notes of kinds `fact`, `lesson`, `decision` and `navigation`. Every note has Markdown content, a summary, tags, provenance and a trust state. `long_term` holds durable knowledge; `daily` records notes under a UTC calendar day. Project scope is the default; application scope is optional and bound to the caller's application.
2. `memory_write` commits a learned note immediately and returns its ID. The same job and eligible later jobs can read it without waiting for a job outcome, document publication or review. Source evidence is optional; when supplied, its repository/path and optional exact excerpt must match a readable pinned checkout, and the worker supplies the revision. Such evidence-bound notes are only retrieved against matching source pins and current repository links.
3. Persistence and trust are separate. Agent writes are `learned`, never self-approved. A manager can mark a note `approved` (shown as reviewed) or reject it. Learned notes retain their originating stage, agent, run/step and current producer status, including running/failed/unknown. They are unverified reference data, never new project instructions or replacements for Git documents.
4. Enable memory for application-scoped runtime agents across Assess, Understand, Design and other jobs. The caller's ordinary `read` tool permission gates memory access; `write` additionally gates mutation tools. Independent reviewers (review stage or reviewer agent) receive read-only access to reviewed notes and exclude notes from their current top-level run.
5. Provide seven optional tools: `memory_write`, `memory_read`, `memory_search`, `memory_status`, `memory_forget`, `memory_restore`, `scratchpad`. An agent chooses when to call them. No mandatory task instruction or memory body is injected. Search is PostgreSQL full-text; no QMD, embedding service or additional LLM call is introduced.
6. Forget is reversible soft deletion of an immutable learned note, with a durable recovery ID. Restore explicitly reactivates it. Agents cannot alter reviewed/rejected trust. Management endpoints can forget/restore any note under the existing memory-management permission and audit the operation. Recovery stores deletion metadata while the original content stays in its row; it is not a run snapshot of a memory corpus.
7. Scratchpad is a persistent checklist scoped to the top-level run. Add/done/undo/clear/list operate on item IDs in Postgres transactions, without concurrent file rewrites. It survives retries and is not retrieved as knowledge by another run. Clear removes completed items only.
8. Serialize mutations with the project's setting row on one transaction connection. Reset deletes notes, their recovery records and scratchpads and advances a write-revocation epoch. Disable stops access and revokes old in-flight writes while retaining records for re-enable. Epochs contain no memory corpus. General notes survive repository changes; current links and exact revisions filter evidence-bound notes. Project/application removal cascades scoped data; source-job removal clears the live foreign-key reference without deleting the long-term note.
9. Bound inputs, pages, RPC payloads and storage. Reuse the credential-shaped-text checks but disable the broad opaque-token heuristic for note content so legitimate hashes and run IDs are not treated as secrets. The heuristic remains enabled for logs. This is not comprehensive sensitive-data detection; tools instruct agents to omit credentials and personal data.
10. Keep the live-memory retry rule: participating steps re-execute on later attempts because their memory inputs can change. New protocol version `memory-v2` invalidates reuse of the prior navigation-only integration. Existing tool traces and seven operation counters report use; no note bodies are added to the run console.

## Consequences

- Agents can remember and recall knowledge during the same job and share it across stages and runs. Failed runs can preserve useful lessons without silently turning them into approved project facts.
- Human review raises trust instead of blocking the learning loop. A note called a fact/decision is still unverified until reviewed; standards and formal decisions remain in Git.
- Immediate persistence means rejected or abandoned job output does not automatically erase its learned notes. Managers and agents can forget misleading learned content; provenance and trust remain visible on reads.
- There are no automatic exit summaries, compaction handoffs or prompt-cache snapshots. These pi-memory conveniences would require separate accounting and are not needed for the explicit tool learning loop.
- Storage is Postgres rather than Markdown memory files, matching the installation's datastore contract. Tool semantics follow pi-memory's persistent notes, daily logs, checklist and reversible deletion while project scope and reviewer policy are Kintsugi adaptations.
- Build/type checking is not proof of recall quality or net savings. Live database/child-process integration and real-provider evaluation remain necessary before claiming production effectiveness.

## Alternatives considered

- **Review every memory write before recall.** Rejected: prevents the agent learning loop; review is a separate trust transition.
- **Require a source quote for every note.** Rejected: lessons, preferences and workflow decisions may not be facts extracted from code. Optional evidence is verified when present.
- **Automatically treat successful-run memory as reviewed.** Rejected: job success is not human verification of a claim.
- **Share a global scratchpad across projects.** Rejected: project scope is mandatory, and checklists belong to a run.
