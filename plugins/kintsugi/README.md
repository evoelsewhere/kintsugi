# `kintsugi` plugin (built-in)

Agent plugin in the Claude Code plugin format (ADR-0015). It is versioned with Kintsugi and vendored into each project's workspace repo, so members install it from the project's marketplace.

| Component | Content |
|---|---|
| `.claude-plugin/plugin.json` | Manifest; `userConfig` prompts for the installation URL and a sensitive PAT |
| `.mcp.json` | Kintsugi MCP server: `kb.*`, `task.*`, `artifact.register`, `gate.status`, `guideline.get` |
| `skills/kintsugi-task` | How to work a task pack: rules, repos, trailers, registration |
| `skills/reverse-design` | Stack-agnostic reverse-design method |
| `hooks/hooks.json` | Calls the `kintsugi` CLI, which must be on `PATH` |

The hooks do four things:
- `SessionStart`: load the current task context;
- `PreToolUse` on writes: refuse writes to source repos;
- `PostToolUse` on writes: report activity;
- `Stop`: close the activity record.

Hooks are assistive. Gates and server-side checks stay authoritative. Codex runs only command hooks, and harnesses without plugin support get the fallback rendering, which has no hooks.
