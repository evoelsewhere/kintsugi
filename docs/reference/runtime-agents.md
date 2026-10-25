# Runtime agents and the job contract

The Kintsugi Runtime is a **generic agent kernel** on pi ([ADR-0023](../decisions/0023-runtime-as-generic-agent-kernel.md)). It runs one agent job at a time, each in its job workspace ([ADR-0029](../decisions/0029-job-workspaces-instead-of-os-sandboxes.md)), and knows no agent or use case.

- **An agent is data, supplied whole with each job.** The runner is stateless and never looks an agent up.
- **Agents are installation data** ([ADR-0026](../decisions/0026-runtime-agents-and-agent-builder.md)): five built-in read-only agents for the understanding phases ship with their commands, workflows and scripts in `packages/agents/builtin/` ([ADR-0027](../decisions/0027-builtin-modernization-content.md)); admins copy them or create their own in the [Agent Builder](#agent-builder). The worker resolves the agent name to its current version at job start and embeds the whole definition in the job.
- **No agent configuration in project repos.** Projects control the model each agent id uses (Admin → LLM Providers → agent bindings, [LLM configuration](../architecture/concepts/llm-configuration.md)).
- **How agents read code**: directly, with the kernel's file tools on the read-only workspace. There is no code graph or parser.

Contract types: `JobSpec`, `AgentDefinition`, `JobEvent`, `JobHandle`, `AgentRuntime` in [`packages/runtime-sdk`](../../packages/runtime-sdk/src/index.ts). Implementation: [`services/runtime`](../../services/runtime/README.md).

## Job spec

| Field | Description |
|---|---|
| `agent` | The `AgentDefinition` (below) |
| `task` | The user prompt for this job |
| `model` | `{ provider, id, thinking? }`: `provider` is an LLM provider config id; `thinking` overrides the agent's default |
| `workspace.root` | The job workspace, the agent's working directory: a relative path of a read tool is resolved against it ([job workspace](job-workspace.md)) |
| `workspace.readOnly` | What the agent may read: the first entry is a directory (where a search without a path looks, the as-is code), the others directories or files (the guide `WORKSPACE.md`, which the system prompt tells the agent to read first) |
| `workspace.outDir` | The only directory the agent may write to |
| `limits` | `timeoutSec` (required), `idleTimeoutSec` (stalled-model watchdog; 0 = off), `maxTurns`, `maxCostUsd` |
| `mcp` | `{ servers }`: the MCP servers the agent names in `tools` (`name`, `url`, `headers`, `timeoutSec`, `allowedTools`), resolved by the worker with the headers decrypted; they travel on the job child's stdin only |
| `metadata` | Opaque correlation data (e.g. project id, trigger), echoed on `job.started`; never shown to the agent |

Higher layers (orchestrator) translate their concepts (projects, units, standards) into these fields. The kernel refuses a job before it starts if the agent id, instructions or task is empty, a tool is unknown, a skill name is invalid or duplicated, a deny pattern is not a valid regular expression, a workspace directory is missing, or a limit is invalid.

## Agent definition

| Field | Description |
|---|---|
| `id`, `version` | Identify the agent; model bindings name agents by `id` |
| `instructions` | The system prompt, used verbatim |
| `skills` | Optional inline skills `{ name, content }` (`name` matches `[a-z][a-z0-9-]*`), appended to the system prompt |
| `tools` | Optional tool allowlist by name (kernel tools below). Absent = every kernel tool, `codemode` included and MCP never (the built-in agents list none); `[]` = no tools; `mcp__<server>__*` (or one tool) names an MCP server the agent may use |
| `denyCommandPatterns` | Optional regular expressions; a tool call whose `command` input matches is blocked before it runs |
| `thinking` | Default thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max`. pi accepts a subset per model (the portal offers only those, from the provider catalog); a level the model lacks is clamped to the nearest one it has |

## Kernel tools

Only tools in the agent's allowlist are created; pi registers nothing else.

| Tool | Access | Description |
|---|---|---|
| `read`, `ls`, `grep`, `find` | Read, confined to `workspace.readOnly` | File tools on the read-only sources (symlinks resolved); `grep` searches in-process, no `ripgrep` needed |
| `write`, `edit` | Write, confined to `workspace.outDir` | pi's own tools: create or overwrite an output file, or change one by exact text replacement. A relative path starts at `workspace.outDir`; the read-only roots and the rest of the workspace stay out of reach. The caller decides what happens to the files (the worker commits outputs, [ADR-0019](../decisions/0019-workspace-repo-write-path.md)) |
| `shell`, `git` | Process tools | One `bash -c` or one `git` command per call in the job's cleared environment, with a timeout and kill-tree; results are cut to 2000 lines or 50 KB ([ADR-0040](../decisions/0040-kernel-shell-and-git-tools.md)) |
| `codemode` | Scripts over the read tools | The model writes JavaScript that runs in pi's QuickJS sandbox and prints only what it needs. A script may call only `read`, `ls`, `grep`, `find` and read-only MCP tools, runs at most 120 s and returns at most 8,000 tokens ([ADR-0047](../decisions/0047-kernel-extensions-codemode-and-http-mcp.md)) |
| `mcp__<server>__<tool>` | MCP tools | The tools of an HTTP MCP server an administrator registered (Settings → MCP servers), only for an agent that names the server. A tool runs when its server marks it read-only or the administrator allowed it by name; callable from codemode scripts when the agent has codemode, declared to the model otherwise |

Further tools (for example knowledge-base search) are added to the kernel tool registry by code, with a review of their security boundary.

## Session lockdown

- No discovery from the checkout or the host: no context files, `.pi/` resources, settings files, packages, `SYSTEM.md`, `mcp.json` or tool search. MCP servers come from the JobSpec only (`mcp`, above), over HTTP; codemode and MCP are limited as [ADR-0047](../decisions/0047-kernel-extensions-codemode-and-http-mcp.md) says.
- Provider, models and credentials are registered in memory, never written to disk.
- Path confinement and the tool allowlist are the agent's isolation inside the job workspace; there is no OS sandbox ([security](../architecture/concepts/security.md)).

## Events

| Event | Content |
|---|---|
| `job.started` | Runtime version, agent id, `metadata` |
| `message.delta` | Streamed assistant text |
| `tool.call` | Tool, input, `allowed` / `blocked` (with reason) |
| `tool.result` | Success flag, summary, duration |
| `output` | Path of a file written to `outDir` |
| `usage` | Model, input and output tokens, cost, cache read and write tokens, turns, compactions and the context peak (% of the window); summaries of compactions included. Cache tokens are not part of the input tokens |
| `span` | One settled span of the job ([ADR-0048](../decisions/0048-runtime-telemetry-compaction-and-prompt-cache.md)): `kintsugi.job`, `.turn`, `.tool`, `.codemode`, `.mcp`, `.compaction`, `.retry` with start, duration, status and scalar attributes (counts and names, never content) |
| `job.completed` | Summary |
| `job.failed` | `reason` and error message |

`job.failed` reasons: `error` (LLM or kernel error, empty response, output token limit), `timeout` (`timeoutSec` exceeded), `max-turns`, `budget` (`maxCostUsd` exceeded, compaction summaries included), `context-overflow` (the conversation outgrew the model's window and compacting did not recover it), `aborted`. LLM errors, aborts, timeouts and exceeded limits never end as `job.completed`.

## Agent Builder

Administration → Agents in the portal (`/agents`, an agent at `/agents/<name>`); API module `admin/agents` ([ADR-0026](../decisions/0026-runtime-agents-and-agent-builder.md#implementation-notes)).

- **Catalog**: the built-in agents of the release (read-only, names reserved) plus the installation's custom agents (`admin.agent`, migration `012_agents.sql`). Each has an audience (`runtime` or `member`), a version, a validity (the problems that keep it from running here) and its installation-default model binding.
- **Package format**: the same for the editor, import and export: `<name>.md` (frontmatter `name`, `version`, `description`, `tools`, `skills`, `thinking`, `deny-command-patterns`, `metadata` with `audience`; body = instructions) plus optional `skills/<n>/SKILL.md`. Saving runs the format checks (`parseAgentPackage`) and the installation checks (`validateAgent`: runtime tools must be kernel tools, shared skills must exist); every problem is returned at once (400).
- **Versions**: every save records an immutable version (`admin.agent_version`) and makes it current; a version number is never reused. Restore makes an older version current again.
- **Shared skills**: built-in skills plus custom ones (`admin.agent_skill`), referenced by name from `skills:`. A skill in use cannot be deleted; an edit applies to every agent that uses it at its next job.
- **Resolution**: `resolveAgentDefinition` (`@kintsugi/agents`) turns a name into the job's `AgentDefinition`: a built-in first, else an enabled custom agent. Unknown, disabled, member and invalid agents fail the job with the reason.
- **Access**: reading needs a session; every change needs `agents.manage`; model bindings need `providers.manage`.

| Endpoint | Purpose |
|---|---|
| `GET /api/admin/agents` | Catalog (built-in and custom) |
| `GET /api/admin/agents/context` | Kernel tools, shared skills and reserved names for the editor |
| `GET /api/admin/agents/:name` | Manifest, instructions, local skills, package files, model bindings |
| `POST /api/admin/agents` · `PUT /api/admin/agents/:name` | Create · save as a new version |
| `PATCH /api/admin/agents/:name` · `DELETE /api/admin/agents/:name` | Enable or disable · delete (custom agents only) |
| `POST /api/admin/agents/:name/copy` | Copy a built-in or custom agent under a new name |
| `POST /api/admin/agents/preview` | Validate an unsaved draft and show its job definition (dry run) |
| `GET /api/admin/agents/:name/definition` | The job definition of a saved runtime agent |
| `POST /api/admin/agents/import` · `GET /api/admin/agents/:name/export[?version=]` | Import files or a base64 ZIP · export a ZIP |
| `GET /api/admin/agents/:name/versions[/:version]` · `POST …/versions/:version/restore` | History · restore |
| `GET/POST /api/admin/agent-skills` · `GET/PUT/DELETE /api/admin/agent-skills/:name` | Shared skills |

## Planned agents

The product intends runtime agents for platform work — knowledge ingestion, KB assistant, assessment, wave and task planning, to-be analysis, gate review and insight reporting. None exists yet. When introduced, each is an `AgentDefinition` supplied per job, using kernel tools only.

## Project memory

Project agents can use seven optional memory tools to remember and recall facts, lessons, decisions and navigation, read daily logs, maintain a run scratchpad and recover forgotten notes. Writes are saved immediately as learned; review is a separate trust transition. Independent reviewers read only reviewed notes outside their current run. No memory is injected into the task or retained as a snapshot. The generic runtime calls a worker-bound service, never the database. See [project memory](project-memory.md) for scope, tools, trust, retention and reset behavior.
