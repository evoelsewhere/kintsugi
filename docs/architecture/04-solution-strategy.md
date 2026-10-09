# 4. Solution strategy

## 4.1 Core principles

| # | Principle | Consequence | ADR |
|---|---|---|---|
| 1 | **Separate the brain from the hands** | The Kintsugi Runtime (pi) does knowledge, assessment, planning and review. Members implement in their own harnesses | [0001](../decisions/0001-pi-as-kintsugi-runtime.md) |
| 2 | **Self-hosted, single-host package** | Docker Compose, one installation per organization, no Kubernetes, no multi-tenancy | [0006](../decisions/0006-self-hosted-package.md) |
| 3 | **Git is the source of truth** | Documents and deliverables are files in Git; Postgres holds state + rebuildable indexes; many Git servers and repos | [0007](../decisions/0007-git-as-source-of-truth.md) |
| 4 | **One datastore** | Postgres + pgvector for state, KB index, queue, events, audit | [0010](../decisions/0010-postgres-only.md) |
| 5 | **Isolate every runtime job** | One container per job, read-only sources, `/out` only, egress proxy | [0004](../decisions/0004-runner-container-per-job.md) |
| 6 | **Write assets once, render per harness** | Agent Skills + `AGENTS.md` as canonical formats | [0005](../decisions/0005-canonical-asset-format.md) |
| 7 | **Provider-agnostic runtime** | Every LLM provider pi supports, plus custom endpoints, configured in the portal | [0009](../decisions/0009-llm-provider-config.md) |

## 4.2 Technology choices

| Concern | Choice | Status |
|---|---|---|
| Language / monorepo | TypeScript, pnpm + Turborepo | ✅ [0002](../decisions/0002-typescript-monorepo.md) |
| Agent runtime | pi SDK (`@earendil-works/pi-coding-agent`, pinned) in a Node runner | ✅ [0001](../decisions/0001-pi-as-kintsugi-runtime.md), [0004](../decisions/0004-runner-container-per-job.md) |
| Orchestration | pg-boss + state machine in Postgres | ✅ [0003](../decisions/0003-postgres-job-queue.md) |
| Data | PostgreSQL 16+ with pgvector; edge tables for the KB graph | ✅ [0010](../decisions/0010-postgres-only.md) |
| Live updates | Outbox + `LISTEN/NOTIFY` → SSE | ✅ [0010](../decisions/0010-postgres-only.md) |
| Auth | Local username/password (argon2id), sessions, PATs; Entra ID later | ✅ [0008](../decisions/0008-authentication.md) |
| API | REST + OpenAPI; NestJS or Fastify | 🟡 D10 |
| Portal | React SPA (Vite) + shadcn/ui | 🟡 D11 |
| Code analysis | tree-sitter + SCIP/LSP indexes | ⬜ D14 |
| Document parsing | Python sidecar (docling / markitdown) | ⬜ D15 |

Open points are tracked in the [decision register](../decisions/README.md).
