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
│ Workflow Orchestrator │ Knowledge Hub     │ Asset Registry │ Kintsugi Runtime (pi) │
│ Harness Hub (MCP/CLI) │ Git Sync & Writer │ Postgres (state, KB index, queue, events) │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### A. Admin

| Sub-module | Function | Notes |
|---|---|---|
| A1 Projects & Applications | Programs, projects, applications, code repos, workspace repo | One installation = one organization |
| A2 Identity & Access | Username/password sign-in; PATs for CLI/MCP (Entra ID later); users; RACI roles; project-scoped RBAC | [Identity and access](concepts/identity-and-access.md) |
| A3 Connectors | Git servers (any number and kind), Jira / Confluence / SharePoint, source databases (read-only), observability tools | Credentials encrypted in Postgres |
| A4 LLM Providers & Harness Registry | Runtime LLM providers (every pi provider + custom), credentials, test connection, model binding per runtime agent, allowlist, budget; allowed member harnesses | [LLM configuration](concepts/llm-configuration.md) |
| A5 Templates | SDLC / pipeline templates per 7R, deliverable templates, RACI templates | Defaults ship in the image; projects override in the workspace repo |

### B. Delivery
Maps one-to-one onto pipeline phases ([delivery pipeline](../methodology/delivery-pipeline.md)).

| Sub-module | Phase | Main functions |
|---|---|---|
| B1 Portfolio & Assessment | P1 | Inventory, auto-discovery, dependency graph, weighted scorecard, 7R recommendation, wave planning. `assessment` and `wave-planner` draft; the architect approves |
| B2 Architecture Studio | P2 | AS-IS vs TO-BE architecture, ADRs, gap list, co-existence strategy, POC plan, cost-benefit, ARB review. Supported by `to-be-analyst` |
| B3 Factory Setup | P3 | Base source, IaC, CI/CD; select skill packs and task-pack templates; configure `gate-reviewer` rules; pilot on 1–2 features |
| B4 Migration Workbench | P4 | Backlog of work items × stages; `task-planner` produces task packs; assignment to members; PR tracking; `gate-reviewer` review; design ↔ code sync |
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
| D6 Asset Governance | Lifecycle of skill packs, prompt libraries, task-pack templates and runtime agents: draft → eval → approved → deprecated |

### E. Core platform

| Component | Role |
|---|---|
| E1 Workflow Orchestrator | pg-boss job queue + phase / stage / gate state machine; approvals are DB states; retries; fan-out per wave |
| E2 Knowledge Hub | AS-IS / TO-BE KB: sources in Git, index (pgvector + edge tables) in Postgres; ingestion; search API |
| E3 Asset Registry | Version index of skill packs, prompt libraries, task-pack templates and runtime agent definitions (files in the image, overridable in `.kintsugi/assets/`) |
| E4 Kintsugi Runtime (pi) | Runs [runtime agents](../reference/runtime-agents.md), one container per job |
| E5 Harness Hub | MCP server, CLI backend, asset rendering, policy distribution, telemetry ingest ([harness integration](../reference/harness-integration.md)) |
| E6 Git Sync & Writer | Sync many repos across many Git servers; commit / PR runtime results to the workspace repo |
| E7 Events | Domain events (job.started, pr.opened, gate.passed, artifact.registered…) via outbox + `LISTEN/NOTIFY` |
| E8 Connectors | Git provider APIs (PRs, comments, webhooks), trackers, wikis, observability |

### Who uses what

| Role | Main modules |
|---|---|
| PM / program manager | B (all), C2, C3, D3, D5 |
| BA | B1, B2, E2 (AS-IS chatbot) |
| Architect / ARB | B2, D2, D3 |
| Dev / QC | B4, B5, mostly from their own harness via MCP + CLI |
| AI champion / AI engineer / prompt engineer | B3, E3, E4, D6, C1 |
| KM lead / KM engineer | E2 |
| AI practice owner | C3, A5 |
| Installation admin | A |

## 5.2 Level 2 — containers and code

| Container | Modules | Code |
|---|---|---|
| `kintsugi-app` | API, portal, Harness Hub (MCP, CLI API), job gateway | `apps/api`, `apps/portal`, `services/harness-hub` |
| `kintsugi-worker` | Orchestrator, Git Sync & Writer, ingestion, job launcher | `services/orchestrator`, `services/knowledge`, `services/runtime` (launcher) |
| `kintsugi-runner` | Runtime agent execution (per job) | `services/runtime` (runner), `runtime/` (agent definitions + skills) |

Shared libraries and assets:

| Path | Content |
|---|---|
| `packages/domain` | Shared vocabulary: phases, 7R, roles, work items, provenance, Git servers / repositories, scorecard |
| `packages/runtime-sdk` | `AgentRuntime`, `JobSpec`, `JobEvent`, LLM provider configuration types |
| `packages/harness-sdk` | `TaskPack`, `AssetRenderer`, `HarnessActivity`, `HarnessPolicy` |
| `harness/` | Canonical skills and task-pack templates for member harnesses |
| `deploy/compose` | The Docker Compose package |
