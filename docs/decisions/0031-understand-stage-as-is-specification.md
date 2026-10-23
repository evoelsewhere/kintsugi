# ADR-0031: understand stage: per-unit AS-IS specification closes the Understand phase

- Status: Accepted (document formats and paths amended by [ADR-0042](0042-markdown-only-document-repo-by-bounded-context.md)) (§1, §3 and §6 superseded by [ADR-0033](0033-assess-catalog-understand-selection.md))
- Date: 2026-10-12
- Decision register: D50

## Context
The runtime stages of the understanding work ([ADR-0027](0027-builtin-modernization-content.md)) each produce one view of the legacy system: `assess` the inventory, domains, debt and risks; `map` the topology (modules, data stores, edges, entry points, flows); `extract-rules` the business-rule catalog; `harden` the security findings. Together they are evidence, not a reverse-engineered system. Nobody yet gets, per piece of the system, one document that says what it does, how it is started, what it depends on, which rules it applies and which risks it carries, and the later phases have no work items to plan, assign and migrate. Today unit files are declared by people ([ADR-0014](0014-no-code-graph-no-agent-config.md), D42).

Goal: the runtime stages perform a **full reverse engineering of the AS-IS system**: assess plus the Understand phase, ending in a per-unit AS-IS specification and the work items that carry it into migration.

Constraints:
- No code graph or parsers in the engine, no unit-discovery configuration (ADR-0014). Units cannot come from a Kintsugi parser.
- Runtime jobs are read-only on the legacy repository and write only to their output ([ADR-0029](0029-job-workspaces-instead-of-os-sandboxes.md)); the runtime knows no use case, stages are data in the orchestrator ([ADR-0023](0023-runtime-as-generic-agent-kernel.md), [ADR-0026](0026-runtime-agents-and-agent-builder.md)).
- One document repo per project holds everything except code ([ADR-0028](0028-remove-rulebook-single-document-repo.md)); work items are files under `units/**` whose frontmatter is state ([ADR-0012](0012-work-items-as-files-in-git.md)); `units/**` is an auto-commit path by default ([ADR-0019](0019-workspace-repo-write-path.md)).
- Units proposed by an agent arrive as a pull request; `dependsOn` is written or proposed, not computed by the engine (ADR-0014).

