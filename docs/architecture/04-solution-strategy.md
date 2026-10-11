# 4. Solution strategy

## 4.1 Core principles

| # | Principle | Consequence | ADR |
|---|---|---|---|
| 1 | **Separate the brain from the hands** | The Kintsugi Runtime (pi) does knowledge, assessment, planning and review. Members implement in their own harnesses | [0001](../decisions/0001-pi-as-kintsugi-runtime.md) |
| 2 | **Self-hosted, single-host package** | Docker Compose, one installation per organization, no Kubernetes, no multi-tenancy | [0006](../decisions/0006-self-hosted-package.md) |
| 3 | **Git is the source of truth** | Documents, deliverables, standards and work item state are files in Git; Postgres holds operational data + rebuildable indexes; many Git servers and repos | [0007](../decisions/0007-git-as-source-of-truth.md), [0012](../decisions/0012-work-items-as-files-in-git.md) |
| 4 | **One datastore** | Postgres + pgvector for state, KB index, queue, events, audit | [0010](../decisions/0010-postgres-only.md) |
| 5 | **Isolate every runtime job** | One job workspace per job: read-only source and inputs, writes only to its output, cleared environment, limits, JobOutput hook before publishing; no OS sandbox | [0029](../decisions/0029-job-workspaces-instead-of-os-sandboxes.md) |
| 6 | **Package assets once as agent plugins** | Claude Code plugin format (skills, agents, commands, hooks, MCP); generated marketplaces for Claude Code, Copilot CLI and Codex; fallback rendering elsewhere | [0005](../decisions/0005-canonical-asset-format.md), [0015](../decisions/0015-member-assets-as-agent-plugins.md) |
| 7 | **Provider-agnostic runtime** | Every LLM provider pi supports, plus custom endpoints, configured in the portal | [0009](../decisions/0009-llm-provider-config.md) |
| 8 | **Common engine, project-written standards** | Kintsugi is stack-agnostic; each project keeps its standards (conventions, mappings, review rules) and member plugins as plain documents in its single document repo | [0028](../decisions/0028-remove-rulebook-single-document-repo.md) |
| 9 | **Open, never locked** | Declarative pipelines in `kintsugi.yaml`, open harness ids, declarative harness renderers, member plugins in the Claude Code plugin format | [0015](../decisions/0015-member-assets-as-agent-plugins.md), [0028](../decisions/0028-remove-rulebook-single-document-repo.md) |
| 10 | **Keep the engine small** | No code graph or parsers, no unit-discovery or agent configuration; agents read code directly; the runtime is a generic agent kernel with agents supplied per job | [0014](../decisions/0014-no-code-graph-no-agent-config.md), [0023](../decisions/0023-runtime-as-generic-agent-kernel.md) |

## 4.2 Technology choices

| Concern | Choice | Status |
|---|---|---|
| Language / monorepo | TypeScript, pnpm + Turborepo | ✅ [0002](../decisions/0002-typescript-monorepo.md) |
| Agent runtime | pi SDK (`@earendil-works/pi-coding-agent`, exact pin, currently 1.1.0) in a Node runner | ✅ [0001](../decisions/0001-pi-as-kintsugi-runtime.md), [0004](../decisions/0004-runner-container-per-job.md), [0018](../decisions/0018-pin-pi-exact-version.md) |
| Orchestration | pg-boss + state machine in Postgres | ✅ [0003](../decisions/0003-postgres-job-queue.md) |
| Data | PostgreSQL 16+ with pgvector (text KB, no graph) | ✅ [0010](../decisions/0010-postgres-only.md), [0014](../decisions/0014-no-code-graph-no-agent-config.md) |
| Live updates | Outbox + `LISTEN/NOTIFY` → SSE | ✅ [0010](../decisions/0010-postgres-only.md) |
| Auth | Local username/password (argon2id), sessions, PATs; Entra ID later | ✅ [0008](../decisions/0008-authentication.md) |
| API | REST + OpenAPI; NestJS 12 (ESM) + Standard Schema validation | ✅ [0016](../decisions/0016-nestjs-api-framework.md) |
| Portal | React 19 SPA (Vite) + shadcn/ui on Tailwind v4, static build served by `kintsugi-app` | ✅ [0017](../decisions/0017-portal-vite-react-shadcn.md) |
| Code analysis | None: agents read source files directly + text KB search | ✅ [0014](../decisions/0014-no-code-graph-no-agent-config.md) |
| Document conversion | Python sidecar (docling / markitdown) for xlsx/docx → md | ⬜ D15 |

Open points are tracked in the [decision register](../decisions/README.md).
