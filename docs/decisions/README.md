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
| [0003](0003-postgres-job-queue.md) | pg-boss (Postgres-backed job queue) for orchestration | Accepted (state persistence amended by 0012) |
| [0004](0004-runner-container-per-job.md) | One Docker container per runtime job, with a pi SDK runner inside | Accepted (isolation amended by 0029) |
| [0005](0005-canonical-asset-format.md) | Canonical asset format = Agent Skills + AGENTS.md | Superseded by 0015 |
| [0006](0006-self-hosted-package.md) | Kintsugi is distributed as a self-hosted package | Accepted |
| [0007](0007-git-as-source-of-truth.md) | Git is the source of truth for code, documents and assets | Accepted (amended by 0043) |
| [0008](0008-authentication.md) | Local username/password first, Azure AD (Entra ID) later | Accepted |
| [0009](0009-llm-provider-config.md) | LLM provider configuration for the pi runtime | Accepted |
| [0010](0010-postgres-only.md) | PostgreSQL is the only datastore | Accepted (graph tables removed by 0014) |
| [0011](0011-project-rulebook.md) | Every project builds its own rulebook before running the pipeline | Superseded by 0028 |
| [0012](0012-work-items-as-files-in-git.md) | Work items are files in the workspace repo; Postgres indexes them | Accepted (amended by 0028, 0042) |
| [0013](0013-composable-open-rulebook.md) | Composable, open rulebook | Superseded by 0028 |
| [0014](0014-no-code-graph-no-agent-config.md) | No code graph or parsing, no unit-discovery config, built-in runtime agents fixed in code | Accepted (decision 3 superseded by 0023) |
| [0015](0015-member-assets-as-agent-plugins.md) | Member-harness assets are agent plugins (Claude Code plugin format) | Accepted (amended by 0028, 0041) |
| [0016](0016-nestjs-api-framework.md) | NestJS is the API framework for `apps/api` | Accepted |
| [0017](0017-portal-vite-react-shadcn.md) | Portal is a Vite + React SPA with shadcn/ui | Accepted |
| [0018](0018-pin-pi-exact-version.md) | Pin pi to an exact version; track the latest release | Accepted |
| [0019](0019-workspace-repo-write-path.md) | One workspace repo per project; the worker writes as `kintsugi-bot` | Accepted (amended by 0028, 0033) |
| [0020](0020-docker-api-via-socket-proxy.md) | The worker reaches Docker only through a socket proxy, with an image allowlist | Superseded by 0029 |
| [0021](0021-sandboxed-child-processes.md) | Sandboxed child processes with pi-sandbox instead of per-job containers | Superseded by 0029 |
| [0022](0022-agents-as-installation-data.md) | Agents are installation data — built-in and custom, managed in the portal | Superseded by 0023 |
| [0023](0023-runtime-as-generic-agent-kernel.md) | The runtime is a generic agent kernel; agents are data supplied per job | Accepted (write tool amended by 0037) |
| [0024](0024-access-roles-vs-project-roles.md) | Distinguish access roles from project roles | Accepted (amended by 0042) |
| [0025](0025-git-core-and-checkout-storage.md) | Git core package and Kintsugi-managed checkout storage | Accepted |
| [0026](0026-runtime-agents-and-agent-builder.md) | Built-in and custom runtime agents, packaged and managed in an Agent Builder | Accepted |
| [0027](0027-builtin-modernization-content.md) | Built-in modernization content in packages/agents: agents, commands, workflows, scripts, hooks and tests | Accepted (amended by 0028, 0029, 0033) |
| [0028](0028-remove-rulebook-single-document-repo.md) | Remove the rulebook; one document repo per project | Accepted (amended by 0041, 0043) |
| [0029](0029-job-workspaces-instead-of-os-sandboxes.md) | Job workspaces instead of OS sandboxes | Accepted |
| [0030](0030-worker-heartbeat-in-postgres.md) | Worker heartbeat in Postgres | Accepted |
| [0031](0031-understand-stage-as-is-specification.md) | understand stage: per-unit AS-IS specification closes the Understand phase | Accepted (diagrams amended by 0032; §1, §3, §6 superseded by 0033) |
| [0032](0032-mermaid-diagrams-skill.md) | Mermaid for every diagram, drawn by a built-in skill and checked by a lint | Accepted (§2 skill content superseded by 0036) |
| [0033](0033-assess-catalog-understand-selection.md) | Two runtime stages: assess builds the item catalog; understand runs on a selection | Accepted (layout statements amended by 0038) |
| [0034](0034-understand-command-merges-map-rules-harden.md) | One understand command; map, extract-rules and harden are parts of it | Accepted |
| [0037](0037-kernel-write-and-edit-tools-from-pi.md) | The kernel writes with pi's `write` and `edit`, not a custom `outputs_write` | Accepted (amends 0023) |
| [0038](0038-document-repo-layout-by-subject-and-sdlc-phase.md) | Document repository layout by subject and SDLC phase | Accepted (amended by 0042, 0043) |
| [0039](0039-github-actions-ghcr-deployment.md) | Build and deploy the self-hosted package with GitHub Actions | Accepted |
| [0040](0040-kernel-shell-and-git-tools.md) | The kernel gets `shell` and `git` tools and an `ls` tree mode | Accepted (supersedes 0037 D4 and 0029's no-shell statements) |
| [0041](0041-member-access-through-cli-and-local-mcp.md) | Local member access through the CLI and stdio MCP | Accepted |
| [0042](0042-member-context-and-project-access.md) | Scope member context to project access and immutable snapshots | Accepted |
| [0043](0043-evidence-bound-pr-continuation.md) | Continue workflows from evidence-bound pull requests and gates | Accepted |
| [0036](0036-mermaid-skill-from-wh-2099.md) | The `mermaid-diagrams` skill is the WH-2099 mermaid skill | Accepted (amends 0032) |
| [0035](0035-kintsugi-plugins-marketplace.md) | Kintsugi plugins: one marketplace of plugins in the Claude plugin format replaces the agent catalog | Accepted (amended by 0041) |

## Decision register

| ID | Point | Priority | Decision / proposal | Due | Status |
|---|---|---|---|---|---|
| D01 | Deployment model | 🔴 | Self-hosted package per project (Docker Compose); one installation = one organization | M0 | ✅ [0006](0006-self-hosted-package.md) |
| D02 | Where code & documents live | 🔴 | Git is the source of truth; Postgres keeps state + rebuildable indexes | M0 | ✅ [0007](0007-git-as-source-of-truth.md) |
| D03 | Cloud / hosting | — | Not applicable: each project chooses its host; one Docker host is enough | — | ✅ [0006](0006-self-hosted-package.md) |
| D04 | LLMs for the pi runtime | 🔴 | Provider registry covering every pi provider + custom providers; credentials encrypted in the DB | M0 | ✅ [0009](0009-llm-provider-config.md) |
| D05 | Data isolation | 🔴 | No multi-tenancy; installation access-role permissions and project scope are separate; project-role assignment follows M0 project persistence | M0 | ✅ [0006](0006-self-hosted-package.md) |
| D06 | How pi is embedded | 🔴 | The pi SDK runs agent jobs in the worker, in a job workspace (was: a runner container per job) | M0 | ✅ [0004](0004-runner-container-per-job.md), [0029](0029-job-workspaces-instead-of-os-sandboxes.md) |
| D07 | Sandbox | 🔴 | Job workspace per job, the same on every OS: read-only source and inputs, writable output and scratch, cleared environment, limits, JobOutput hook; no OS-level isolation (was: one Docker container per job) | M0 | ✅ [0029](0029-job-workspaces-instead-of-os-sandboxes.md) |
| D08 | Orchestration | 🔴 | pg-boss + state machine in the DB; no Temporal | M0 | ✅ [0003](0003-postgres-job-queue.md) |
| D09 | Sign-in | 🔴 | Username/password + PATs; Entra ID later behind `AuthProvider` | M0 | ✅ [0008](0008-authentication.md) |
| D10 | API | 🟠 | REST + OpenAPI; NestJS 12 (ESM, Standard Schema validation) | M0 | ✅ [0016](0016-nestjs-api-framework.md) |
| D11 | Portal | 🟢 | React SPA (Vite) + shadcn/ui, static build served by `kintsugi-app` | M0 | ✅ [0017](0017-portal-vite-react-shadcn.md) |
| D12 | Vector store | — | pgvector | — | ✅ [0010](0010-postgres-only.md) |
| D13 | Graph store | — | None: no code / KB graph | — | ✅ [0014](0014-no-code-graph-no-agent-config.md) |
| D14 | Source-code analysis | — | None: agents read source files directly; KB is text chunks + embeddings | — | ✅ [0014](0014-no-code-graph-no-agent-config.md) |
| D15 | Document conversion (xlsx/docx → md, multilingual) | 🟠 | Python sidecar (docling / markitdown + Excel → Markdown); adds one container | M1 | ⬜ |
| D16 | Embedding model | 🟠 | Configured like LLM providers; must offer a local option | M1 | ⬜ |
| D17 | MCP transport + auth | 🟠 | Local stdio MCP from the installed CLI over the HTTPS member API; remote MCP/OAuth later | M2 | ✅ [0041](0041-member-access-through-cli-and-local-mcp.md) |
| D18 | Priority member harness + license tier | 🟠 | Claude Code end-to-end pilot first; Codex and Copilot CLI follow the same contract and require separate compatibility proof; member keeps its own AI subscription | M2 | ✅ [0041](0041-member-access-through-cli-and-local-mcp.md) |
| D19 | Asset distribution to harnesses | 🟠 | A small hookless member-access plugin is generated separately from optional method plugins; use client-specific setup after compatibility proof | M2 | ✅ [0015](0015-member-assets-as-agent-plugins.md), [0041](0041-member-access-through-cli-and-local-mcp.md) |
| D20 | Source of truth for units | 🟠 | One file per unit in the document repo (`units/**`), state in frontmatter; Postgres is a rebuildable index; single write path through the Kintsugi API (bot commits with actor trailer); Jira / Azure DevOps are mirrors | M2 | ✅ [0012](0012-work-items-as-files-in-git.md) |
| D21 | Measuring "AI-generated" | 🟠 | Mandatory declaration (commit trailer + PR template); telemetry for cross-checking | M3 | 🟡 |
| D22 | Git servers & repositories | 🔴 | Many Git servers and many repos; plain git everywhere; API adapters GitHub → Azure DevOps → GitLab → Bitbucket → Gitea | M0 | ✅ [0007](0007-git-as-source-of-truth.md) |
| D23 | Events | — | Postgres outbox + `LISTEN/NOTIFY` → SSE | — | ✅ [0010](0010-postgres-only.md) |
| D24 | Observability | 🟢 | Usage/cost/events in Postgres, shown in the portal; optional OTel export | M0 | 🟡 |
| D25 | Policy engine | 🟢 | TypeScript rules + policy in `kintsugi.yaml`; consider OPA/Cedar in M4 | M4 | 🟡 |
| D26 | Audit log | 🟢 | Append-only table in Postgres (done: `governance.audit_event`, one `AuditTrail` port, coverage in the [security concept](../architecture/concepts/security.md#audit-coverage)); hash-chaining still proposed | M4 | 🟡 |
| D27 | pi versioning | 🟢 | Track latest pi, pin exact versions of `@earendil-works/*` in the runner image; deliberate upgrades | M0 | ✅ [0018](0018-pin-pi-exact-version.md) |
| D28 | Runtime agent definitions | 🟢 | The runtime is a generic kernel; an agent definition (instructions, skills, tools, policy) is data supplied with each job; none is configured in any repo; built-in and custom agents are installation data (D46) | M1 | ✅ [0023](0023-runtime-as-generic-agent-kernel.md), [0026](0026-runtime-agents-and-agent-builder.md) |
| D29 | Document repo layout + how the runtime writes to Git | 🔴 | One document repo per project (renamed from workspace repo by [0028](0028-remove-rulebook-single-document-repo.md)); worker commits on `kintsugi/*` branches + PR as `kintsugi-bot`; `autoCommitPaths` (`units/**`, `tasks/**`, `knowledge/**/generated/**`, `assessment/**/generated/**`) commit directly to the default branch ([reference](../reference/document-repo.md)) | M0 | ✅ [0019](0019-workspace-repo-write-path.md), [0028](0028-remove-rulebook-single-document-repo.md) |
| D30 | Webhooks vs. polling | 🟠 | Polling by default (1–5 min); webhooks when reachable | M2 | 🟡 |
| D31 | Large binaries (recordings, video, scanned PDFs) | 🟠 | Git LFS where supported; otherwise the `kintsugi-data` volume + a link file in Git | M1 | ⬜ |
| D32 | Worker's Docker API access | 🔴 | None: jobs run in job workspaces of the worker, no Docker socket (supersedes the socket proxy of 0020 and the pi-sandbox proposal of 0021) | M0 | ✅ [0029](0029-job-workspaces-instead-of-os-sandboxes.md) |
| D34 | Project-specific knowledge | 🔴 | Superseded: the rulebook is removed ([0028](0028-remove-rulebook-single-document-repo.md)) | M0 | ✅ [0028](0028-remove-rulebook-single-document-repo.md) |
| D35 | Capability maturity & readiness gating | 🔴 | Superseded: the rulebook is removed ([0028](0028-remove-rulebook-single-document-repo.md)) | M0 | ✅ [0028](0028-remove-rulebook-single-document-repo.md) |
| D36 | Rulebook structure | 🔴 | Superseded: the rulebook is removed ([0028](0028-remove-rulebook-single-document-repo.md)) | M0 | ✅ [0028](0028-remove-rulebook-single-document-repo.md) |
| D37 | Reuse across projects | 🟢 | Superseded: the rulebook is removed ([0028](0028-remove-rulebook-single-document-repo.md)) | M4 | ✅ [0028](0028-remove-rulebook-single-document-repo.md) |
| D38 | Runner images | 🔴 | Superseded: the rulebook is removed ([0028](0028-remove-rulebook-single-document-repo.md)) | M0 | ✅ [0028](0028-remove-rulebook-single-document-repo.md) |
| D39 | Project runtime agents & runtime MCP | — | Not supported (removed) | — | ✅ [0014](0014-no-code-graph-no-agent-config.md) |
| D43 | Member asset packaging | 🟠 | Keep method plugins in Claude Code format; generate a separate hookless access plugin that launches the installed CLI local MCP bridge; server authorization is authoritative | M2 | ✅ [0015](0015-member-assets-as-agent-plugins.md), [0028](0028-remove-rulebook-single-document-repo.md), [0041](0041-member-access-through-cli-and-local-mcp.md) |
| D42 | Unit discovery | — | No discovery config; unit files declared by people or proposed by `assessment` via PR; `dependsOn` written, not computed | — | ✅ [0014](0014-no-code-graph-no-agent-config.md) |
| D40 | Member harness registry | 🟠 | Open harness ids; plugin support per harness (native / converted / none); declarative fallback renderers (built-in / installation / project); transformer plugins installed by admins | M2 | ✅ [0015](0015-member-assets-as-agent-plugins.md) |
| D41 | Stale units on rule change | 🟠 | Superseded: the rulebook is removed ([0028](0028-remove-rulebook-single-document-repo.md)) | M3 | ✅ [0028](0028-remove-rulebook-single-document-repo.md) |
| D44 | Access roles vs. project roles | 🔴 | Keep installation-wide permission-bundle access roles separate from project RACI roles; assign project roles per membership after M0 project persistence | M0 | ✅ [0024](0024-access-roles-vs-project-roles.md) |
| D45 | Git access and checkout storage | 🔴 | Kintsugi clones from registered URLs into one admin-chosen data directory (`KINTSUGI_DATA_DIR`): bare mirror per repository, per-job worktree at a fixed commit; `packages/git` over the system `git` CLI with per-call credentials; provider REST adapters, no provider CLIs | M0 | ✅ [0025](0025-git-core-and-checkout-storage.md) |
| D46 | Runtime agents and the Agent Builder | 🔴 | Five built-in read-only agents for understanding (legacy-analyst, business-rules-extractor, version-delta-analyst, architecture-critic, security-auditor) plus admin-created agents; agent files + Agent Skills (format per ADR-0027); draft and immutable published versions; implementation stays with members | M0 | ✅ [0026](0026-runtime-agents-and-agent-builder.md) |
| D47 | Built-in modernization content | 🔴 | Upstream code-modernization content copied into `packages/agents/builtin/` (pinned, Apache-2.0, no assets) and adapted: runtime and member agents (`metadata.audience`), stage commands, workflows, scripts in the job workspace, server-side hooks, tests | M0 | ✅ [0027](0027-builtin-modernization-content.md), [0029](0029-job-workspaces-instead-of-os-sandboxes.md) |
| D48 | Project knowledge and repository model | 🔴 | No rulebook; one document repo per project holds everything except code; project knowledge as plain documents in `standards/` and member plugins in `plugins/`; pipelines in `kintsugi.yaml` or built-in; repo roles `legacy` / `legacy-data` (AS-IS, read-only) and `target` with `component` (TO-BE, members only) | M0 | ✅ [0028](0028-remove-rulebook-single-document-repo.md) |
| D51 | Diagrams | 🟢 | Mermaid only; built-in `mermaid-diagrams` skill (the WH-2099 mermaid skill, ADR-0036) loaded by the drawing agents; stdlib `mermaid_lint.py`, run by members and by the JobOutput hook as non-blocking warnings | M1 | ✅ [0032](0032-mermaid-diagrams-skill.md) |
| D50 | Reverse engineering of the AS-IS system | 🔴 | Current plans: `assess` builds application inventory, topology and the item catalog; `understand` runs on selected units and writes per-unit topology, rules, findings, AS-IS specifications, trace/meta and unit state in a pull request; aggregates are rebuilt after merge under `generated/`. This supersedes the original separate-stage layout | M1 | ✅ [0031](0031-understand-stage-as-is-specification.md), amended by [0033](0033-assess-catalog-understand-selection.md) |
| D52 | Selective understanding | 🔴 | Two runtime stages: `assess` builds the item catalog (`assessment/<app>/catalog.json`, module → item, from the topology without parsers, curated, reconciled across re-assess); `understand` runs topology, rule extraction and security review as steps on selected catalog items, one pull request per run, per-unit outputs, aggregates rebuilt under `generated/` after merge, unit-namespaced ids, item status derived, units in an open PR blocked, failed runs resumable | M1 | ✅ [0033](0033-assess-catalog-understand-selection.md), layout amended by [0038](0038-document-repo-layout-by-subject-and-sdlc-phase.md) |
| D53 | Understand command | 🟢 | One `understand` command specifies the phase; `map`, `extract-rules` and `harden` commands and stage plans are removed (their method is its "Method reference") | M1 | ✅ [0034](0034-understand-command-merges-map-rules-harden.md) |
| D54 | Kintsugi plugins | 🟢 | Plugins are method capabilities (understand, modernize, project methods); member access is a separate hookless connector and does not require a method plugin | M1 | ✅ [0035](0035-kintsugi-plugins-marketplace.md), [0041](0041-member-access-through-cli-and-local-mcp.md) |
| D55 | Document repository layout | 🔴 | One repo per project; root for project-wide material, `applications/<app>/` for application content and one full-id unit directory for P1–P5 evidence; generated aggregates, rule-review separation, stable citation-derived rule ids, requirement/rule/PR/test traceability and merged gate records | M1 | ✅ [0038](0038-document-repo-layout-by-subject-and-sdlc-phase.md) |
| D56 | Container build and deployment | 🔴 | GitHub Actions builds SHA-tagged app/worker images, publishes them to configurable GHCR by default, and deploys the Compose stack over pinned-host-key SSH | M0 | ✅ [0039](0039-github-actions-ghcr-deployment.md) |
| D57 | Read-only member access | 🟠 | Local CLI and stdio MCP share one project-scoped HTTPS contract; the developer chosen AI reads and explains authorized Kintsugi documents | M2 | ✅ [0041](0041-member-access-through-cli-and-local-mcp.md) |
| D58 | Task context and snapshot | 🟠 | Read validated Git task sources with activity-specific readiness; pin every contextual response to an authorized immutable multi-repository snapshot with citations | M2 | ✅ [0042](0042-member-context-and-project-access.md) |
| D59 | PR continuation and effective gates | 🟠 | Reconcile current GitHub PR state; review fixed complete revisions; advance only from authorized human approval and a merged evidence-bound gate record | M2 | ✅ [0043](0043-evidence-bound-pr-continuation.md) |
| D49 | Worker liveness | 🟠 | Each worker upserts `workflow.worker_heartbeat` every 15 s and marks itself stopped on shutdown; up = seen < 45 s ago (database clock); no HTTP probe, no pg-boss internals | M0 | ✅ [0030](0030-worker-heartbeat-in-postgres.md) |
| D33 | Minimum host requirements | 🟢 | Linux, Docker 24+ (26+ for volume subpaths), Compose v2, 4 vCPU / 16 GB / 100 GB | M0 | 🟡 |

## Notes on open points

### D29 — Document repo (formerly workspace repo)
| Question | Proposal |
|---|---|
| Dedicated document repo, or a `kintsugi/` folder in an existing repo? | A dedicated repo (access and history separate from code) |
| Do runtime results reach Git through PRs or direct commits? | PRs by default; direct commits for auto-commit paths. Current defaults: `applications/*/units/**/unit.md`, `applications/*/units/**/task.md`, `applications/*/generated/**` (ADR-0038) |
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
1. **Now**: (D29 and D32 are decided — [0019](0019-workspace-repo-write-path.md), [0020](0020-docker-api-via-socket-proxy.md).)
2. **Before M1**: D15, D16, D31.
3. **Before M2**: D17–D20, D30.
