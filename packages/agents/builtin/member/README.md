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
| `../skills/mermaid-diagrams` (shared with runtime agents) and `../scripts/mermaid_lint.py` | `skills/mermaid-diagrams/` with the lint as `scripts/mermaid_lint.py`: how every Kintsugi diagram is drawn and checked |
| `hooks.json` | `hooks/hooks.json`: calls the `kintsugi` CLI (session context, write guard on legacy repos, activity reporting) |
| `plugin.json` | `.claude-plugin/plugin.json`: the manifest, with `userConfig` for the installation URL and a sensitive PAT (the version is set to Kintsugi's) |
| `mcp.json` | `.mcp.json`: the Kintsugi MCP server, authenticated with the PAT |

Hooks are assistive; gates and server-side checks stay authoritative.
