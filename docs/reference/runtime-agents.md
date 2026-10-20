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
| `workspace.readOnly` | Directories the agent may read; the first one is its working directory |
| `workspace.outDir` | The only directory the agent may write to |
| `limits` | `timeoutSec` (required), `maxTurns`, `maxCostUsd` |
| `metadata` | Opaque correlation data (e.g. project id, trigger), echoed on `job.started`; never shown to the agent |

Higher layers (orchestrator) translate their concepts (projects, units, standards) into these fields. The kernel refuses a job before it starts if the agent id, instructions or task is empty, a tool is unknown, a skill name is invalid or duplicated, a deny pattern is not a valid regular expression, a workspace directory is missing, or a limit is invalid.

## Agent definition

| Field | Description |
|---|---|
| `id`, `version` | Identify the agent; model bindings name agents by `id` |
| `instructions` | The system prompt, used verbatim |
| `skills` | Optional inline skills `{ name, content }` (`name` matches `[a-z][a-z0-9-]*`), appended to the system prompt |
| `tools` | Optional tool allowlist by name (kernel tools below). Absent = every kernel tool (the built-in agents list none); `[]` = no tools |
| `denyCommandPatterns` | Optional regular expressions; a tool call whose `command` input matches is blocked before it runs |
| `thinking` | Default thinking level |

## Kernel tools

Only tools in the agent's allowlist are created; pi registers nothing else.

| Tool | Access | Description |
|---|---|---|
| `read`, `ls`, `grep`, `find` | Read, confined to `workspace.readOnly` | File tools on the read-only sources (symlinks resolved); `grep` searches in-process, no `ripgrep` needed |
| `write`, `edit` | Write, confined to `workspace.outDir` | pi's own tools: create or overwrite an output file, or change one by exact text replacement. A relative path starts at `workspace.outDir`; the read-only roots stay out of reach. The caller decides what happens to the files (the worker commits outputs, [ADR-0019](../decisions/0019-workspace-repo-write-path.md)) |

Further tools (for example knowledge-base search) are added to the kernel tool registry by code, with a review of their security boundary.

## Session lockdown

- No discovery from the checkout or the host: no context files, `.pi/` resources, settings files, packages, `SYSTEM.md`, MCP, codemode or tool search.
- Provider, models and credentials are registered in memory, never written to disk.
- Path confinement and the tool allowlist are the agent's isolation inside the job workspace; there is no OS sandbox ([security](../architecture/concepts/security.md)).

## Events

| Event | Content |
|---|---|
| `job.started` | Runtime version, agent id, `metadata` |
| `message.delta` | Streamed assistant text |
| `tool.call` | Tool, input, `allowed` / `blocked` (with reason) |
| `tool.result` | Success flag, summary |
| `output` | Path of a file written to `outDir` |
| `usage` | Model, input/output tokens, cost |
| `job.completed` | Summary |
| `job.failed` | `reason` and error message |

`job.failed` reasons: `error` (LLM or kernel error, empty response, output token limit), `timeout` (`timeoutSec` exceeded), `max-turns`, `budget` (`maxCostUsd` exceeded), `aborted`. LLM errors, aborts, timeouts and exceeded limits never end as `job.completed`.

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
