# Data model

The core entities, abridged. Postgres holds operational state and rebuildable indexes. Documents, the rulebook and **work item state** live in Git ([Git as the source of truth](../architecture/concepts/git-as-source-of-truth.md), [ADR-0012](../decisions/0012-work-items-as-files-in-git.md)).

Entities marked *(index)* are derived from files in the workspace repo and can be rebuilt from Git.

```
GitServer(kind, baseUrl, credentialRef) 1─* Repository(path, role [repository purpose], defaultBranch, credentialRef?)
Project 1─* Application 1─* WorkItem (index of units/**) 1─* StageRun ─0..1 RuntimeJob 1─* JobEvent
   │             │              │
   │             │              └─ TaskPack(repo@commit:path) ─ PullRequest ─ GateReview
   │             ├─ SourceRepo / TargetRepo → Repository  [many]
   │             └─ Scorecard, Disposition (7R), Wave       (primary copy: files in the workspace repo)
   ├─ WorkspaceRepo → Repository  ─ GitSyncState(last seen commit per repo)
   ├─ Rulebook(id, version, commit) (index of rulebook/; primary copy in the workspace repo)
   │     ├─ Layer(vendor | pack | override) 1─* CapabilityDecl(name, maturity scoped, uses[], evidence[])
   │     ├─ Rule(id, appliesTo, severity, layer) · PipelineDefinition · Waiver(scope, expires)
   │     └─ RunnerSpec(image) · HarnessRendererConfig
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
| [`packages/domain`](../../packages/domain/src/index.ts) | `Phase`, `Disposition`, `ProjectRole` (open), `Performer`, `MemberHarnessId`, `RuntimeAgentId` (open), `ThinkingLevel`, `WorkItemFile`, `WorkItemStatus`, `WorkItem` (index), `StageRun`, `ArtifactRef`, `GitLocation`, `GitServer`, `Repository`, `Provenance`, `GateId`, `ScorecardCriterion`, `RulebookRef`, `RulebookManifest`, `PackManifest`, `PipelineDefinition`, `Waiver`, `RuleFrontmatter`, `RunnerSpec`, `RunnerJobSpec`, `CompareReport`, `CapabilityName` (open), `CapabilityMaturity`, `checkReadiness()` |
| [`packages/runtime-sdk`](../../packages/runtime-sdk/src/index.ts) | `JobSpec`, `AgentDefinition`, `AgentSkill`, `JobLimits`, `JobEvent`, `JobFailureReason`, `JobHandle`, `AgentRuntime`, `LlmProviderConfig`, `AgentModelBinding` |
| [`packages/harness-sdk`](../../packages/harness-sdk/src/index.ts) | `TaskPack`, `PluginManifest`, `PublishedPlugin`, `MarketplaceFile`, `HarnessPluginSupport`, `MarketplaceGenerator`, `HarnessRendererConfig`, `AssetRenderer`, `HarnessActivity`, `TelemetryNormalizer`, `HarnessPolicy` |

## Provenance

Every artifact records how it was produced. This record feeds the [AI metrics](../methodology/ai-metrics.md).

| Field | Values |
|---|---|
| `origin` | `human`, `human-with-ai`, `runtime-agent`, `tool` |
| `harness` | Set for `human-with-ai` |
| `runtimeAgent` | Set for `runtime-agent` |
| `rulebook` | `version` + `commit` used |
| `model`, `aiShare` (0–1), `assetVersion`, `author`, `reviewedBy` | Optional details |
