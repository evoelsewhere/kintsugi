# Data model

The core entities, abridged. Postgres holds operational state and rebuildable indexes. Documents, standards and **unit state** live in Git ([Git as the source of truth](../architecture/concepts/git-as-source-of-truth.md), [ADR-0012](../decisions/0012-work-items-as-files-in-git.md)).

Entities marked *(index)* are derived from files in the document repo and can be rebuilt from Git.

```
GitServer(kind, baseUrl, credential) 1─* GitRepository(url, defaultBranch, syncStatus)          (admin.git_server, admin.git_repository)
Project 1─* Application 1─* WorkItem (index of the unit cards 10-applications/*/02-modern/*/*/README.md) 1─* StageRun ─0..1 RuntimeJob 1─* JobEvent
   │             │              │
   │             │              └─ TaskPack(repo@commit:path) ─ PullRequest ─ GateReview
   │             ├─ AS-IS: ProjectRepository(role legacy | legacy-data) → GitRepository  [many]
   │             ├─ TO-BE: ProjectRepository(role target, component) → GitRepository  [many]
   │             └─ Scorecard, Wave       (primary copy: files in the document repo)
   ├─ ProjectRepository(role document, no application) → GitRepository  [exactly one] ─ GitSyncState(last seen commit per repo)
   │     └─ HarnessRendererConfig
   ├─ PipelineTemplate (phase/stage/gate) ─ GateDecision (index of unit frontmatter `gates`)
   ├─ Gate(gateKey G0–G4 | stage:<id>, status, requested/decided by, note)        (governance.gate)
   └─ ProjectMembership(user, projectRole, harnesses[]) — planned with M0 project persistence
User · AccessRole(core.role/core.user_role) · Permission(core.permission) · Session · AccessToken · AuthIdentity(provider: local | entra-id)
LlmProvider(config, secretRef) · LlmModel · AgentModelBinding(agent → provider/model)
Agent(custom; built-ins from the release) 1─* AgentVersion(package files) · SharedSkill(SKILL.md)   (admin.agent, admin.agent_version, admin.agent_skill)
KbDocument(repo@commit:path) ─* KbChunk(text, embedding)          (no code graph, ADR-0014)
Artifact(type, repo@commit:path, provenance) · HarnessActivity · UsageRecord (the spans of monitoring.telemetry_span) · AuditEvent (append-only)
McpServer(url, headers as secretRef, allowedTools)  (admin.mcp_server, admin.mcp_secret)
WorkerHeartbeat(host, pid, version, lastSeenAt, activeJobs, queues)          (workflow.worker_heartbeat)
```

## Shared types

| Package | Main types |
|---|---|
| [`packages/domain`](../../packages/domain/src/index.ts) | `Phase`, `ProjectRole` (open), `Performer`, `MemberHarnessId`, `RuntimeAgentId` (open), `ThinkingLevel`, `WorkItemFile`, `WorkItemStatus`, `WorkItem` (index), `StageRun`, `ArtifactRef`, `GitLocation`, `GitServer`, `Repository`, `Provenance`, `GateId`, `GATE_IDS`, `GateStatus`, `GateDecision`, `GATE_KEY_PATTERN`, `ScorecardCriterion`, `RepositoryRole`, `StagePerformer`, `PipelineDefinition`, `CompareReport`, `Project`, `Application`, `ProjectRepositoryLink`, `projectRepositoryProblems`, `groupRepositories`, `KintsugiManifest`, `validateManifest`, `manifestFromProject`, `repositoryPath`, `DesignSet`, `DesignSection`, `DesignCheck`, `DESIGN_CHECKS`, `DesignProblem`, `DesignState` |
| [`packages/manifest`](../../packages/manifest/src/index.ts) | `parseKintsugiYaml`, `renderKintsugiYaml` |
| [`packages/runtime-sdk`](../../packages/runtime-sdk/src/index.ts) | `JobSpec`, `AgentDefinition`, `AgentSkill`, `JobLimits`, `JobEvent`, `JobFailureReason`, `JobHandle`, `AgentRuntime`, `LlmProviderConfig`, `AgentModelBinding` |

## Projects and their repositories

Persisted by the API in the `admin` schema (migration [`008_projects.sql`](../../apps/api/migrations/008_projects.sql), [ADR-0028](../decisions/0028-remove-rulebook-single-document-repo.md)). Projects reference repositories registered in Settings → Git; URLs and credentials are never copied.

