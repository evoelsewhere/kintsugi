# ADR-0076: Project memory supplies reviewed source navigation hints to Understand

- Status: Accepted; runtime integration, snapshots and prompt injection superseded by [ADR-0077](0077-agent-directed-live-memory.md)
- Memory authority and staging superseded by [ADR-0078](0078-agent-memory-learning-lifecycle.md).
- Date: 2026-10-25
- Decision register: D90

## Context

Related Understand jobs repeatedly discover shared source definitions and utilities. Prompt caching reduces the price of shared request prefixes and the durable step ledger skips completed work on retry, but neither preserves discoveries between independent runs. The pi-memory extension demonstrates persistent notes and bounded context snapshots. Its shared file rewrites, optional QMD SQLite index, automatic LLM summaries and session-centric provenance do not fit Kintsugi's job boundaries unchanged.

## Decision

1. Add an opt-in, project-scoped Understand pilot managed by the orchestrator. The generic runtime, JobSpec and pi dependencies remain unchanged. No third-party memory extension or additional datastore is installed.
2. Memory contains disposable source navigation hints with exact source excerpts, never authoritative business rules, security findings, gaps, instructions or decisions. Formal knowledge remains Markdown in the project's document repository. Hints are derived operational data in the `knowledge` Postgres schema.
3. Require the worker to verify each proposed excerpt against a bounded regular file inside a pinned legacy checkout, reject paths outside it and credential-shaped content, and derive project/application/revision/run/step/agent provenance itself. Credential pattern checks are not a comprehensive secret or personal-data detector; human review remains required. Only the Understand legacy analyst participates in the pilot.
4. Every proposal starts pending. `project.memory.manage` permits inspection, approval/rejection, enable/disable and reset. A reviewed hint is eligible only after its source step and top-level run succeed, the run is not abandoned, and its document write is accepted (`merged`, `unchanged`, or a commit without a review branch). There is no automatic promotion of model conclusions.
5. Select a bounded snapshot from approved hints for the same project, application and exact source revisions. Rank by scope keywords, then select per-agent hints by keyword overlap. Supply selected hints as bounded, explicitly untrusted reference data in the task, leaving the shared system prefix unchanged. No embedding service or extra LLM call is used.
6. Persist each run's initial snapshot in Postgres. Its content hash and epoch participate in step fingerprints. Ordinary retries retain the snapshot; changing hints affects new runs. A changed source pin or explicit project epoch change replaces it and invalidates affected step reuse. Concurrent siblings never consume each other's proposals.
7. An explicit reset deletes hints and snapshots and advances the project epoch. In-flight proposals with an older epoch cannot be collected. Disabling revokes retained snapshots for future attempts and stops new collection, retaining existing hints for re-enabling. Project repository changes invalidate memory automatically; project/application/run deletion cascades corresponding records. Already-running agents keep the context they were given until completion.
8. The worker consumes the reserved scratch file before document checks, artifact indexing and publication. It is never committed to Git. Malformed optional proposals are discarded. Exact contracts and bounds are in the [project memory reference](../reference/project-memory.md).
9. Record snapshot provenance, selected/context counts and candidate counts in existing run summaries/events. Existing usage and spans include task-context tokens. Determine net savings through controlled comparisons, not token-count claims inferred from memory hits.

## Consequences

- Related units can reuse source navigation after human review without relaxing write isolation or sharing conversations.
- Cold starts have no reusable hints. Source changes conservatively require new hints. Stable rules or decisions are not duplicated into memory.
- Project memory is disabled by default. It must be enabled and hints reviewed before reuse occurs. The pilot applies only to Understand; Design and independent review do not consume it.
- Snapshots contain at most 64 entries, each step selects at most six within a 4,000-character entry budget, and proposals have a small fixed size/count. Project collection stops at an approximate 2,000-entry quota. Snapshots live with their run records; reset deletes them. Pending entries from unsuccessful or unaccepted runs remain inspectable but ineligible.
- Revoking a hint affects new snapshots; existing running/retry snapshots remain stable until a reset or disable. Use reset when immediate revocation for future attempts is required.
- No savings percentage has been established. A controlled comparison of billed cost, duration, repeated reads/searches, compactions and output quality is required before broader rollout.

## Alternatives considered

- **Share one writable pi-memory directory.** Rejected: concurrent rewrites can lose updates, and project provenance, publication validation and retry invalidation are absent.
- **Add QMD now.** Deferred: it adds SQLite and native/local-model operations before keyword retrieval is measured.
- **Automatically summarize every job.** Rejected for the pilot: adds LLM cost and risks persisting unsupported conclusions or restricted material.
- **Enable for all agents immediately.** Deferred: independent review and other stages need purpose-specific retrieval rules and evidence from the pilot.
