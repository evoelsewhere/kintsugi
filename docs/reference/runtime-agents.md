# Runtime agents and the job contract

The Kintsugi Runtime is a **generic agent kernel** on pi ([ADR-0023](../decisions/0023-runtime-as-generic-agent-kernel.md)). It runs one agent job at a time, one sandbox per job ([ADR-0004](../decisions/0004-runner-container-per-job.md)), and knows no agent or use case.

- **An agent is data, supplied whole with each job.** The runner is stateless and never looks an agent up.
- **Agents are installation data** ([ADR-0026](../decisions/0026-runtime-agents-and-agent-builder.md)): five built-in read-only agents for the understanding phases ship with their commands, workflows and scripts in `packages/agents/builtin/` ([ADR-0027](../decisions/0027-builtin-modernization-content.md)) and are seeded at startup; admins fork them or create their own in the Agent Builder. The launcher resolves `id` or `id@version` to a published version at job start and embeds it in the job.
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
| `tools` | Tool allowlist by name (kernel tools below); `[]` = no tools |
| `denyCommandPatterns` | Optional regular expressions; a tool call whose `command` input matches is blocked before it runs |
| `thinking` | Default thinking level |

## Kernel tools

Only tools in the agent's allowlist are created; pi registers nothing else.

| Tool | Access | Description |
|---|---|---|
| `read`, `ls`, `grep`, `find` | Read, confined to `workspace.readOnly` | File tools on the read-only sources (symlinks resolved) |
| `outputs_write` | Write, confined to `workspace.outDir` | Write an output file; the caller decides what happens to it (the worker commits outputs, [ADR-0019](../decisions/0019-workspace-repo-write-path.md)) |

Further tools (for example knowledge-base search) are added to the kernel tool registry by code, with a review of their security boundary.

## Session lockdown

- No discovery from the checkout or the host: no context files, `.pi/` resources, settings files, packages, `SYSTEM.md`, MCP, codemode or tool search.
- Provider, models and credentials are registered in memory, never written to disk.
- Path confinement and the tool allowlist are defence in depth; the isolation boundary is the job sandbox ([security](../architecture/concepts/security.md)).

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

## Planned agents

The product intends runtime agents for platform work — knowledge ingestion, KB assistant, assessment, wave and task planning, to-be analysis, gate review and insight reporting. None exists yet. When introduced, each is an `AgentDefinition` supplied per job, using kernel tools only.
