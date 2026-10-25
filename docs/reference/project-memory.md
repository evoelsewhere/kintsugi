# Project memory

Project memory is persistent operational knowledge for runtime agents ([ADR-0078](../decisions/0078-agent-memory-learning-lifecycle.md)). Manage it at **Projects → Project memory** with `project.memory.manage`. It is off by default; enable it to make optional tools available to new eligible agent sessions. Existing enabled sessions observe disable, reset and trust changes on subsequent calls.

## Learning and trust

Agents can save facts, lessons, decisions and navigation. A write is committed immediately as `learned` and returns an ID that can be passed to `memory_read` in the same job. Other eligible jobs can retrieve it immediately. There is no requirement to finish the run, merge a PR or approve a note before it can be remembered.

Learned notes are unverified. Each read includes trust, creator stage/agent, originating run/step and current producer status (`running`, `failed`, `succeeded`, or `unknown` after cleanup). Inspect these and verify consequential claims. A manager can mark a note reviewed (`approved` in the API) or reject it. This changes trust, not persistence. Formal rules, findings, standards and design decisions remain their existing Markdown documents in Git; memory is never a new source of agent instructions.

Eligible agents include Assess, Understand and Design agents, nested workflows, and standalone runtime agents with a project/application context. Memory read tools require the agent's existing `read` permission; mutation tools additionally require `write`. Independent reviewers (review stage or reviewer-named agent) only receive search/read/status, see reviewed memory only, and cannot consume memory from their current top-level run.

## Scope and validity

A note's scope is either:

- **Project** (default): shared across the project's applications and jobs.
- **Application**: shared only within the caller's application.

The model cannot supply another project/application/run/author or a trust level. The worker binds those values and the source revisions.

Evidence is optional for all four kinds. If supplied, its repository and path must exist as a regular file inside a readable pinned checkout. The worker records the actual commit. An optional quote must match that file exactly (12–400 characters; quoted files are at most 512,000 bytes). Reads of evidence-bound notes require that source revision and a current repository link in the caller's application. General notes do not become invalid simply because a source commit changes.

There is no memory snapshot, preselected memory corpus, read cache, automatic context injection or extra summarization LLM call. Every lookup queries current Postgres state. Content already returned stays in the conversation; reset cannot remove prior model context. Live-memory steps and enclosing workflows run again on retry rather than assuming mutable knowledge stayed unchanged.

## Tools

All tools are optional and model-only. Codemode cannot call them. The runtime invokes a caller-bound host service through private child-process IPC, with no database credentials in the child.

| Tool | Contract |
| --- | --- |
| `memory_write` | Save Markdown `content` with `kind`; optional `summary`, `tags`, `target`, `scope`, `evidence`. Returns an immediately readable ID and trust state |
| `memory_read` | Read an `id`, or `target: long_term`, `daily`, `list` (daily dates), or `recoveries` (recoverable learned notes) |
| `memory_search` | Full-text `query`; optional `kind`, `target`, `date`, `offset`, `limit` |
| `memory_status` | Enabled state, available note count and learned/reviewed access mode; no note content |
| `memory_forget` | Forget a learned note by `id`; returns `recoveryId`. Reviewed/rejected knowledge cannot be changed by an agent |
| `memory_restore` | Restore a forgotten learned note using `recoveryId` |
| `scratchpad` | `action: list/add/done/undo/clear`; add takes text and returns itemId, done/undo take an ID, clear removes completed items |

Write a lesson without a source citation:

```json
{"kind":"lesson","target":"long_term","content":"The legacy export has duplicate headings; compare column positions before interpreting the second table.","tags":["exports","data-quality"]}
```

Record daily progress:

```json
{"kind":"fact","target":"daily","scope":"application","content":"Reviewed the account mapping; the external interface naming still needs confirmation."}
```

Attach optional verified evidence:

```json
{"kind":"navigation","content":"Shared record layouts are defined in this file.","evidence":{"repositoryId":"legacy-main","path":"src/shared/records.txt"}}
```

Read the saved ID, or inspect a daily log:

```json
{"target":"daily","date":"2026-10-25","limit":3}
```

