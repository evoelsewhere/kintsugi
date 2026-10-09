# Harness integration

How Kintsugi connects to members' harnesses (Claude Code, GitHub Copilot, ChatGPT/Codex). Implemented by `services/harness-hub`. Contracts are in [`packages/harness-sdk`](../../packages/harness-sdk/src/index.ts).

## Kintsugi MCP server

- **Transport**: remote Streamable HTTP on `kintsugi-app`.
- **Authentication**: `Authorization: Bearer <PAT>`. OAuth will be added once Entra ID is enabled (D17).

| Tool | Description |
|---|---|
| `kb.search` | Semantic search over the project's AS-IS / TO-BE KB |
| `kb.graph` | Entity / dependency graph queries |
| `kb.ask` | Question answered by the `kb-assistant` runtime agent, with citations |
| `task.next` | Next work item assigned to the caller |
| `task.get` | Task pack and work item details |
| `task.update` | Update work item status / notes |
| `artifact.register` | Register a deliverable already committed to Git: `repo@commit:path`, type, harness, AI share |
| `gate.status` | Gate status for a work item / PR |
| `guideline.get` | Project guidelines and rules |

## `kintsugi` CLI

| Command | Description |
|---|---|
| `kintsugi login` | Store a PAT for an installation |
| `kintsugi task start <id>` | Create a branch in the code repo and fetch the task pack from the workspace repo |
| `kintsugi task status <id> <status>` | Update work item status |
| `kintsugi assets pull [--harness <id>]` | Render project skills, instructions and MCP config for the given harness |
| `kintsugi artifact register <path> --type <type>` | Register a committed deliverable |
| `kintsugi kb ask "<question>"` | Ask the KB |

## Task pack

The `task-planner` runtime agent produces a task pack for each work item and commits it to `tasks/<work-item-id>.md` in the workspace repo.
- Template: [`harness/task-packs/TEMPLATE.md`](../../harness/task-packs/TEMPLATE.md).
- Type: `TaskPack`.

| Field | Description |
|---|---|
| `objective` | What the work item must achieve |
| `acceptanceCriteria` | Checklist the gate verifies |
| `context` | AS-IS excerpts with sources (from the KB) |
| `relevantPaths` | Files in the code repo to start from |
| `rules` | Architecture / coding rules checked by `gate-reviewer` |
| `suggestedSkills` | Skills to use |
| `deliverables` | Type, description, target repo (`workspace` / `code`) and path |

## Asset rendering per harness

Canonical assets live in [`harness/`](../../harness/) ([ADR-0005](../decisions/0005-canonical-asset-format.md)).

| Canonical asset | Claude Code | GitHub Copilot | Codex (ChatGPT) | ChatGPT (chat/web) |
|---|---|---|---|---|
| `skills/*/SKILL.md` | `.claude/skills/` | `.github/skills/` or `.github/prompts/*.prompt.md` | `.agents/skills/` | Project instructions or custom GPT |
| Project context | `CLAUDE.md` (imports `AGENTS.md`) | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md` | `AGENTS.md` | Project instructions |
| Role (BA, dev, QC…) | `.claude/agents/*.md` | `.github/agents/*.agent.md` | profile | Custom GPT |
| MCP | `.mcp.json` | `.vscode/mcp.json` / org policy | `~/.codex/config.toml` | Connector (remote MCP) |
| Policy | managed settings | org / enterprise Copilot policies | managed config | Workspace settings (Enterprise) |

> These paths and mechanisms change quickly. Verify them against vendor documentation when implementing each renderer, and cover each with snapshot tests.

## Harness policy

`HarnessPolicy` fields:

| Field | Description |
|---|---|
| `allowedModels` | Models a harness may use for the project |
| `allowedMcpServers` | MCP servers allowed (always includes Kintsugi's) |
| `contentExclusions` | Glob patterns the harness must not read or send |
| `requireCommitTrailer` | Require `Assisted-by: <harness>` on AI-assisted commits |

## Telemetry sources

All sources are normalized into `HarnessActivity`.

| Source | Data | Notes |
|---|---|---|
| Kintsugi MCP / CLI | KB usage, task updates, artifact registrations | Always available; the most complete |
| OpenTelemetry from Claude Code / Codex | Sessions, tokens, tool usage | Optional; enabled via managed config; sent to the OTLP endpoint of `kintsugi-app` |
| GitHub Copilot metrics API | Aggregated usage per org / team | No per-session detail |
| ChatGPT Enterprise compliance / analytics | Aggregated usage | Depends on the plan |
| Git / PRs | `Assisted-by` trailers, PR template AI-usage section, labels | Mandatory convention, checked by gates |

## Conventions for members

- **Commit trailer**: `Assisted-by: <claude-code | copilot | codex | chatgpt>` on AI-assisted commits.
- **PR description**: reference the work item id and fill in the AI-usage section of the PR template.
