# Data model

The core entities, abridged. Postgres holds operational state and rebuildable indexes. Documents, standards and **work item state** live in Git ([Git as the source of truth](../architecture/concepts/git-as-source-of-truth.md), [ADR-0012](../decisions/0012-work-items-as-files-in-git.md)).

Entities marked *(index)* are derived from files in the document repo and can be rebuilt from Git.

```
GitServer(kind, baseUrl, credential) 1─* GitRepository(url, defaultBranch, syncStatus)          (admin.git_server, admin.git_repository)
Project 1─* Application 1─* WorkItem (index of units/**) 1─* StageRun ─0..1 RuntimeJob 1─* JobEvent
   │             │              │
   │             │              └─ TaskPack(repo@commit:path) ─ PullRequest ─ GateReview
   │             ├─ AS-IS: ProjectRepository(role legacy | legacy-data) → GitRepository  [many]
   │             ├─ TO-BE: ProjectRepository(role target, component) → GitRepository  [many]
   │             └─ Scorecard, Disposition (7R), Wave       (primary copy: files in the document repo)
   ├─ ProjectRepository(role document, no application) → GitRepository  [exactly one] ─ GitSyncState(last seen commit per repo)
   │     └─ HarnessRendererConfig
   ├─ PipelineTemplate (phase/stage/gate) ─ GateDecision (index of unit frontmatter `gates`)
   └─ ProjectMembership(user, projectRole, harnesses[]) — planned with M0 project persistence
User · AccessRole(core.role/core.user_role) · Permission(core.permission) · Session · AccessToken · AuthIdentity(provider: local | entra-id)
LlmProvider(config, secretRef) · LlmModel · AgentModelBinding(agent → provider/model)
KbDocument(repo@commit:path) ─* KbChunk(text, embedding)          (no code graph, ADR-0014)
Artifact(type, repo@commit:path, provenance) · HarnessActivity · UsageRecord · AuditEvent (append-only)
```

## Shared types

| Package | Main types |
|---|---|
| [`packages/domain`](../../packages/domain/src/index.ts) | `Phase`, `Disposition`, `ProjectRole` (open), `Performer`, `MemberHarnessId`, `RuntimeAgentId` (open), `ThinkingLevel`, `WorkItemFile`, `WorkItemStatus`, `WorkItem` (index), `StageRun`, `ArtifactRef`, `GitLocation`, `GitServer`, `Repository`, `Provenance`, `GateId`, `ScorecardCriterion`, `RepositoryRole`, `StagePerformer`, `PipelineDefinition`, `CompareReport`, `Project`, `Application`, `ProjectRepositoryLink`, `projectRepositoryProblems`, `groupRepositories`, `KintsugiManifest`, `validateManifest`, `manifestFromProject`, `repositoryPath` |
| [`packages/manifest`](../../packages/manifest/src/index.ts) | `parseKintsugiYaml`, `renderKintsugiYaml` |
| [`packages/runtime-sdk`](../../packages/runtime-sdk/src/index.ts) | `JobSpec`, `AgentDefinition`, `AgentSkill`, `JobLimits`, `JobEvent`, `JobFailureReason`, `JobHandle`, `AgentRuntime`, `LlmProviderConfig`, `AgentModelBinding` |
| [`packages/harness-sdk`](../../packages/harness-sdk/src/index.ts) | `TaskPack`, `PluginManifest`, `PublishedPlugin`, `MarketplaceFile`, `HarnessPluginSupport`, `MarketplaceGenerator`, `HarnessRendererConfig`, `AssetRenderer`, `HarnessActivity`, `TelemetryNormalizer`, `HarnessPolicy` |

## Projects and their repositories

Persisted by the API in the `admin` schema (migration [`008_projects.sql`](../../apps/api/migrations/008_projects.sql), [ADR-0028](../decisions/0028-remove-rulebook-single-document-repo.md)). Projects reference repositories registered in Settings → Git; URLs and credentials are never copied.

| Table | Key | Content |
|---|---|---|
| `admin.project` | `id` (kebab-case) | `name`, `description` |
| `admin.application` | (`project_id`, `id`) | `name`, `disposition` (7R), `pipeline` (optional id) |
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

## Provenance

Every artifact records how it was produced. This record feeds the [AI metrics](../methodology/ai-metrics.md).

| Field | Values |
|---|---|
| `origin` | `human`, `human-with-ai`, `runtime-agent`, `tool` |
| `harness` | Set for `human-with-ai` |
| `runtimeAgent` | Set for `runtime-agent` |
| `documentRepoCommit` | Document repo commit used |
| `model`, `aiShare` (0–1), `assetVersion`, `author`, `reviewedBy` | Optional details |
