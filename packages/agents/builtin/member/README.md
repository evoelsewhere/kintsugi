# Member plugin sources

Sources of the built-in `kintsugi` plugin that members install in their harness (Claude Code plugin
format, ADR-0015). Kintsugi does not ship a ready-made plugin folder: the Harness Hub assembles the
plugin from these sources plus the member agents and commands of this package (`metadata.audience:
member` in `../agents/` and `../commands/`), writes it into each project's document repo under
`plugins/kintsugi/` (generated, never edited by hand) and generates the marketplace files there.

| Source | Becomes |
|---|---|
| `skills/kintsugi-task` | How to work a task pack: cited standards, read-only legacy repos, trailers, PRs, registration |
| `skills/reverse-design` | Stack-agnostic reverse-design method |
| `hooks.json` | `hooks/hooks.json`: calls the `kintsugi` CLI (session context, write guard on legacy repos, activity reporting) |

The manifest (`.claude-plugin/plugin.json`, with `userConfig` for the installation URL and a
sensitive PAT) and `.mcp.json` (the Kintsugi MCP server) are generated with the plugin. Hooks are
assistive; gates and server-side checks stay authoritative.
