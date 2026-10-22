# Harness integration

How Kintsugi connects to members' harnesses (Claude Code, GitHub Copilot, ChatGPT/Codex, …). Implemented by `services/harness-hub`. Contracts are in [`packages/harness-sdk`](../../packages/harness-sdk/src/index.ts).

Everything Kintsugi gives to a harness is packaged as an **agent plugin** in the Claude Code plugin format and distributed through a **marketplace** generated in the project's document repo ([ADR-0015](../decisions/0015-member-assets-as-agent-plugins.md)).

## 1. Plugins

### 1.1 Format

```
<plugin>/
  .claude-plugin/plugin.json   # manifest: name (kebab-case), version, description, author, dependencies, userConfig
  skills/<name>/SKILL.md       # Agent Skills
  agents/*.md                  # subagents
  commands/*.md                # slash commands (skills are preferred for new content)
  hooks/hooks.json             # lifecycle hooks: SessionStart, PreToolUse, PostToolUse, Stop, …
  .mcp.json                    # MCP servers
  scripts/  bin/               # files the hooks call (${CLAUDE_PLUGIN_ROOT})
```

**Authoring rules:**
- **Names**: component names are namespaced `<plugin>:<name>` (e.g. `kintsugi:kintsugi-task`). Project plugins are named `<project-id>-<topic>`, and reserved prefixes (`claude-`, `anthropic-`, …) are rejected.
- **Paths**: every path in a manifest starts with `./` and stays inside the plugin root.
- **Validation**: Kintsugi validates plugins on every change to the document repo's `plugins/` with the same rules as `claude plugin validate`.

### 1.2 Built-in plugin `kintsugi`

Sources: [`packages/agents/builtin/member/`](../../packages/agents/builtin/member/) (skills, hooks) plus the member agents and commands of the built-in content. It is versioned with Kintsugi and generated into each document repo as `plugins/kintsugi/` (never edited by hand).

