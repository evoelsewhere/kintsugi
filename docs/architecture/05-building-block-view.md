# 5. Building block view

## 5.1 Level 1 — pillars and core platform

Kintsugi has **four pillars** (Admin, Delivery, Monitoring, Governance) on top of a shared **core platform**. Modules communicate through APIs and events, so any of them can later be split into its own service.

```
┌──────────────────────────── Experience ─────────────────────────────────────────────┐
│  Portal (web)   ·   Member harnesses: Claude Code / Copilot / ChatGPT-Codex (MCP + CLI) │
└──────────────────────────────────────────────────────────────────────────────────────┘
┌──────────┬──────────────────────────────────────┬────────────┬────────────┐
│ ADMIN    │ DELIVERY                             │ MONITORING │ GOVERNANCE │
│          │ Assess · Design · Factory · Migrate  │            │            │
│          │ · Verify · Cutover · Operate         │            │            │
└──────────┴──────────────────────────────────────┴────────────┴────────────┘
┌──────────────────────────── Core platform ────────────────────────────────────────┐
│ Workflow Orchestrator │ Knowledge Hub     │ Standards & Assets│ Kintsugi Runtime (pi) │
│ Harness Hub (MCP/CLI) │ Git Sync & Writer │ Postgres (state, KB index, queue, events) │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### A. Admin

| Sub-module | Function | Notes |
|---|---|---|
| A1 Projects & Applications | Projects, applications, their AS-IS and TO-BE repos, document repo, rendered `kintsugi.yaml` | One installation = one organization |
| A2 Identity & Access | Username/password sign-in; PATs for CLI/MCP (Entra ID later); installation access roles and permission bundles; project-role assignment with M0 project membership persistence | [Identity and access](concepts/identity-and-access.md) |
| A3 Connectors | Git servers (any number and kind), Jira / Confluence / SharePoint, source databases (read-only), observability tools | Credentials encrypted in Postgres |
| A4 LLM Providers & Harness Registry | Runtime LLM providers (every pi provider + custom), credentials, test connection, model binding per runtime agent id, allowlist, budget; Agent Builder: built-in and custom agents, shared skills, versions, import and export ([ADR-0026](../decisions/0026-runtime-agents-and-agent-builder.md)); member harness registry (plugin support per harness, built-in + installation fallback renderers, transformer plugins) | [LLM configuration](concepts/llm-configuration.md) |
| A7 Extension Allowlists | Runner image allowlist; harness transformer plugins | [Security](concepts/security.md) |
| A5 Templates | SDLC / pipeline templates per 7R, deliverable templates, RACI templates, the document repo starter template | Shipped stack-agnostic; project specifics go into the project's document repo (`standards/`, `plugins/`) |
| A6 Project Build | Create / join a document repo; register per application the AS-IS repos (`legacy`, `legacy-data`) and TO-BE repos (`target` per architecture component); choose or declare pipelines | [Build a project](../guides/build-project.md) |

### B. Delivery
Maps one-to-one onto pipeline phases ([delivery pipeline](../methodology/delivery-pipeline.md)). The runtime agents named here (`assessment`, `task-planner`, `gate-reviewer`, …) are planned, not shipped; each will be an agent definition supplied per job ([ADR-0023](../decisions/0023-runtime-as-generic-agent-kernel.md)).

| Sub-module | Phase | Main functions |
|---|---|---|
| B1 Portfolio & Assessment | P1 | Inventory and unit files (proposed by `assessment`, confirmed by people), unit dependencies (`dependsOn`), weighted scorecard, 7R recommendation, wave planning. `assessment` and `wave-planner` draft; the architect approves |
| B2 Architecture Studio | P2 | AS-IS vs TO-BE architecture, ADRs, gap list, co-existence strategy, POC plan, cost-benefit, ARB review. Supported by `to-be-analyst` |
| B3 Factory Setup | P3 | Base source, IaC, CI/CD; select or author agent plugins and task-pack templates; configure `gate-reviewer` rules; pilot on 1–2 features |
| B4 Migration Workbench | P4 | Board of work items (index of `units/**`) × stages; `task-planner` produces task packs; assignment / claiming; PR tracking; `gate-reviewer` review; design ↔ code sync |
| B5 Verification | P5 | Test generation, compare tests, coverage, non-functional tests, rehearsal, UAT tracking |
| B6 Cutover | P6 | Readiness checklist, runbook, go / no-go, decommissioning |
| B7 Hypercare & Operate | P7 | Incidents, user manual / training generation, end-user chatbot, KB handover |

### C. Monitoring

| Sub-module | Function |
|---|---|
| C1 Agent Observability | Runtime job traces (tool calls, tokens, cost, outputs), session replay; normalized member-harness activity |
| C2 Delivery Dashboard | Progress by phase / wave / work item, burn-down, gate status |
| C3 AI Metrics | [AI metrics](../methodology/ai-metrics.md) computed from harness activity, artifact provenance and the tracker |
| C4 Cost & FinOps | Runtime LLM cost by project / agent / model; harness usage and licenses; to-be cloud cost |
| C5 Target System Health | Health and incidents of the migrated system (P6–P7) |

### D. Governance

| Sub-module | Function |
|---|---|
| D1 Policy Engine | Runtime: model allowlist, tool permissions, network, budget. Harnesses: `HarnessPolicy` distribution. Shared: data residency, PII / secret redaction |
| D2 Quality Gates | G0–G6 plus per-work-item gates, defined in `kintsugi.yaml` (Git) |
| D3 Review & Approval | ARB, design review, PR approval, go / no-go, with SLAs |
| D4 Audit & Traceability | Append-only audit (hash chain); requirement → design → code → test → defect via `repo@commit:path`; AI provenance |
| D5 Risk & Change | Risk register, change requests, decision log |

### E. Core platform

| Component | Responsibility |
|---|---|
| E1 Workflow Orchestrator | pg-boss job queue + phase / stage / gate state machine driven by the application's **pipeline definition** (built-in, or declared in `kintsugi.yaml`). Transitions are validated by the API, persisted as unit-file commits and indexed in Postgres (ADR-0012); retries; fan-out per wave |
| E2 Knowledge Hub | AS-IS / TO-BE KB: sources in Git, text chunks + embeddings (pgvector) in Postgres, no code graph; ingestion; search API |
| E3 Standards & Assets | Reads `kintsugi.yaml`, `standards/` and `plugins/` from the document repo at a fixed commit, and combines them with built-in assets for runtime jobs and harness rendering ([document repository](../reference/document-repo.md)) |
| E4 Kintsugi Runtime (pi) | Generic agent kernel ([ADR-0023](../decisions/0023-runtime-as-generic-agent-kernel.md)): runs one agent job whose [agent definition](../reference/runtime-agents.md) is supplied with the job, in the job's workspace ([ADR-0029](../decisions/0029-job-workspaces-instead-of-os-sandboxes.md)); knows no agent. Built-in and custom agents are installation data managed in the Agent Builder ([ADR-0026](../decisions/0026-runtime-agents-and-agent-builder.md)) |
| E5 Harness Hub | MCP server, CLI backend, plugin validation and **marketplace generation** (generated built-in plugin + project plugins, all under the document repo's `plugins/`), fallback rendering, policy distribution, telemetry ingest ([harness integration](../reference/harness-integration.md)) |
| E6 Git Sync & Writer | Sync many repos across many Git servers; the writer, the only component that commits to project repos: commits / PRs runtime results, unit state changes and portal-published files (e.g. `kintsugi.yaml`) to the document repo through the `document-write` queue, one write per repository at a time (fetch → rebase → retry, [ADR-0019](../decisions/0019-workspace-repo-write-path.md)) |
| E7 Events | Domain events (job.started, pr.opened, gate.passed, artifact.registered…) via outbox + `LISTEN/NOTIFY` |
| E8 Connectors | Git provider APIs (PRs, comments, webhooks), trackers, wikis, observability |

### Who uses what

| Project role / persona | Main modules |
|---|---|
| PM / program manager | B (all), C2, C3, D3, D5 |
| BA | B1, B2, E2 (AS-IS chatbot) |
| Architect / ARB | A6, B2, D2, D3 |
| Dev / QC | B4, B5, mostly from their own harness via MCP + CLI |
| AI champion / AI engineer / prompt engineer | A6, B3, E3, E4, D6, C1 |
| KM lead / KM engineer | E2 |
| AI practice owner | C3, A5 |
| Installation admin | A |

## 5.2 Level 2 — containers and code

| Container | Modules | Code |
|---|---|---|
| `kintsugi-app` | API, portal, Harness Hub (MCP, CLI API), job gateway | `apps/api`, `apps/portal`, `services/harness-hub` |
| `kintsugi-worker` | Orchestrator, Git Sync & Writer, ingestion, job launcher | `services/orchestrator`, `services/knowledge`, `services/runtime` (launcher) |

Shared libraries and assets:

| Path | Content |
|---|---|
| `packages/domain` | Shared vocabulary: phases, 7R, project roles, units, provenance, Git servers / repositories, scorecard; projects, applications and repository links with their rules; the `kintsugi.yaml` model/validator (dependency-free) |
| `packages/manifest` | `kintsugi.yaml` as text: parse + validate, render ([manifest schema](../reference/document-repo-manifest.md)) |
| `packages/agents` | Agent packages (Claude Code agent files + Agent Skills): parsing, validation, resolution by name across built-in and custom agents, conversion of runtime agents to `AgentDefinition`, ZIP import/export; `builtin/` holds the modernization content (agents, commands, workflows, scripts, hooks, tests) adapted from upstream ([ADR-0026](../decisions/0026-runtime-agents-and-agent-builder.md), [ADR-0027](../decisions/0027-builtin-modernization-content.md)) |
| `packages/git` | Git core: system `git` CLI wrapper with per-call credentials, checkout storage layout, provider REST adapters ([ADR-0025](../decisions/0025-git-core-and-checkout-storage.md)) |
| `packages/runtime-sdk` | `AgentRuntime`, `JobSpec`, `AgentDefinition`, `JobEvent`, LLM provider configuration types |
| `packages/harness-sdk` | `TaskPack`, `AssetRenderer`, `HarnessActivity`, `HarnessPolicy` |
| `templates/document-repo` | Document repo starter template: `kintsugi.yaml`, neutral `standards/` and `plugins/` samples |
| `deploy/compose` | The Docker Compose package |
