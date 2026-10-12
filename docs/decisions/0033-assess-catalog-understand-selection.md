# ADR-0033: Two runtime stages: assess builds the item catalog; understand runs on a selection

- Status: Accepted
- Date: 2026-10-12
- Decision register: D52

## Context
[ADR-0031](0031-understand-stage-as-is-specification.md) made the understanding work a chain of whole-application stages: `assess`, then `map` → `extract-rules` ∥ `harden` → `understand`. Every stage reads the whole application and writes one pull request of whole-application files. On real estates this does not work well:

- **Everything or nothing.** A team cannot understand the invoicing module this week and the customer module next week. A stage that fails late is rerun whole; nothing resumes.
- **Ids depend on position.** `render_rules.py` numbers rules `RULE-001`… in output order, and the triage agent numbers findings `SEC-001`…. A rerun renumbers them, and two pull requests of the same stage would collide on the same ids and the same files.
- **Aggregates conflict.** `topology.json`, `rules_result.json`, `BUSINESS_RULES.md`, `SECURITY_FINDINGS.md` and `traceability.json` are single files: two concurrent runs always conflict on them.
- **Units arrive last.** The units of ADR-0031 §3 are derived only inside `understand`, after three whole-application stages, so nobody can choose what to analyse before paying for all of it.

The engine stays small ([ADR-0014](0014-no-code-graph-no-agent-config.md), [ADR-0023](0023-runtime-as-generic-agent-kernel.md)): no parsers, no code graph; stages are data in the orchestrator; runtime jobs never write to project repos ([ADR-0029](0029-job-workspaces-instead-of-os-sandboxes.md)).

## Decision

### 1. Two runtime stages
The runtime has two understanding stages:

- **`assess`** measures the application and **builds its item catalog**: inventory, the analysis group (structure, debt, security), the topology extraction (a `legacy-analyst` job writes `extract_topology.py`, a script step runs it, with the repair loop), the catalog script, an agent curation pass, reconciliation with the previous catalog, and the synthesis (`ASSESSMENT.md`, `ARCHITECTURE.mmd`).
- **`understand`** runs on a **selection of catalog items** chosen by a person. It composes the former `map`, `extract-rules` and `harden` plans as step groups (scoped topology fragment, rules, security review), then one AS-IS specification per selected item and the work items. One run is one pull request.

`map`, `extract-rules` and `harden` are no longer runnable stages; their plans become step factories of `understand` and their commands document those steps. Until that migration lands, the three standalone stages stay runnable beside the new ones.

### 2. The item catalog
`assessment/<app>/catalog.json` is written only by `assess`; concurrent `understand` runs never touch it.

- **Two levels**: module → item. Functions inside an item are `parts`: shown, never selectable.
- **Ids** are `<module>/<item>`, both kebab-case segments (the unit-key regex of ADR-0031). Catalog items are the units: the work item id is `<app>/<module>/<item>`, so one id goes end to end.
- **Kinds** come from `unitKinds` of `kintsugi.yaml`.
- **Full file coverage**: every source file of `inventory.json` belongs to exactly one item or is listed in `unassigned`. A script checks it.
- **`digest`**: a hash over the item's files and their per-file sha256 (measured by the inventory), so a changed item is detectable without reading code.
- **No parsers**: the catalog is derived deterministically from the topology the model-written extraction script produced (`catalog_from_topology.py`), then curated by a `legacy-analyst` job that returns structured edits (rename, kind, merge, split, summaries), which a script validates and applies; an edit that would break file coverage is rejected.
- **Stable across re-assess** (`reconcile_catalog.py`, deterministic): a new item that overlaps an old one by Jaccard ≥ 0.5 on its files keeps the old id (a changed name goes to `aliases`); a split keeps the id on the largest piece; an old item without a match becomes `status: "retired"` and is never deleted, so its specifications and work items still resolve. The first reconcile is seeded from ADR-0031's `units.json` and `units/<app>/**`, so existing unit ids are kept.

### 3. Item status is derived, never stored
Precedence: `running` > `in-pr` > `failed` > `stale` > `understood` > `not-analysed`; `retired` stands beside them.

| Status | Derived from |
|---|---|
| `running` | A queued or running `understand` run whose `inputs.scope.items` holds the item |
| `in-pr` | A run whose document write opened a pull request that is still open, and that nobody abandoned |
| `failed` | The item's latest run failed (or its per-item step did) after the last time it was understood |
| `understood` | `knowledge/as-is/<app>/items/<module>/<item>/meta.json` is on the default branch |
| `stale` | Understood, but the `digest` in `meta.json` differs from the catalog's |

The API serves the catalog with these statuses (`GET /api/projects/:id/applications/:appId/catalog`).

