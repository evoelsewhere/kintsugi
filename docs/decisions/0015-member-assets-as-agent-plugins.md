# ADR-0015: Member-harness assets are agent plugins (Claude Code plugin format)

- Status: Accepted. Amended by [ADR-0028](0028-remove-rulebook-single-document-repo.md): project plugins live in the document repo's `plugins`, published without a maturity gate. Amended (2026-10-11): the built-in plugin has no source folder of its own; it is assembled from `packages/agents/builtin/member/` and the built-in member agents and commands, and generated into the document repo as `plugins/kintsugi/`. Further amended by [ADR-0060](0060-coding-agent-workflow-through-cli-and-local-mcp.md): the Coding Agent Workflow is a separate hookless local connector. The Codex package manifest layout below is superseded by [ADR-0063](0063-portable-agent-plugin-layouts.md); the canonical Kintsugi source format remains Claude Code.
- Date: 2026-10-09
- Decision register: D19, D40, D43
- Amends: ADR-0005 (canonical asset format), ADR-0013 decision 9 (harness renderers become a fallback)

## Context
Kintsugi distributed loose skills and instructions and re-rendered them per harness. Agent harnesses have since converged on a **plugin** package that bundles skills, agents, commands, hooks and MCP servers, distributed through a **marketplace** file:

| Harness | Plugin support | Marketplace file |
|---|---|---|
| Claude Code | Native. Plugin root with `.claude-plugin/plugin.json`, `skills/`, `agents/`, `commands/`, `hooks/hooks.json`, `.mcp.json`, `bin/`; `userConfig` for prompted values, including sensitive ones | `.claude-plugin/marketplace.json` |
| GitHub Copilot CLI | Same layout (skills, agents, hooks, MCP servers) | `.github/plugin/marketplace.json`; also reads `.claude-plugin/marketplace.json`. `git-subdir` sources are not supported |
| Codex | Similar package with `.codex-plugin/plugin.json`, `skills/`, `.mcp.json` | Repo marketplace at `.agents/plugins/marketplace.json`. Only command hooks are run. A documented conversion path exists from Claude Code plugins |

Hooks also give Kintsugi something loose skills never could, on members' machines:
- inject the current task pack at session start;
- refuse edits to read-only source repos;
- report activity for AI metrics.

## Decision
1. **Canonical format.** Every asset Kintsugi gives to members' harnesses is packaged as a plugin in the **Claude Code plugin format**. The format holds:
   - Agent Skills (`skills/<name>/SKILL.md`);
   - agents (`agents/*.md`);
   - commands;
   - hooks (`hooks/hooks.json`);
   - MCP servers (`.mcp.json`);
   - `userConfig`.

   Loose skill folders are no longer a distribution unit.
2. **Built-in plugin `kintsugi`** (`plugins/kintsugi/` in this repo, versioned with Kintsugi). It contains:
   - stack-agnostic method skills (working a task pack, reverse design, …);
   - the **Kintsugi MCP server**, with `userConfig` for the installation URL and a sensitive PAT;
   - **hooks** that call the `kintsugi` CLI:
     - `SessionStart`: load the task context;
     - `PreToolUse` on writes: refuse paths in source repos;
     - `PostToolUse` on writes: report activity;
     - `Stop`: close the activity record.
3. **Project plugins** live in the rulebook, inside packs (`packs/<pack>/plugins/<plugin>/`). They hold stack-specific skills, agents, commands and hooks. They are referenced by the `convert` capability and follow its maturity: only `ready` plugins are published, or `draft` ones for pilot units.
4. **Distribution through generated marketplaces in the workspace repo.**
   - On every rulebook change, the worker vendors the built-in plugin for the installation's version into `.kintsugi/plugins/kintsugi@<version>/`.
   - It then auto-commits marketplace files listing the built-in plugin plus the publishable project plugins, all as **relative paths**:
     - `.claude-plugin/marketplace.json`, read by Claude Code and Copilot CLI;
     - `.github/plugin/marketplace.json`, for Copilot CLI;
     - `.agents/plugins/marketplace.json` and a generated `.codex-plugin/plugin.json` per plugin, for Codex.
   - Members add the workspace repo as a marketplace once and install from it. Kintsugi can also write `extraKnownMarketplaces` / `enabledPlugins` into the target repo's `.claude/settings.json`, so Claude Code offers the plugins automatically.
   - Sources are relative paths only, which works on any Git server and avoids `git-subdir`.
5. **Fallback renderers** (ADR-0013 decision 9) remain for harnesses without plugin support, e.g. IDE extensions without plugins, ChatGPT chat, Cursor. They flatten plugin skills, agents and MCP into the harness's native paths. Hooks cannot be rendered there.
6. **Hooks are assistive, not authoritative.** Members can disable plugins or hooks, and support differs per harness. Server-side controls stay authoritative:
   - gates;
   - `gate-reviewer`;
   - commit trailers;
   - read-only source repos for the runtime.

   Hook-reported activity is one more telemetry source.
7. **Validation.**
   - Plugins are validated on rulebook change against the plugin manifest rules: name format, reserved names, `./` paths inside the plugin root, existing files, hooks file shape.
   - Project plugin names should be prefixed with the project id, so they do not collide.
   - Unknown manifest fields are reported, mirroring `claude plugin validate`.

## Consequences
- One package works natively in Claude Code and Copilot CLI, and in Codex after an automatic manifest conversion. Members install it with the harness's own plugin commands.
- Guardrails and telemetry reach members' machines (task context, write guard, activity), but they are best-effort.
- Vendor formats differ in details and change quickly: Codex hook coverage, Copilot source types, field sets. Codex and Copilot specifics must be re-verified against vendor docs when the generators are implemented, and covered by tests.
- `kintsugi assets pull` is replaced by plugin installation. The later Coding Agent Workflow amendment in [ADR-0060](0060-coding-agent-workflow-through-cli-and-local-mcp.md) defines a separate generated access package; its CLI setup command is `kintsugi plugins setup --harness <id>` and prints native marketplace/install commands for the developer to run.