| Component | Content |
|---|---|
| `userConfig` | `kintsugi_url` and `kintsugi_token` (sensitive, stored in the harness's secure storage) |
| `.mcp.json` | The Kintsugi MCP server (§2), authenticated with the PAT |
| `skills/kintsugi-task` | How to work a task pack: cited standards, read-only legacy repos, trailers, PRs, registration |
| `skills/reverse-design` | Stack-agnostic reverse-design method |
| `hooks/hooks.json` | Calls the `kintsugi` CLI (see below) |

| Hook | Event | Effect |
|---|---|---|
| `kintsugi hook session-start` | `SessionStart` | Adds the active task pack and its cited standards to the session context |
| `kintsugi hook guard-write` | `PreToolUse` (`Write\|Edit`) | Refuses writes to paths in source (legacy) repos |
| `kintsugi hook activity` | `PostToolUse` (`Write\|Edit`) | Reports activity (`plugin-hook` source) for AI metrics |
| `kintsugi hook session-end` | `Stop` | Closes the activity record |

### 1.3 Project plugins

Project plugins live in the document repo at `plugins/<plugin>/` ([document repository](document-repo.md)). They hold stack-specific skills, reviewer agents, commands, and hooks such as running the target formatter. Every valid plugin is published to the project marketplace; there is no maturity gate.

### 1.4 Marketplaces

After every change to `plugins/`, the worker auto-commits the generated files below to the document repo. All plugin sources are **relative paths** under `plugins/`: the generated built-in plugin and the project plugins. This works on any Git server.

| File | Read by |
|---|---|
| `.claude-plugin/marketplace.json` | Claude Code, GitHub Copilot CLI |
| `.github/plugin/marketplace.json` | GitHub Copilot CLI |
| `.agents/plugins/marketplace.json` + `.codex-plugin/plugin.json` per plugin (converted) | Codex |

**Install.** Members add the document repo as a marketplace once, then install the plugins:
- **Claude Code**: `/plugin marketplace add <document-repo-url>` then `/plugin install kintsugi@<project>`.
- **Copilot CLI**: `copilot plugin marketplace add <document-repo-url>`.
- **Codex**: through its repo marketplace.
- **All harnesses**: `kintsugi plugins setup --harness <id>` runs these commands.

**Claude Code shortcut.** Kintsugi can also write `extraKnownMarketplaces` and `enabledPlugins` into the target repo's `.claude/settings.json`, so Claude Code offers the plugins when the repo is opened.

### 1.5 Harness support

| Harness | Plugins | Hooks | Notes |
|---|---|---|---|
| Claude Code | Native | Full | Reference format |
| GitHub Copilot CLI | Native | Full | No `git-subdir` sources; Kintsugi uses relative paths only |
| Codex | Converted manifest | Command hooks only | Kintsugi generates `.codex-plugin/plugin.json` |
| Harnesses without plugin support (ChatGPT chat, some IDE extensions, Cursor, …) | Fallback renderer | None | §1.6 |

> Vendor formats change quickly, especially for Copilot and Codex. Re-verify them when implementing each generator, and cover each one with snapshot tests.

### 1.6 Fallback renderers

For harnesses without plugin support, declarative renderer configs (built-in, Admin → Harnesses, or declared in `kintsugi.yaml`) flatten the published plugins into native paths:

| Plugin component | Typical fallback target |
|---|---|
| `skills/*/SKILL.md` | `.claude/skills/`, `.github/skills/`, `.agents/skills/`, `.cursor/rules/`, project instructions |
| Project context | `AGENTS.md`, `.github/copilot-instructions.md`, project instructions |
| `agents/*.md` | `.github/agents/*.agent.md`, custom GPT |
| `.mcp.json` | `.vscode/mcp.json`, `.cursor/mcp.json`, connector |
| `hooks/` | Not rendered: server-side gates cover the gap |

**Transformers**: `copy`, `agent-skill`, `markdown`, `markdown-frontmatter`, `json-mcp`, `toml-mcp`, plus plugins installed by admins.

## 2. Kintsugi MCP server

The built-in plugin bundles this server.
- **Transport**: remote Streamable HTTP on `kintsugi-app`.
- **Authentication**: `Authorization: Bearer <PAT>`. OAuth will be added once Entra ID is enabled (D17).

| Tool | Description |
|---|---|
| `kb.search` | Semantic search over the project's AS-IS / TO-BE KB |
| `kb.ask` | Question answered by the `kb-assistant` runtime agent, with citations |
| `task.next` | Next unit assigned to the caller |
| `task.get` | Task pack and unit details |
| `task.update` | Change unit status / notes; validated by the API and committed to the unit file by `kintsugi-bot` (ADR-0012) |
| `artifact.register` | Register a deliverable already committed to Git: `repo@commit:path`, type, harness, AI share |
| `gate.status` | Gate status for a unit / PR |
| `guideline.get` | Project guidelines and rules |

## 3. `kintsugi` CLI

| Command | Description |
|---|---|
| `kintsugi login` | Store a PAT for an installation |
| `kintsugi plugins setup [--harness <id>]` | Add the project marketplace and install the plugins with the harness's own commands; run the fallback renderer for harnesses without plugin support |
| `kintsugi task start <id>` | Claim the unit (assignee, harness, `in-progress`), create a branch in the target repo, and fetch the task pack from the document repo |
| `kintsugi task status <id> <status>` | Update unit status |
| `kintsugi artifact register <path> --type <type>` | Register a committed deliverable |
| `kintsugi kb ask "<question>"` | Ask the KB |
| `kintsugi hook <event>` | Entry point for the built-in plugin's hooks (reads the hook JSON on stdin) |

## 4. Task pack

The `task-planner` runtime agent produces a task pack for each unit and commits it to `tasks/<unit-id>.md` in the document repo.
- Template: `task-pack.template.md`, shipped with the `task-planner` agent.
- Type: `TaskPack`.

| Field | Description |
|---|---|
| `objective` | What the unit must achieve |
| `acceptanceCriteria` | Checklist the gate verifies |
| `context` | AS-IS excerpts with sources (from the KB) |
| `relevantPaths` | Files in the source and target repos to start from |
| `suggestedSkills` | Plugin skills to use, namespaced `<plugin>:<skill>` |
| `deliverables` | Type, description, target repo (`document` / `target`) and path |
| `documentRepoCommit` | Document repo commit the task pack was generated against |
| `standards` | The standards (paths under `01-standards/`) that apply to the unit |

## 5. Harness policy

`HarnessPolicy` fields:

| Field | Description |
|---|---|
| `allowedModels` | Models a harness may use for the project |
| `allowedMcpServers` | MCP servers allowed (always includes Kintsugi's) |
| `contentExclusions` | Glob patterns the harness must not read or send |
| `requireCommitTrailer` | Require `Assisted-by: <harness>` on AI-assisted commits |
| `requiredPlugins` | Plugins members must have enabled (always includes `kintsugi`) |

## 6. Telemetry sources

All sources are normalized into `HarnessActivity`.

| Source | Data | Notes |
|---|---|---|
| Kintsugi MCP / CLI | KB usage, task updates, artifact registrations | Always available; the most complete |
| Built-in plugin hooks | Sessions, writes, blocked writes, active plugin versions | Where hooks are supported and enabled; best-effort |
| OpenTelemetry from Claude Code / Codex | Sessions, tokens, tool usage | Optional; enabled via managed config; sent to the OTLP endpoint of `kintsugi-app` |
| GitHub Copilot metrics API | Aggregated usage per org / team | No per-session detail |
| ChatGPT Enterprise compliance / analytics | Aggregated usage | Depends on the plan |
| Git / PRs | `Assisted-by` trailers, PR template AI-usage section, labels | Mandatory convention, checked by gates |

## 7. Conventions for members

- **Commit trailer**: `Assisted-by: <claude-code | copilot | codex | chatgpt | …>` on AI-assisted commits.
- **PR description**: reference the unit id and fill in the AI-usage section of the PR template.
- **Plugins**: keep the `kintsugi` plugin enabled. Hooks are assistive; gates stay authoritative.