Options considered for the units:
1. An agent reads the repository and lists units: not reproducible, and expensive on large estates.
2. A Kintsugi parser per language: forbidden by ADR-0014.
3. **Units derived from the map**: `topology.json` already lists the modules and data stores (written by the `map` stage's model-written extraction script, checked and merged by `merge_topology.py`), so a deterministic built-in script can group its leaves into units without reading code.

## Decision

### 1. Phase structure
The understanding work is `assess` followed by the **Understand phase**: `map` → `extract-rules` ∥ `harden` → **`understand`**. `understand` is the last stage; `extract-rules` and `harden` are independent and may run in either order. The built-in command is `commands/modernize-understand.md` (audience `runtime`, a Kintsugi command without an upstream counterpart); its stage plan is `services/orchestrator/src/jobs/plans/understand.ts`. In the command order it follows `harden`.

### 2. Prerequisites
- **Required** on the document repo's default branch: `assessment/<app>/ASSESSMENT.md` (`assess`) and `assessment/<app>/topology.json` (`map`). The API refuses to start the stage (409) until both stages have succeeded for the application; the worker fails it before any step while either file is not merged.
- **Used when present**: `BUSINESS_RULES.md`, `DATA_OBJECTS.md`, `rules_result.json` (`extract-rules`), `SECURITY_FINDINGS.md` (`harden`) and `inventory.json` (`assess`). A stage plan gains `optional` inputs for this: they are loaded like documents, and the stage summary lists the missing ones (`missingInputs`) and logs each. Documents say "not available" instead of inventing ids.

### 3. Units from the topology, deterministically
Built-in script `units_from_topology.py` (standard library, run in the standard script environment) proposes the units from `topology.json`: module = the map's domain; unit = a map leaf; data stores are never units; small leaves (under 150 lines) of one domain directory are grouped; above 240 units every leaf of a domain directory is grouped and, beyond that, the largest are kept and the rest reported. Size comes from the map or `inventory.json`; the unit kind maps the leaf kind onto `unitKinds` of `kintsugi.yaml`. Dependencies between units come from the map's edges; rules and findings are attached to the unit owning their cited file. It reads no code. What a person should check (leaves without a file, files claimed by several leaves, units over 5,000 lines, units left out) is listed as `ambiguities`. An agent pass that regroups ambiguous units is left for later; the script's grouping is the proposal a reviewer corrects in the pull request.

A gate, **"which units get a specification"** (all, entry points only, cancel), defaults to all units within the stage's agent budget (`KINTSUGI_STAGE_MAX_AGENTS`, one job kept for the synthesis), entry-point units first, then the largest.

### 4. Steps and outputs
| Step | Performer | Output (document-repo paths) |
|---|---|---|
| units | `units_from_topology.py` | `knowledge/as-is/<app>/units.json`, `briefs/<module>/<unit>.json` (intermediate) |
| specify (gate) | person, defaulted | — |
| one job per unit, at most 6 at a time, failures tolerated | `legacy-analyst` | `knowledge/as-is/<app>/<module>/<unit>.md`; traceability fragment `trace/<module>/<unit>.json` (structured result, intermediate) |
| traceability | `merge_traceability.py` | `knowledge/as-is/<app>/traceability.json`, `traceability.md` |
| synthesis | `legacy-analyst` | `knowledge/as-is/<app>/README.md`, `architecture.md`, `data-model.md`, `integrations.md` |
| work items | `write_work_items.py` | `units/<app>/<module>/<unit>.md` |

A unit specification has fixed sections (a kind profile adds sections for the kinds that have one, [ADR-0060](0060-item-kinds-and-kind-aware-understanding.md)): purpose; entry points; main flows (Mermaid when useful); inbound and outbound dependencies (units, data stores, external systems); data objects; business rules applied (RULE ids of `BUSINESS_RULES.md`); security findings and risks (SEC ids); configuration; error handling; source references (`file:line`); open questions. The existing runtime agent `legacy-analyst` writes the specifications and the synthesis: it is the understanding agent; rule and security content is already catalogued by `business-rules-extractor` and `security-auditor` in their stages and is referenced by id. No new agent and no new skill.

The **traceability matrix** is merged by a script, not written by a model, so it is deterministic: the map's facts are the base, the fragments add what each job confirmed, every value is checked (unit references, RULE-NNN / SEC-NNN ids against their catalogs, cited files against the source) and whatever fails is left out and counted. It has per-unit rows and reverse indexes (rule → units, finding → units, file → units), unmapped rules and findings, and dependency cycles.

**Work items** follow the unit-file format: `id`, `application`, `module`, `kind`, `title`, `phase: discover-assess`, `stage: understand`, `status: pending`, `complexity` from size, `dependsOn` from the matrix, legacy `source` paths, `links.asIs` and `links.businessRules`. A unit that already has a file on the default branch is skipped, so a rerun never overwrites a person's progress.

### 5. One pull request, work items included
The writer normally commits `units/**` straight to the default branch. For this stage it does not: the plan sets `reviewAll`, the write request carries it, and the writer puts every file, `units/**` included, on the `kintsugi/<agent>/<job-id>` branch. Reasons: the work items link to specifications that exist only in the pull request; they are proposals (ADR-0014: proposed by agents as a PR, `dependsOn` proposed, not computed) and become state only when a person accepts the unit boundaries; and an unreviewed grouping would otherwise land on the board at once. Merging the pull request is the human review of the whole reverse engineering. Later state changes of the work items go through Kintsugi as before.

### 6. Budgets
At most `KINTSUGI_STAGE_MAX_AGENTS` agent jobs per stage (one per specified unit plus the synthesis), six specification jobs at a time within `KINTSUGI_STAGE_CONCURRENCY`. Above the budget the remaining units still get a work item and are "not written" in the index and the matrix; a second run specifies them (existing work items are kept). The writer's limit of 500 files per write bounds the stage: 240 units at most, each with a specification and a work item, plus six documents.

### 7. How humans review
The pull request is the review: a reviewer checks the gate's ambiguities and the "left out" counts of `traceability.md`, reads a sample of specifications against the code, corrects module and unit boundaries by renaming, merging or deleting unit files in the pull request, and merges. Credential values never appear (agent rules plus the JobOutput hook, unchanged); restricted handling is unchanged.

## Consequences
- The understanding work ends in a reviewable AS-IS knowledge base under `knowledge/as-is/<app>/` and a work-item backlog, ready for planning and migration; the portal's stage results views can show the index, the specifications and the matrix.
- Unit boundaries follow the map. A poor map gives poor units: the reviewer corrects them in the pull request, and the map can be rerun first.
- Stage plans gain two generic fields: `optional` (inputs used when present, missing ones in the summary) and `reviewAll` (everything through the pull request). Document writes gain `reviewAll`.
- Model bindings: `understand` starts only `legacy-analyst`, so a project that can run `map` can run `understand`.
- Follow-up: an agent regrouping step for ambiguous units, a re-run of only the failed or unspecified units, persisted gates, and the portal's understand results view.

## Alternatives considered
- **Auto-commit the work items, specifications through the pull request.** Rejected: dangling links until the merge, unreviewed boundaries on the board, and a rerun would reset state.
- **One agent job writes all specifications.** Rejected: does not fit a context window on real estates, and one failure loses everything.
- **A model writes the traceability matrix.** Rejected: not reproducible; ids and paths need checking anyway, which is what the script does.
- **A new dedicated agent or skill for AS-IS specifications.** Rejected for now: `legacy-analyst` already has the method; the section template lives in the stage plan's task and the command.