| Table | Key | Content |
|---|---|---|
| `admin.project` | `id` (kebab-case) | `name`, `description` |
| `admin.application` | (`project_id`, `id`) | `name`, `pipeline` (optional id) |
| `admin.project_repository` | (`project_id`, `repository_id`) | `application_id` (null only for the document repo), `role`, `component` (targets only); `repository_id` references `admin.git_repository` (on delete restrict) |

Rules, checked by `projectRepositoryProblems` (400 with every problem) and, where SQL can, by constraints:

| Rule | Where |
|---|---|
| Exactly one `document` repo per project, at project level (no application) | API; SQL: at most one per project, `role = 'document'` ⇔ no application |
| `legacy`, `legacy-data` and `target` repos belong to an application of the same project | API; SQL: composite foreign key |
| `component` is required for `target` and forbidden otherwise; unique among an application's targets | API; SQL: check + partial unique index |
| A repository is linked at most once per project | API; SQL: primary key |
| A document repo belongs to one project only: no other project links it, in any role | API; SQL: a repository is the document repo of at most one project |
| A linked repository cannot be removed from Settings → Git | SQL: foreign key (409 from the API) |

Legacy and target repos may be shared between projects (for example a shared legacy database).

The API returns each application's repositories grouped as the portal shows them: `asIs: {legacy, legacyData}` and `toBe: {document, targets}`.

## Document writes

Writes to a project's document repo ([ADR-0019](../decisions/0019-workspace-repo-write-path.md)), in the `workflow` schema (migration [`009_document_writes.sql`](../../apps/api/migrations/009_document_writes.sql)): records of work the worker performs, not configuration. The API (or a worker-side caller) creates a row as `queued`; the writer records the outcome.

