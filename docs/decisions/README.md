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
| [0007](0007-git-as-source-of-truth.md) | Git is the source of truth for code, documents and assets | Accepted |
| [0008](0008-authentication.md) | Local username/password first, Azure AD (Entra ID) later | Accepted |
| [0009](0009-llm-provider-config.md) | LLM provider configuration for the pi runtime | Accepted |
| [0010](0010-postgres-only.md) | PostgreSQL is the only datastore | Accepted (graph tables removed by 0014) |
| [0011](0011-project-rulebook.md) | Every project builds its own rulebook before running the pipeline | Superseded by 0028 |
| [0012](0012-work-items-as-files-in-git.md) | Work items are files in the workspace repo; Postgres indexes them | Accepted (amended by 0028) |
| [0013](0013-composable-open-rulebook.md) | Composable, open rulebook | Superseded by 0028 |
| [0014](0014-no-code-graph-no-agent-config.md) | No code graph or parsing, no unit-discovery config, built-in runtime agents fixed in code | Accepted (decision 3 superseded by 0023) |
| [0015](0015-member-assets-as-agent-plugins.md) | Member-harness assets are agent plugins (Claude Code plugin format) | Accepted (amended by 0028) |
| [0016](0016-nestjs-api-framework.md) | NestJS is the API framework for `apps/api` | Accepted |
| [0017](0017-portal-vite-react-shadcn.md) | Portal is a Vite + React SPA with shadcn/ui | Accepted |
| [0018](0018-pin-pi-exact-version.md) | Pin pi to an exact version; track the latest release | Accepted |
| [0019](0019-workspace-repo-write-path.md) | One workspace repo per project; the worker writes as `kintsugi-bot` | Accepted (amended by 0028, 0033) |
| [0020](0020-docker-api-via-socket-proxy.md) | The worker reaches Docker only through a socket proxy, with an image allowlist | Superseded by 0029 |
| [0021](0021-sandboxed-child-processes.md) | Sandboxed child processes with pi-sandbox instead of per-job containers | Superseded by 0029 |
| [0022](0022-agents-as-installation-data.md) | Agents are installation data — built-in and custom, managed in the portal | Superseded by 0023 |
| [0023](0023-runtime-as-generic-agent-kernel.md) | The runtime is a generic agent kernel; agents are data supplied per job | Accepted (write tool amended by 0037) |
| [0024](0024-access-roles-vs-project-roles.md) | Distinguish access roles from project roles | Accepted |
| [0025](0025-git-core-and-checkout-storage.md) | Git core package and Kintsugi-managed checkout storage | Accepted |
| [0026](0026-runtime-agents-and-agent-builder.md) | Built-in and custom runtime agents, packaged and managed in an Agent Builder | Accepted |
| [0027](0027-builtin-modernization-content.md) | Built-in modernization content in packages/agents: agents, commands, workflows, scripts, hooks and tests | Accepted (amended by 0028, 0029, 0033) |
| [0028](0028-remove-rulebook-single-document-repo.md) | Remove the rulebook; one document repo per project | Accepted |
| [0029](0029-job-workspaces-instead-of-os-sandboxes.md) | Job workspaces instead of OS sandboxes | Accepted |
| [0030](0030-worker-heartbeat-in-postgres.md) | Worker heartbeat in Postgres | Accepted |
| [0031](0031-understand-stage-as-is-specification.md) | understand stage: per-unit AS-IS specification closes the Understand phase | Accepted (diagrams amended by 0032; §1, §3, §6 superseded by 0033) |
| [0032](0032-mermaid-diagrams-skill.md) | Mermaid for every diagram, drawn by a built-in skill and checked by a lint | Accepted (§2 skill content superseded by 0036) |
| [0033](0033-assess-catalog-understand-selection.md) | Two runtime stages: assess builds the item catalog; understand runs on a selection | Accepted (layout statements amended by 0038) |
| [0034](0034-understand-command-merges-map-rules-harden.md) | One understand command; map, extract-rules and harden are parts of it | Accepted |
| [0037](0037-kernel-write-and-edit-tools-from-pi.md) | The kernel writes with pi's `write` and `edit`, not a custom `outputs_write` | Accepted (amends 0023) |
| [0038](0038-document-repo-layout-by-subject-and-sdlc-phase.md) | Document repository layout by subject and SDLC phase | Accepted (tree superseded by 0042 and 0051; task context and evidence-bound continuation amended by 0052–0054) |
| [0039](0039-github-actions-ghcr-deployment.md) | Build and deploy the self-hosted package with GitHub Actions | Accepted |
| [0040](0040-kernel-shell-and-git-tools.md) | The kernel gets `shell` and `git` tools and an `ls` tree mode | Accepted (supersedes 0037 D4 and 0029's no-shell statements) |
| [0041](0041-ai-plan-for-understanding-order.md) | An AI plan for what to understand next, from the relationships between catalog items | Accepted (paths amended by 0042) |
| [0042](0042-markdown-only-document-repo-by-bounded-context.md) | A Markdown-only document repo, organized by bounded context | Accepted (supersedes the tree of 0038; amends 0031, 0033, 0041; Modernization context refined by 0044, 0045; tree superseded by 0051) |
| [0043](0043-rebuild-only.md) | Kintsugi rebuilds; it offers no choice of transformation strategy | Accepted |
| [0044](0044-design-phase-common-basic-detail.md) | The design phase: common, basic and detail design before implementation | Accepted |
| [0045](0045-design-templates-are-project-data.md) | Design templates are project data, kept in the document repo | Accepted |
| [0046](0046-one-file-per-business-rule.md) | One file per business rule, indexed by `rules.md` and `BUSINESS_RULES.md` | Accepted (amends 0038, 0042) |
| [0047](0047-kernel-extensions-codemode-and-http-mcp.md) | The kernel gets codemode and HTTP MCP servers, read-only by default | Accepted (amends 0023 decision 5) |
| [0048](0048-runtime-telemetry-compaction-and-prompt-cache.md) | Runtime telemetry, compaction and prompt-cache policy | Accepted |
| [0049](0049-design-sets-generated-by-the-runtime.md) | Design sets are generated by the runtime `design` stage | Accepted |
| [0050](0050-design-sets-scope-and-instructions.md) | Design sets have a scope, reads and instructions | Accepted (application folder moved by 0051) |
| [0051](0051-document-repo-layout-legacy-and-modern.md) | A numbered document repo layout, each application split into legacy and modern | Accepted (supersedes the tree of 0042; amends 0038, 0044, 0045, 0050) |
| [0052](0052-coding-agent-workflow-through-cli-and-local-mcp.md) | Coding Agent Workflow through the CLI and stdio MCP | Accepted (amends 0015, 0028 and 0035) |
| [0053](0053-coding-agent-context-and-project-access.md) | Scope Coding Agent Workflow context with Project Access and immutable snapshots | Accepted (amends 0012, 0024, 0038 and 0051) |
| [0054](0054-evidence-bound-pr-continuation.md) | Continue workflows from evidence-bound pull requests and gates | Accepted (amends 0007, 0028, 0038 and 0051) |
| [0055](0055-portable-agent-plugin-layouts.md) | Generate portable Agent Plugins packages for Codex and Copilot | Accepted (supersedes the Codex package layout in 0015) |
| [0056](0056-project-scoped-oauth-for-coding-agent-workflow.md) | Use project-scoped browser authorization for the local Coding Agent Workflow | Accepted (amends the OAuth deferral in 0052) |
| [0057](0057-codex-desktop-plugin-installation.md) | Stage the Coding Agent Workflow plugin and install it through Codex Desktop | Accepted (amends 0052 decisions 1 and 6) |
| [0036](0036-mermaid-skill-from-wh-2099.md) | The `mermaid-diagrams` skill is the WH-2099 mermaid skill | Accepted (amends 0032) |
| [0035](0035-kintsugi-plugins-marketplace.md) | Kintsugi plugins: one marketplace of plugins in the Claude plugin format replaces the agent catalog | Accepted (amended by 0052) |

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
| D17 | MCP transport + auth | 🟠 | Remote Streamable HTTP on `kintsugi-app`, PAT auth; OAuth with Entra ID | M2 | 🟡 |
| D18 | Priority member harness + license tier | 🟠 | Copilot first, Claude Code second | M2 | ⬜ |
| D19 | Asset distribution to harnesses | 🟠 | Canonical Claude Code plugin assets are rendered into tested target packages; marketplaces are generated in the document repo and fallback rendering serves harnesses without plugin support | M2 | ✅ [0015](0015-member-assets-as-agent-plugins.md), [0055](0055-portable-agent-plugin-layouts.md) |
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
| D43 | Member asset packaging | 🟠 | Claude Code plugin format (skills, agents, commands, hooks, MCP, `userConfig`); built-in `kintsugi` plugin with MCP + guardrail/telemetry hooks; project plugins in the document repo's `plugins/` | M2 | ✅ [0015](0015-member-assets-as-agent-plugins.md), [0028](0028-remove-rulebook-single-document-repo.md) |
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
| D54 | Kintsugi plugins | 🟢 | Built-in reverse_engineering, design and modernize method plugins; separate hookless access connector plugin and constrained review plugin; project plugins in the document repo; generated marketplace | M1 | ✅ [0035](0035-kintsugi-plugins-marketplace.md), amended by [0052](0052-coding-agent-workflow-through-cli-and-local-mcp.md) |
| D55 | Document repository layout | 🔴 | One repo per project; root for project-wide material, `applications/<app>/` for application content and one full-id unit directory for P1–P4 evidence; generated aggregates, rule-review separation, stable citation-derived rule ids, requirement/rule/PR/test traceability and merged gate records | M1 | ✅ [0038](0038-document-repo-layout-by-subject-and-sdlc-phase.md) |
| D57 | Order of understanding | 🟢 | A `plan-understand` stage: a script computes the item graph from topology and catalog, a `legacy-analyst` job proposes batches with reasons, a script checks and measures them; `plan.md` is auto-committed advice, read by the portal with a staleness flag | M1 | ✅ [0041](0041-ai-plan-for-understanding-order.md) |
| D58 | Document repository format and contexts | 🟢 | The document repo holds Markdown only (front matter, tables, cards); the JSON a run passes between steps is scratch outside the layout; summaries instead of per-file and per-edge detail; bounded contexts (Assessment, Understanding, Modernization, Verification, Governance) around the Unit aggregate whose root is `unit.md`; verification evidence stays JSON until its own decision | M1 | ✅ [0042](0042-markdown-only-document-repo-by-bounded-context.md) |
| D59 | Rebuild only | 🟢 | Every application is rebuilt: no per-application strategy (`disposition`), one pipeline (a project may declare its own), the scorecard maps to a rebuild priority and the assessment states a rebuild outlook | M1 | ✅ [0043](0043-rebuild-only.md) |
| D60 | Design phase | 🟢 | After understanding: common design and skeleton (foundation team), basic design per unit (all units, P2), detail design per unit (in its wave), then implementation with unit tests; members write, the runtime plans and reviews; traceability runs rule → requirement → design item → code → test; `modernize` is reorganized around it | M1 | ✅ [0044](0044-design-phase-common-basic-detail.md) |
| D61 | Design templates | 🟢 | A project defines design sets under `standards/design/` (a `set.md` plus template files whose front matter declares sections and declarative checks); the same definition scaffolds, instructs the agent, validates, serves as review rubric and drives the portal; versioned, staleness derived | M1 | ✅ [0045](0045-design-templates-are-project-data.md) |
| D62 | Business rules as files | 🟢 | A unit's `rules.md` and the application's `BUSINESS_RULES.md` are indexes (id, name, category, priority, confidence, version, status, source, link); each rule is a file `understanding/rules/<id>.md` with its specification, evidence and version history; versions follow a content digest, a vanished rule becomes a `retired` file | M1 | ✅ [0046](0046-one-file-per-business-rule.md) |
| D63 | Kernel extensions | 🟢 | `codemode` is a kernel tool (on for agents without a tool list; scripts call only read tools and read-only MCP tools, with a deadline and output cap); MCP servers are administrator-registered, HTTP only, opt-in per agent by name in `tools`; only tools the server marks read-only or the administrator allowed by name run; the job child may start processes and workers (OS account is the boundary) | M1 | ✅ [0047](0047-kernel-extensions-codemode-and-http-mcp.md) |
| D64 | Runtime telemetry and prompt cache | 🟢 | Spans on the pi-telemetry contract built by the kernel from session events, stored in `monitoring.telemetry_span` and shown in Governance → Telemetry; usage includes cache tokens and compaction cost; compaction thresholds scale with the context window; cache-friendly prompt order and stable session id; cache lifetime is a provider setting | M1 | ✅ [0048](0048-runtime-telemetry-compaction-and-prompt-cache.md) |
| D65 | Design generation | 🟢 | Basic and detail design (every design set the project defines) are generated by the runtime `design` stage from the Design page: one set × many units per run, one pull request, designer job per unit, the template's checks and one fix pass, never overwriting an existing design; common design, scaffold and implementation stay with members; the `design` runtime plugin carries the command, the `designer` agent and the design-set scripts | M1 | ✅ [0049](0049-design-sets-generated-by-the-runtime.md) |
| D66 | Dynamic design sets | 🟢 | A set has a `scope` (`unit`, the default, or `application`: one design for the whole application under `applications/<app>/design/<set>/`, generated for the pseudo-unit `@app`), `reads` (extra documents for the designer) and a `## Instructions` section; a unit set may need an application set, whose items resolve for it; the portal shows what a set is for, writes, needs and reads before generating | M1 | ✅ [0050](0050-design-sets-scope-and-instructions.md) |
| D67 | Readable document repo layout | 🟢 | Numbered roots (`00-project`, `01-standards`, `02-architecture`, `03-transition`, `10-applications`, `plugins`); each application split into `01-legacy/` (assessment and per-unit understanding) and `02-modern/` (requirements, design, per-unit card `README.md` and task pack) on the same `<module>/<unit>` paths; `_`-prefixed application-level folders; no gate records in the repo (the governance module holds them); `00-project/glossary.md`; no old path kept | M1 | ✅ [0051](0051-document-repo-layout-legacy-and-modern.md) |
| D68 | Coding Agent Workflow connection | 🟠 | The Kintsugi CLI prepares local client assets or a Codex personal marketplace package; Codex Desktop completes UI installation, and the client runs a local stdio MCP bridge against the same read-only HTTPS context contract with current Project Access | M2 | ✅ [0052](0052-coding-agent-workflow-through-cli-and-local-mcp.md), [0057](0057-codex-desktop-plugin-installation.md) |
| D69 | Task context and Project Access | 🟠 | Read validated Git task sources with activity-specific readiness; pin each contextual response to an authorized immutable multi-repository snapshot with citations | M2 | ✅ [0053](0053-coding-agent-context-and-project-access.md) |
| D70 | PR continuation and effective gates | 🟠 | Reconcile current GitHub PR state; review fixed revisions; publish authenticated, evidence-bound gate decisions as reviewed Git records; continue exactly once after merged proof is validated | M2 | ✅ [0054](0054-evidence-bound-pr-continuation.md) |
| D71 | Portable plugin package layout | 🟠 | Claude uses its native `.claude-plugin` manifest; Codex and Copilot use portable root `plugin.json` and `mcp.json`; add client-specific compatibility metadata only when required and tested | M2 | ✅ [0055](0055-portable-agent-plugin-layouts.md) |
| D72 | Coding Agent Workflow authentication | 🟠 | Local stdio clients use project-scoped browser auth-code + PKCE; five-minute access, rotating refresh, 15/30-day admin connection-age cap and admin revocation; legacy tokens keep original expiry and Kintsugi issues no GitHub credentials | M2 | ✅ [0056](0056-project-scoped-oauth-for-coding-agent-workflow.md) |
| D56 | Container build and deployment | 🔴 | GitHub Actions builds SHA-tagged app/worker images, publishes them to configurable GHCR by default, and deploys the Compose stack over pinned-host-key SSH | M0 | ✅ [0039](0039-github-actions-ghcr-deployment.md) |
| D49 | Worker liveness | 🟠 | Each worker upserts `workflow.worker_heartbeat` every 15 s and marks itself stopped on shutdown; up = seen < 45 s ago (database clock); no HTTP probe, no pg-boss internals | M0 | ✅ [0030](0030-worker-heartbeat-in-postgres.md) |
| D33 | Minimum host requirements | 🟢 | Linux, Docker 24+ (26+ for volume subpaths), Compose v2, 4 vCPU / 16 GB / 100 GB | M0 | 🟡 |

## Notes on open points

### D29 — Document repo (formerly workspace repo)
| Question | Proposal |
|---|---|
| Dedicated document repo, or a `kintsugi/` folder in an existing repo? | A dedicated repo (access and history separate from code) |
| Do runtime results reach Git through PRs or direct commits? | PRs by default; direct commits for auto-commit paths. Current defaults: `applications/*/units/**/unit.md`, `applications/*/units/**/task.md`, `applications/*/generated/**`, `applications/*/understanding/plan.md` (ADR-0038, ADR-0042) |
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