### 4. Per-item layout and generated aggregates
A run writes only the paths of its own items, so concurrent pull requests cannot conflict:
`assessment/<app>/items/<module>/<item>/{topology,rules,findings}.json`, the specification at `knowledge/as-is/<app>/<module>/<item>.md`, `knowledge/as-is/<app>/items/<module>/<item>/{trace,meta}.json`, `assessment/<app>/flows/<run-id>.json` and the work item `units/<app>/<module>/<item>.md`.

Whole-application views (`topology.json`, `rules_result.json`, `BUSINESS_RULES.md`, `DATA_OBJECTS.md`, `SECURITY_FINDINGS.md`, the traceability matrix and the index) are **rebuilt by a deterministic script after a merge** and **auto-committed under `generated/`** on the default branch (`assessment/<app>/generated/`, `knowledge/as-is/<app>/generated/`). They are never carried in a run's pull request.

### 5. Item-namespaced ids
Rule and finding ids are namespaced by item and numbered inside it, for example `RULE-invoicing.invoice-entry-03` and `SEC-invoicing.invoice-entry-01`. They cannot collide across pull requests; a rerun renumbers only inside the pull request that rewrites that item. Old `RULE-NNN` / `SEC-NNN` ids are mapped in `assessment/<app>/id-aliases.json` by the one-time migration.

### 6. Selection, conflicts and retry
- An item that is running or in an open pull request **cannot be selected again** (409 with the conflicts). **Abandon** releases the items of a pull request that was closed without merging.
- Run inputs carry `scope: {items, files}`, resolved by the API from the catalog, and a pinned document-repo commit (`documentsCommit`), so every step reads the same inputs.
- **Resume**: a failed run can be retried. The retry is a new run on the same source commit and pinned documents commit; it starts from the old run's kept outputs (on failure the stage keeps `work/` as well as `out/`, for the same retention), skips the agent and workflow steps and per-item jobs that succeeded, replays the recorded gate choices, and always reruns script steps (cheap and deterministic). A workflow that failed part-way reruns whole. A run that succeeded with some failed items is not resumed: the user starts a new run on those items, which show as `failed`.

### 7. Overview documents on demand
`architecture.md`, `data-model.md` and `integrations.md` of an application are written by an on-demand **Overview** run with no items, serialized per application, not after every merge.

### 8. What this changes in earlier decisions
- **ADR-0031**: §1 (phase structure), §3 (units derived inside `understand`) and §6 (budgets of a whole-application run) are superseded by this ADR. §4 (steps and outputs, specification sections, the script-merged traceability matrix, work items) and §5 (one pull request, work items included, `reviewAll`) stay, applied per item.
- **ADR-0027**: the runtime stage list is `assess` and `understand`.
- **ADR-0019**: the default `autoCommitPaths` gain `assessment/**/generated/**` beside `knowledge/**/generated/**`.

### User decisions recorded
1. Aggregates are rebuilt by a script after a merge and auto-committed under `generated/` on the default branch, never in run pull requests.
2. Rule and finding ids are item-namespaced; `assessment/<app>/id-aliases.json` maps the old ids.
3. Granularity is module → item; functions are non-selectable parts.
4. An item in an open pull request blocks new runs on it; Abandon releases it.
5. The application overview documents are an on-demand Overview run, serialized per application.

## Consequences
- Teams choose what to understand, pay for that, and run several selections in parallel without conflicts.
- `assess` gets heavier: it now carries the topology agent and the curation job.
- The catalog is only as good as the topology; the curation pass and the reviewer of the `assess` pull request correct it.
- A scoped security review can miss cross-cutting flaws (authentication, configuration); configuration and build files stay readable as shared context of every run.
- The id format change touches several parsers (`render_rules.py`, `merge_traceability.py`, the JobOutput hook, the readers, the portal).
- The aggregate rebuild depends on the mirror sync seeing the merge; a manual Rebuild action covers a missed trigger.
- Stage plans gain a `scope` in their context; the runner keeps `work/` on failure and records the steps of a failed run so it can be resumed.
- Rollout is in phases: the catalog and its read-only status API first, then the scoped executor and resume, the scoped step groups and per-item layout, the aggregate rebuild, the selection endpoint, the portal's understand page, and finally the migration of existing outputs and the removal of the standalone stages.

## Alternatives considered
- **Keep five whole-application stages and add a filter.** Rejected: aggregates and position-based ids still conflict between runs, and nothing can be chosen before `map` has run on everything.
- **Carry the aggregates in each run's pull request.** Rejected: every pair of concurrent runs would conflict.
- **A superseding run for an item in an open pull request.** Rejected: two open pull requests for one item leave the reviewer to pick a winner by hand; blocking plus Abandon is simpler.
- **Three levels (module → item → function) with selectable functions.** Rejected: too fine for a specification and a work item; functions stay parts of their item.
- **Regenerate the overview documents after every merge.** Rejected: an agent job per merge is costly and its output churns; on demand is enough.
