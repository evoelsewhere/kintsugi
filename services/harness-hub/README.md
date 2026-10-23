# services/harness-hub

Status: the local stdio MCP adapter, the generated connector plugin and the CLI setup tooling are implemented in the unreleased workspace. Native setup is enabled only for the exact Claude Code and Codex CLI versions in the [compatibility evidence](../../docs/reference/member-client-compatibility.md); authenticated native MCP calls remain a release gate.

Harness Hub adapts the common member contract (`MemberPort` in `packages/harness-sdk`) to member-harness protocols ([ADR-0069](../../docs/decisions/0069-common-member-base-and-plugin-distribution.md)). The local MCP server is started by the CLI and calls the same typed HTTPS API as the CLI commands. It has no network listener and contains no Project Access or authorization rules.

| Capability | Responsibility |
|---|---|
| Local stdio MCP adapter | Registers `project_list`, `document_tree`, `document_get`, `plugin_list` (read-only) and `activity_record` (one bounded monitoring note) over `MemberPort`; errors become safe MCP tool errors. |
| Connector plugin generation | Generates the client-specific MCP configuration (no skill, no hooks) for Claude Code, Codex and Copilot, and the setup plan that installs it with the client's native plugin command; prints rollback commands if setup fails partway through. |
| Member plugin installation | Puts the files of a distributed member plugin into the connector package, records which plugin owns which files (`.kintsugi-plugins.json`) and prunes the files an update or a removal leaves behind. Only skills, agents and commands are accepted; nothing that runs code. |
| Plugin and activity contracts | `packages/harness-sdk` holds the plugin, marketplace, policy and activity types that plugin distribution and per-member monitoring will use. |

Run `kintsugi mcp serve --profile work` from the installed CLI. On first use an empty profile opens browser sign-in and project consent. The process keeps short-lived access credentials in memory and reads the rotating refresh credential from the OS credential store, so server-side revocation takes effect on the next call. Stdin and stdout carry only MCP messages; diagnostics go to stderr. The bridge changes no project, document or repository; its one write is the activity note.

See the [member CLI reference](../../docs/reference/member-cli.md).
