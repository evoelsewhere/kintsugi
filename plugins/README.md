# plugins/

Built-in agent plugins for members' harnesses, in the **Claude Code plugin format** (ADR-0015): `.claude-plugin/plugin.json`, `skills/`, `agents/`, `commands/`, `hooks/hooks.json`, `.mcp.json`.

- `kintsugi/`: the built-in, stack-agnostic plugin (task workflow, reverse design, Kintsugi MCP server, hooks).

Stack-specific plugins do not belong here. They live in each project's rulebook (`rulebook/packs/<pack>/plugins/<plugin>/`).

How plugins reach members:
1. For each project, Kintsugi vendors the built-in plugin into the workspace repo.
2. It generates marketplace files there (`.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`).
3. Members install from that marketplace with their harness's plugin commands.

The `marketplace.json` in this repo's `.claude-plugin/` lists the built-in plugin for local testing.
