# Member client capabilities: Claude Code, Codex, GitHub Copilot

Status: researched 2026-10-24 from the vendors' documentation and from the clients themselves (Claude Code 2.1.260, Codex CLI 0.148.0-alpha.9 as bundled with the Codex desktop app, GitHub Copilot CLI 1.0.63), each run in a disposable configuration folder (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `COPILOT_HOME`). "Observed" means seen on those versions; "documented" means stated by the vendor and not run. It complements the [compatibility evidence](member-client-compatibility.md), which records the package lifecycle only, and feeds [ADR-0072](../decisions/0072-init-install-and-plugins-as-plugins.md).

What Kintsugi needs from a member client: (1) a way to install a package without the member editing files, (2) the connector's local MCP server, (3) skills and, where possible, commands the member runs by name, (4) one hook that reports what a command used, and (5) a transcript the hook can read for tokens and time.

## Summary

| | Claude Code | Codex CLI | GitHub Copilot CLI |
|---|---|---|---|
| Install commands | `plugin marketplace add`, `plugin install`, `plugin update`, `plugin uninstall`, with `--scope user\|project\|local` | `plugin marketplace add`, `plugin add PLUGIN@MARKET`, `plugin remove`, `plugin list [--json] [--available]`, `plugin marketplace upgrade` (Git sources); no scope, no `update` | `plugin marketplace add`, `plugin install PLUGIN@MARKET`, `plugin update NAME\|--all`, `plugin uninstall`, `plugin list`; no scope (the flag was removed) |
| Manifest | `.claude-plugin/plugin.json` | `.codex-plugin/plugin.json` (OpenAI's own plugins) or root `plugin.json` (Agent Plugins); observed to install both | Agent Plugins `plugin.json` at the root, or a legacy manifest looked up in `.plugin/`, root, `.github/plugin/`, `.claude-plugin/` |
| Marketplace file | `.claude-plugin/marketplace.json` | `.agents/plugins/marketplace.json` (also `.claude-plugin/`) | `marketplace.json`, `.plugin/`, `.github/plugin/`, `.claude-plugin/` |
| Skills | `skills/<name>/SKILL.md`, run as `/plugin:skill` | `skills/<name>/SKILL.md`; run with `$` or `/skills`; a plugin namespace exists in the binary, its form is unverified | `skills/<name>/SKILL.md`; **observed in the bundle: a user-invocable plugin skill is the slash command `/<plugin>:<skill>`** |
| Commands | `commands/*.md`, `/plugin:command` | none; custom prompts are deprecated in favour of skills | `commands/` loaded as skills (`isCommand`); Agent Plugins 1.0 puts them under `com.github.copilot/commands/` |
| Agents | `agents/*.md` | not a plugin component | `agents/*.agent.md` (legacy) or `com.github.copilot/agents/` |
| MCP server in a plugin | `.mcp.json` | `mcp.json` | `mcp.json` (stdio, streamable HTTP, SSE); `${PLUGIN_ROOT}` expands |
| Hooks in a plugin | `hooks/hooks.json`, and **front matter of a command, agent or skill** | `hooks/hooks.json` or a manifest `hooks` entry; **must be trusted once** (`/hooks`, tied to the hook's hash) | `hooks.json` or `hooks/hooks.json` (observed in the bundle); custom-agent front matter hooks; **no per-command scope** |
| Hook events useful here | `Stop` | `Stop`, `SessionEnd`, `UserPromptSubmit` | `agentStop`, `sessionEnd`, `userPromptSubmitted` |
| Hook stdin | `session_id`, `transcript_path` | `session_id`, `transcript_path` (may be null), `cwd`, `model`, `turn_id` | `sessionId`, `transcriptPath` (agentStop, subagentStop, preCompact), `cwd`; camelCase for camelCase event names, snake_case for PascalCase names |
| Transcript | JSONL, `message.usage` per model message | JSONL rollout `~/.codex/sessions/Y/M/D/rollout-*.jsonl`; `event_msg/token_count` with cumulative `total_token_usage` | JSONL `~/.copilot/session-state/<id>/events.jsonl` |
| Tokens in the transcript | input, output, cache read, cache creation, per message | `input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`, `reasoning_output_tokens`, `total_tokens`, cumulative (`last_token_usage` is the last call) | per message only `outputTokens`; input, cache and credits only in `session.shutdown` (`tokenDetails`, `totalNanoAiu`) and `subagent.completed.totalTokens` |
| Install location | `CLAUDE_CONFIG_DIR` (default `~/.claude`) | `CODEX_HOME` (default `~/.codex`), cache `plugins/cache/<market>/<plugin>/<version>/` | `COPILOT_HOME` (default `~/.copilot`), `installed-plugins/<market>/<plugin>/` |
| Per-workspace install | yes (`--scope project\|local`) | no for the plugin; enabling per project is `[plugins."p@m"] enabled` in a trusted project's `.codex/config.toml` | no |

## Codex

Observed on 0.148.0-alpha.9 with a generated package in a disposable `CODEX_HOME`:

- `codex plugin marketplace add <dir>` and `codex plugin add <plugin>@<marketplace> --json` work. The connector (root `plugin.json` with the Agent Plugins `$schema`, `mcp.json`, brand assets) and a member plugin with only skills both install, and `skills/` is copied for the root `plugin.json`, with or without a `"skills"` field, and for `.codex-plugin/plugin.json`.
- **`codex --no-daemon plugin …` is refused** (`error: unexpected argument '--no-daemon'`). Kintsugi's native commands for Codex pass that flag because it was accepted by the probed 0.163.0-alpha.10.2; a 0.148 client, which is what the desktop app ships today, cannot be set up by `kintsugi init`.
- There is no `plugin update`: a new version is a new cache folder, so an update is `plugin add` again after the marketplace folder holds the new version, and a version that does not change is not refreshed.
- Plugin state is `[plugins."name@market"] enabled = true` in `config.toml`; plugin MCP servers are controlled by `[plugins."name".mcp_servers.<server>]`.
- A plugin can bundle hooks (`hooks/hooks.json`, `PLUGIN_ROOT`, `PLUGIN_DATA` and the Claude-compatible `CLAUDE_PLUGIN_ROOT` are set). A hook that is new or changed is skipped until the member reviews it in `/hooks`; trust is stored per hook hash in `config.toml`. Plugin hooks are documented as unsupported in cloud-run ChatGPT Work. Hook handlers: `command` and `mcp_tool`.
- A hook cannot be scoped to one skill: it fires on every `Stop` in every session where the plugin is enabled. A reporting hook must therefore find the plugin's command in the transcript itself and stay silent otherwise.
- The rollout has `session_meta`, `turn_context`, `event_msg` (`task_started`, `user_message`, `agent_message`, `token_count`, `task_complete` with `duration_ms`), and `response_item`. `token_count` carries cumulative totals, so a command's usage is the difference between the last `token_count` before its invocation and the last one after it.
- Not verified: how a plugin skill is named when invoked (`plugin_namespace.rs` exists in the binary, the vendor pages do not give the form), and what the invocation looks like in `user_message`.

## GitHub Copilot CLI

Observed on 1.0.63 with a generated package in a disposable `COPILOT_HOME`:

- `copilot plugin marketplace add <dir>` and `copilot plugin install <plugin>@<marketplace>` work for the connector as Kintsugi generates it (Agent Plugins `plugin.json` plus `mcp.json`) and for a member plugin in both layouts (Agent Plugins at the root, and a Claude-style `.claude-plugin/plugin.json` with `commands`, `agents`, `skills`, `hooks/hooks.json`). The install message counts only skills ("Installed 1 skill"); whether commands and agents load was not observable without signing in.
- The client is the only one of the three with `plugin update NAME|--all`; there is no `enable`/`disable` and no `--scope`.
- In the bundle: a user-invocable skill from a plugin is run as `/<plugin>:<skill>`; plugin hooks are read from `hooks.json` or `hooks/hooks.json`; `.claude-plugin/plugin.json` is one of the manifest locations; a plugin skill never overrides a project or personal skill of the same name.
- Hooks are JSON (`"version": 1`, events keyed by name, `bash`/`powershell`/`command`/`exec`, `timeoutSec` default 30). `agentStop` receives `transcriptPath`; other non-zero exit codes are logged and ignored. Hooks in a plugin are plugin-wide; only a custom agent's front matter scopes a hook, and only while that agent is selected.
- `events.jsonl` has `session.start`, `user.message` (`data.content` holds what the member typed, for example `/modernize:build …`), `assistant.message` (`outputTokens` only), `assistant.turn_start|end`, `tool.execution_*`, `subagent.*`, and `session.shutdown` with `tokenDetails` (input, cache read, cache write, output), `totalPremiumRequests`, `totalNanoAiu` (one credit is 10^10 nano-credits) and per-model `modelMetrics`. Shutdown totals are cumulative and a resumed session writes another snapshot, so they are differenced. A session that ends without a shutdown has no totals.
- `copilot -p "/skills list"` needs a sign-in (`COPILOT_GITHUB_TOKEN`, `GH_TOKEN` or `/login`), so the slash commands of an installed plugin could not be listed without the member's credentials; the claim above that commands load is from the documentation.

## What Kintsugi does with it

Implemented in [ADR-0072](../decisions/0072-init-install-and-plugins-as-plugins.md), and run against the real Codex 0.148 and Copilot 1.0.63 (init, install, repeated install, fetch, init again):

1. **One source, the form each client has.** The command `build` is authored once; Claude Code gets the command, Codex and Copilot the same text as a generated skill (Copilot confirmed: "Installed 3 skills", one of them `build`).
2. **A plugin-wide hook, generated and self-filtering** for Codex and Copilot, with `--harness`; command-scoped front matter for Claude Code.
3. **Each client's token source:** Claude Code per message; Codex `token_count` differences; Copilot output tokens per reply plus sub-agent totals.
4. **`--no-daemon` only for Codex 0.163 and later.**
5. **The version a client sees carries a content hash,** and a refused install leaves no record.
6. **Found while testing:** Copilot refuses `marketplace add` twice; re-running `init` dropped the installed plugins from the package's marketplace; `kintsugi` could not start `claude` installed by npm (`claude.cmd`) on Windows, and joined its arguments into one under Windows PowerShell 5.1.

Still open: the trust step of a Codex hook is the member's (writing it into `config.toml` is not proposed); the namespaced form of a plugin skill in Codex, and whether Copilot runs the generated `agentStop` hook, need a live session; Copilot reports no input tokens per command; per-workspace install exists for Claude Code only.

## Sources

- Codex: [plugins](https://developers.openai.com/plugins/build/plugins), [hooks](https://learn.chatgpt.com/docs/hooks), [skills](https://learn.chatgpt.com/docs/build-skills), [CLI reference](https://learn.chatgpt.com/docs/cli/reference).
- Copilot: [plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference), [creating a plugin](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating), [hooks configuration](https://docs.github.com/en/copilot/reference/hooks-configuration), [skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills), [session usage in `events.jsonl`](https://ccusage.com/guide/copilot/).
- Agent Plugins: <https://agent-plugins.org>.