| Table | Key | Content |
|---|---|---|
| `workflow.document_write` | `id` | `project_id` (cascade on project delete), `kind` (`manifest`, `job-output`, `state-change`), `status` (`queued`, `committed`, `pr-opened`, `merged`, `closed`, `unchanged`, `failed`; the worker's review watch moves a write on a review branch to `merged` or `closed`), `message`, `commit_sha` (default-branch commit of auto-commit paths), `branch` + `branch_commit_sha` (the `kintsugi/*` branch of the other paths), `pr_url`, `error` (redacted), provenance `actor`, `job_id`, `agent` |

## Job runs

Runtime job runs ([ADR-0027](../decisions/0027-builtin-modernization-content.md), [ADR-0029](../decisions/0029-job-workspaces-instead-of-os-sandboxes.md)), migration [`010_job_runs.sql`](../../apps/api/migrations/010_job_runs.sql). The API creates a stage run as `queued`; the worker records everything else. A stage's steps are child runs (`parent_id`).

| Table | Key | Content |
|---|---|---|
| `workflow.job_run` | `id` | `project_id`, `application_id`, `parent_id`, `kind` (`stage`, `script`, `agent`, `workflow`), `name` (stage, script file, agent or workflow id), `status` (`queued`, `running`, `succeeded`, `failed`, `cancelled`), `failure_reason` (redacted), `source_repository_id` + `source_commit` (the first legacy repository), `sources` (jsonb: every legacy repository the run reads, each with its commit, ADR-0052), `inputs` and `limits` (jsonb), `script_hash` (sha256 of the script that ran), `agent` (`<agent>@<version>`), `actor`, `output_summary` (counts, sizes, hook summary, usage; never file content), `document_write_id`, `cancel_requested_at` + `cancel_requested_by` (a person asked to cancel the running run; migration 011), `started_at`, `finished_at`, `created_at` |
| `workflow.job_event` | `id` (increasing) | the run's live record (migration 011): `job_run_id` (the top-level run), `step_run_id` (the step it came from), `kind` (`status`, `step.started`, `step.finished`, `tool`, `log`), `message` (one redacted line), `data` (small detail: status, step kind and name, tool and decision), `at`. Agent tool calls carry the tool and the workspace path only, never file content. Streamed to the portal over SSE |
| `workflow.artifact` | (`job_run_id`, `path`) | `sha256`, `size`, `provenance` (jsonb, [Provenance](#provenance)); `path` is relative to the job's output, i.e. the path in the document repo |
| `governance.restricted_record` | (`job_run_id`, `path`) | a file the job wrote under `restricted/`, encrypted with `KINTSUGI_SECRET_KEY` (`ciphertext`, `iv`, `auth_tag`), `size`; never committed, logged or summarized; readable through the API with `restricted.read` |

Permissions added by the migration: `jobs.run` (start and cancel stages and jobs) and `restricted.read`, both granted to `admin`.

## Audit log

`governance.audit_event` (migration [`011_job_events_audit_settings.sql`](../../apps/api/migrations/011_job_events_audit_settings.sql)) is append-only: triggers refuse `update`, `delete` and `truncate`.

| Table | Key | Content |
|---|---|---|
| `governance.audit_event` | `id` (increasing) | `at`, `actor` (user id), `action` (e.g. `restricted.read`), `project_id`, `subject` (e.g. the job run), `detail` (jsonb, e.g. the record's path and the reader's sign-in name); never the content acted on |

Use cases record through one port, `AuditTrail` in the API's shared kernel (`apps/api/src/common/audit/audit-trail.ts`), which also holds the catalog of actions (`AUDIT_ACTIONS`); the worker writes `gate.request` for the gates it opens. There are two ways to record:

- **Fail-closed, before the content**: every read of a restricted record writes one entry before the record is returned; when the entry cannot be written, nothing is returned.
- **After a change**: the entry is appended once the change has succeeded; a failed append is logged as an error and never undoes or fails the change.

Recorded actions (see [security → audit coverage](../architecture/concepts/security.md#audit-coverage)):

| Area | Actions |
|---|---|
| Delivery | `stage.run`, `job-run.cancel`, `manifest.publish` |
| Projects | `project.create`, `project.update`, `project.delete`, `application.create`, `application.update`, `application.delete`, `repository.link`, `repository.unlink` |
| Git | `git-server.create`, `git-server.update`, `git-server.delete`, `git-repository.create`, `git-repository.update`, `git-repository.delete` |
| Sandbox | `sandbox.workspace-remove` |
| LLM providers | `llm-provider.create`, `llm-provider.update`, `llm-provider.delete`, `model-bindings.save` |
| Agents | `agent.create`, `agent.update`, `agent.delete`, `agent.enable`, `agent.disable`, `agent.import`, `agent.copy`, `agent.restore`, `skill.create`, `skill.update`, `skill.delete` |
| Settings | `commit-identity.update` |
| Access | `role.create`, `role.permissions`, `role.delete`, `user.create`, `user.update`, `user.password`, `user.delete` |
| Governance | `gate.request`, `gate.decide`, `restricted.read` |

`detail` names what changed (field names, ids, a gate's decision and note, roles or permissions added and removed), never credential, key or password values. The log is listed with `GET /api/governance/audit` (`?action=a,b&actor&subject&projectId`) and its actions with `GET /api/governance/audit/actions`; both need `audit.read` (added by migration 011, granted to `admin`).

## Telemetry

Spans of runtime agent jobs ([ADR-0048](../decisions/0048-runtime-telemetry-compaction-and-prompt-cache.md)), migration [`020_telemetry.sql`](../../apps/api/migrations/020_telemetry.sql). Counts, sizes and names only; no prompt, tool argument or output.

| Table | Key | Content |
|---|---|---|
| `monitoring.telemetry_span` | `id` (increasing) | `job_run_id` (the top-level run, cascade), `step_run_id` (the agent step), `project_id` (cascade), `application_id`, `agent` (`<agent>@<version>`), `provider`, `model`, `attempt` (a retry or repair run of the step is another attempt), `span_id` and `parent_span_id` (a tree within one attempt), `name` (`kintsugi.job`, `.turn`, `.tool`, `.codemode`, `.mcp`, `.compaction`, `.retry`), `started_at`, `duration_ms`, `status` (`ok`, `error`), `error`, `attributes` (jsonb of scalars: tokens, cost, tool, reason, …) |

Rows are pruned after `KINTSUGI_TELEMETRY_RETENTION_DAYS` (30). Reading needs `telemetry.view` (seeded in migration 002): `GET /api/monitoring/telemetry/summary`, `…/runs` and `…/runs/:runId/trace`.

## MCP servers

The HTTP MCP servers the runtime may give to agents ([ADR-0047](../decisions/0047-kernel-extensions-codemode-and-http-mcp.md)), migration [`021_mcp_servers.sql`](../../apps/api/migrations/021_mcp_servers.sql).

| Table | Key | Content |
|---|---|---|
| `admin.mcp_server` | `id` (the server's name in an agent's tools: `mcp__<id>__*`) | `url` (http or https), `description`, `enabled`, `timeout_sec`, `allowed_tools` (name patterns allowed besides the tools the server marks read-only), `headers` (header name → `{ secretId }`), `created_by`, `updated_by`, timestamps |
| `admin.mcp_secret` | `secret_id` | `server_id` (cascade), `ciphertext`, `iv`, `auth_tag`: a header value encrypted with `KINTSUGI_SECRET_KEY`; never returned |

Permission added by the migration: `mcp.manage` (every route of `/api/admin/mcp-servers`; the `choices` list also for `agents.manage`), granted to `admin`. Audit actions: `mcp-server.create`, `mcp-server.update`, `mcp-server.delete` (host and field names only).

## Gates

Quality gates G0–G4 ([delivery pipeline](../methodology/delivery-pipeline.md)) and stage gates (`stage:<id>`), migration [`013_gates.sql`](../../apps/api/migrations/013_gates.sql). A gate is requested by a person (`gates.request`) or by the worker when a stage plan reaches it (`services/orchestrator/src/gates.ts`). It stays `pending` until a holder of `gates.decide` approves, rejects or waives it. A decision is final; asking again creates a new row, so the rows of one key are its history.

| Table | Key | Content |
|---|---|---|
| `governance.gate` | `id` | `project_id` (cascade on project delete), `application_id` (optional), `gate_key` (`G0`–`G4` or a lowercase stage gate key), `title`, `status` (`pending`, `approved`, `rejected`, `waived`), `subject` (what it is about, e.g. a job run id), `detail` (jsonb, small context), `requested_by` + `requested_at`, `decided_by` + `decided_at`, `note` (required to reject or waive) |

At most one gate is pending per project, application, key and subject (partial unique index), which makes the worker's request idempotent. Endpoints: `GET /api/governance/gates` (`?projectId&applicationId&gateKey&status=pending,approved`), `GET …/:id` and `GET …/:id/history` need a session; `POST /api/governance/gates` needs `gates.request` or `gates.decide`; `POST …/:id/decision` needs `gates.decide`. Both permissions are added by the migration and granted to `admin`. The monitoring overview counts and lists pending gates. Gate decisions in unit frontmatter (`GateDecision`, [ADR-0012](../decisions/0012-work-items-as-files-in-git.md)) remain the per-work-item record in Git.

## Worker heartbeats

`workflow.worker_heartbeat` (migration [`014_worker_heartbeat.sql`](../../apps/api/migrations/014_worker_heartbeat.sql), [ADR-0030](../decisions/0030-worker-heartbeat-in-postgres.md)): one row per worker process, upserted every 15 seconds.

| Table | Key | Content |
|---|---|---|
| `workflow.worker_heartbeat` | `worker_id` (random per process) | `host`, `pid`, `version` (`KINTSUGI_VERSION`, else the package version), `started_at`, `last_seen_at`, `stopped_at` (clean shutdown), `active_jobs` (job runs, writes and syncs in progress), `queues` (text[]) |

A worker is **up** when its row was seen less than 45 seconds ago (database clock), **stopped** after a clean shutdown and **stale** otherwise. `GET /api/monitoring/workers` lists the rows; the overview reports `worker.up` and raises a `worker-down` attention item when no worker is up. The next worker that starts removes rows not seen for 7 days.

## Installation settings

`admin.installation_setting` (migration 011): installation-wide settings managed in the portal, `key` → `value` (jsonb) with `updated_by` and `updated_at`. First key: `commit-identity` (`{ name, email }` of kintsugi-bot's commits; Settings → Git, `git.manage`), read by the document repo writer for each write ([commit conventions](document-repo-commit-conventions.md)).

## Agents

Custom agents and shared skills of the Agent Builder ([ADR-0026](../decisions/0026-runtime-agents-and-agent-builder.md#implementation-notes)), migration [`012_agents.sql`](../../apps/api/migrations/012_agents.sql). Built-in agents and skills are read from the release (`packages/agents/builtin`) and never stored; their names are reserved.

| Table | Key | Content |
|---|---|---|
| `admin.agent` | `name` | `audience` (`runtime`, `member`), `version` (current), `package` (jsonb: relative path → file content, the export format), `enabled`, `copied_from` (`<agent>@<version>`), `created_by`, `created_at`, `updated_by`, `updated_at` |
| `admin.agent_version` | (`name`, `version`) | `package`, `created_by`, `created_at`; immutable, deleted with the agent |
| `admin.agent_skill` | `name` | `content` (the `SKILL.md` text), `created_by`, `created_at`, `updated_by`, `updated_at` |

Permission added by the migration: `agents.manage`, granted to `admin`. Model bindings (`admin.agent_model_binding`) name agents by `name`.

## Provenance

Every artifact records how it was produced. This record feeds the [AI metrics](../methodology/ai-metrics.md).

| Field | Values |
|---|---|
| `origin` | `human`, `human-with-ai`, `runtime-agent`, `tool` |
| `harness` | Set for `human-with-ai` |
| `runtimeAgent` | Set for `runtime-agent` |
| `documentRepoCommit` | Document repo commit used |
| `model`, `aiShare` (0–1), `assetVersion`, `author`, `reviewedBy` | Optional details |
