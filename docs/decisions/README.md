# Decisions

This page has two parts:

- **[ADR index](#adr-index)**: the Architecture Decision Records, one file per decision.
- **[Decision register](#decision-register)**: every architecture point that needs a decision, with its status. A decided point links to its ADR.

## Process

1. **Add the point.** Add it to the register with status ⬜ (open) or 🟡 (proposed default).
2. **Write the ADR.** When the point is ready to decide, copy [template.md](template.md) to `NNNN-short-title.md`. Use the next free number.
3. **Accept.** On acceptance, set the ADR to `Accepted`, set the register entry to ✅, and update the affected documents.
4. **Change a decision.** Never rewrite an accepted ADR's decision. Write a new ADR that supersedes it, and mark the old one `Superseded by ADR-XXXX`.

**Status**: ✅ Decided · 🟡 Proposed (default, awaiting confirmation) · ⬜ Open.
**Priority**: 🔴 blocks M0 · 🟠 needed before M1–M2 · 🟢 can wait (safe default exists).

## ADR index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-pi-as-kintsugi-runtime.md) | pi is the Kintsugi Runtime; members implement with their own harnesses | Accepted |
| [0002](0002-typescript-monorepo.md) | TypeScript monorepo (pnpm + Turborepo) | Proposed |
| [0003](0003-postgres-job-queue.md) | pg-boss (Postgres-backed job queue) for orchestration | Accepted |
| [0004](0004-runner-container-per-job.md) | One Docker container per runtime job, with a pi SDK runner inside | Accepted |
| [0005](0005-canonical-asset-format.md) | Canonical asset format = Agent Skills + AGENTS.md | Proposed |
| [0006](0006-self-hosted-package.md) | Kintsugi is distributed as a self-hosted package | Accepted |
| [0007](0007-git-as-source-of-truth.md) | Git is the source of truth for code, documents and assets | Accepted |
| [0008](0008-authentication.md) | Local username/password first, Azure AD (Entra ID) later | Accepted |
| [0009](0009-llm-provider-config.md) | LLM provider configuration for the pi runtime | Accepted |
| [0010](0010-postgres-only.md) | PostgreSQL is the only datastore | Accepted |

## Decision register

| ID | Point | Priority | Decision / proposal | Due | Status |
|---|---|---|---|---|---|
| D01 | Deployment model | 🔴 | Self-hosted package per project (Docker Compose); one installation = one organization | M0 | ✅ [0006](0006-self-hosted-package.md) |
| D02 | Where code & documents live | 🔴 | Git is the source of truth; Postgres keeps state + rebuildable indexes | M0 | ✅ [0007](0007-git-as-source-of-truth.md) |
| D03 | Cloud / hosting | — | Not applicable: each project chooses its host; one Docker host is enough | — | ✅ [0006](0006-self-hosted-package.md) |
| D04 | LLMs for the pi runtime | 🔴 | Provider registry covering every pi provider + custom providers; credentials encrypted in the DB | M0 | ✅ [0009](0009-llm-provider-config.md) |
| D05 | Data isolation | 🔴 | No multi-tenancy; authorization by project + role | M0 | ✅ [0006](0006-self-hosted-package.md) |
| D06 | How pi is embedded | 🔴 | Node runner using the pi SDK inside a container, streaming `JobEvent`s out | M0 | ✅ [0004](0004-runner-container-per-job.md) |
| D07 | Sandbox | 🔴 | One Docker container per job, no Kubernetes; hardening + egress proxy; gVisor when available | M0 | ✅ [0004](0004-runner-container-per-job.md) |
| D08 | Orchestration | 🔴 | pg-boss + state machine in the DB; no Temporal | M0 | ✅ [0003](0003-postgres-job-queue.md) |
| D09 | Sign-in | 🔴 | Username/password + PATs; Entra ID later behind `AuthProvider` | M0 | ✅ [0008](0008-authentication.md) |
| D10 | API | 🟠 | REST + OpenAPI; NestJS or Fastify | M0 | 🟡 |
| D11 | Portal | 🟢 | React SPA (Vite) + shadcn/ui, static build served by `kintsugi-app` | M0 | 🟡 |
| D12 | Vector store | — | pgvector | — | ✅ [0010](0010-postgres-only.md) |
| D13 | Graph store | — | Edge tables in Postgres + recursive CTE | — | ✅ [0010](0010-postgres-only.md) |
| D14 | Source-code analysis | 🟠 | tree-sitter + SCIP/LSP indexes; LLM for summaries. Needs the list of priority legacy stacks | M1 | ⬜ |
| D15 | Document parsing (xlsx/docx, multilingual) | 🟠 | Python sidecar (docling / markitdown + Excel → Markdown); adds one container | M1 | ⬜ |
| D16 | Embedding model | 🟠 | Configured like LLM providers; must offer a local option | M1 | ⬜ |
| D17 | MCP transport + auth | 🟠 | Remote Streamable HTTP on `kintsugi-app`, PAT auth; OAuth with Entra ID | M2 | 🟡 |
| D18 | Priority member harness + license tier | 🟠 | Copilot first, Claude Code second | M2 | ⬜ |
| D19 | Asset distribution to harnesses | 🟠 | `kintsugi assets pull` renders into repos under managed paths + MCP for dynamic content | M2 | 🟡 |
| D20 | Source of truth for work items | 🟠 | Work items in Kintsugi (DB) + task packs in Git; status sync with Jira / Azure DevOps | M2 | ⬜ |
| D21 | Measuring "AI-generated" | 🟠 | Mandatory declaration (commit trailer + PR template); telemetry for cross-checking | M3 | 🟡 |
| D22 | Git servers & repositories | 🔴 | Many Git servers and many repos; plain git everywhere; API adapters GitHub → Azure DevOps → GitLab → Bitbucket → Gitea | M0 | ✅ [0007](0007-git-as-source-of-truth.md) |
| D23 | Events | — | Postgres outbox + `LISTEN/NOTIFY` → SSE | — | ✅ [0010](0010-postgres-only.md) |
| D24 | Observability | 🟢 | Usage/cost/events in Postgres, shown in the portal; optional OTel export | M0 | 🟡 |
| D25 | Policy engine | 🟢 | TypeScript rules + policy in `kintsugi.yaml`; consider OPA/Cedar in M4 | M4 | 🟡 |
| D26 | Audit log | 🟢 | Append-only, hash-chained table in Postgres | M4 | 🟡 |
| D27 | pi versioning | 🟢 | Pin exact version in the runner image; upgrade when the eval suite passes | M0 | 🟡 |
| D28 | Runtime agent definitions | 🟢 | Defaults in the image; projects override via `.kintsugi/assets/` | M1 | 🟡 |
| D29 | Workspace repo layout + how the runtime writes to Git | 🔴 | One workspace repo per project; worker commits on `kintsugi/*` branches + PR; configurable auto-commit paths ([reference](../reference/workspace-repo.md)) | M0 | 🟡 |
| D30 | Webhooks vs. polling | 🟠 | Polling by default (1–5 min); webhooks when reachable | M2 | 🟡 |
| D31 | Large binaries (recordings, video, scanned PDFs) | 🟠 | Git LFS where supported; otherwise the `kintsugi-data` volume + a link file in Git | M1 | ⬜ |
| D32 | Worker's Docker API access | 🔴 | docker-socket-proxy limited to container lifecycle; or rootless Docker | M0 | 🟡 |
| D33 | Minimum host requirements | 🟢 | Linux, Docker 24+ (26+ for volume subpaths), Compose v2, 4 vCPU / 16 GB / 100 GB | M0 | 🟡 |

## Notes on open points

### D29 — Workspace repo
| Question | Proposal |
|---|---|
| Dedicated workspace repo, or a `kintsugi/` folder in an existing repo? | A dedicated repo (access and history separate from code) |
| Do runtime results reach Git through PRs or direct commits? | PRs by default; direct commits for `auto-commit` paths (task packs, generated docs) |
| Who authors Kintsugi's commits? | `kintsugi-bot` + trailers `Kintsugi-Job`, `Kintsugi-Agent` |

### D32 — Docker API
Mounting `/var/run/docker.sock` directly amounts to root on the host. Proposal:
- Expose only container create / start / wait / logs / delete (plus images, to pull the runner) through `docker-socket-proxy`.
- The worker rejects any image other than `kintsugi-runner:<version>` and any mount outside the job directory.

### D14 / D15 — Legacy stacks and documents
A list of priority stacks is needed to choose parsers. Common candidates:
- .NET / VB.NET
- React and other legacy JavaScript frameworks
- PHP
- Java
- Flex
- COBOL / DB2
- stored procedures
- spreadsheet-based design documents, often non-English

## Next decisions
1. **Now**: D29, D32.
2. **Before M1**: D14, D15, D16, D31.
3. **Before M2**: D17–D20, D30.