Long-term and daily notes share the same trust/provenance fields. Daily dates default to today in **UTC**, not the agent's local timezone. Repeating an identical write on the same target/day/scope returns the existing ID without overriding its content or review. To correct a learned note, forget it and write its replacement. Restoring a note is explicit; another write never silently resurrects forgotten/rejected content.

## Scratchpad and deletion

The scratchpad belongs to one top-level run. Parallel steps can coordinate through item IDs; updates are transactional. It survives retries but is not shared as project knowledge with later independent runs. Use memory_write for knowledge that should outlive the task.

Forget hides a note from reads/search immediately and stores a recovery record while retaining its immutable content in the original row. Recovery records are not memory-corpus snapshots. Agents can list recoverable learned notes using memory_read target recoveries, including in later jobs within the same scope. Managers can forget or restore reviewed/rejected notes through the portal; restoring preserves the previous trust state. Reset deletes recovery records permanently.

## Management and lifecycle

| Action | Effect |
| --- | --- |
| Enable | Eligible new agent sessions receive memory tools |
| Mark reviewed / reject | Changes trust and retrieval on the next lookup; reviewers only see reviewed notes |
| Forget / restore | Hide or reactivate a note with explicit recovery; management actions are audited |
| Disable | Stop subsequent access and revoke old in-flight writes; retain notes/recoveries/scratchpads for re-enable |
| Reset | Delete all notes, recoveries and scratchpads; advance the write-revocation epoch |
| Change repository links/revisions | General notes remain; source-linked evidence must still match current scope and revision |
| Delete a run | Remove its scratchpad and clear live run references; long-term notes retain stage/agent provenance |
| Delete project/application | Cascade project notes, or notes explicitly scoped to that application |

Transactions lock the project's setting row on a dedicated connection. Write validation remembers only a revocation epoch, not memory contents; a reset/disable during validation makes that write fail and requires a new call. General notes written after reset are new writes and may be saved normally. Credential-shaped assignments, authenticated URLs and private keys are rejected using the shared redaction helper. Arbitrary long tokens/hashes are not rejected solely for their length. These checks are not comprehensive sensitive-data detection.

## Bounds

- At most 2,000 stored notes per project, including forgotten notes retained for recovery; reset reclaims storage.
- At most 128 new notes per originating top-level run; identical writes are idempotent.
- Note content: 1–2,000 characters; summary: 1–240; up to eight tags of 32 characters; total normalized write payload: 8,000 bytes.
- A run scratchpad has at most 100 items of 1,000 characters each.
- Read/search/list pages request 1–5 entries; responses may contain fewer to stay within the byte budget. Continue at nextOffset.
- IPC: eight concurrent requests, 512 requests per child, ten-second response timeout, 12,000-byte reply ceiling. Transaction lock and statement waits are bounded.

## Management API

Routes require a session and `project.memory.manage` and use the normal response envelope. Management audits contain identifiers/actions, never note content.

| Method | Route | Contract |
| --- | --- | --- |
| GET | `/api/admin/projects/:projectId/memory?limit=20&offset=0` | Settings and a page of all notes, including trust/deletion/provenance |
| PUT | `/api/admin/projects/:projectId/memory` | `{ "enabled": true }`, 204 |
| DELETE | `/api/admin/projects/:projectId/memory` | Irreversible reset, 204 |
| PATCH | `/api/admin/projects/:projectId/memory/:id` | `{ "state": "approved" }` or `rejected`, 204 |
| POST | `/api/admin/projects/:projectId/memory/:id/forget` | `{ recoveryId }` |
| POST | `/api/admin/projects/:projectId/memory/recoveries/:recoveryId/restore` | `{ id }` |

Storage: `knowledge.project_memory_setting`, `project_memory_entry`, `project_memory_recovery`, `project_memory_scratchpad`. Migration 038 upgrades the earlier navigation-only schema; migration 037 removes the former snapshot table if present. No third-party pi-memory extension, QMD or additional datastore is installed.

## Observability

Each explicit tool call appears in the run trace. Agent summaries count search/read/write/status/forget/restore/scratchpad calls. Ordinary memory writes are not document artifacts and are never published by the document writer. The console does not log note bodies or search queries. Tool response tokens are part of the normal model usage. No savings percentage is established; compare actual billed execution cost, latency, recall quality and defects before claiming a benefit.
