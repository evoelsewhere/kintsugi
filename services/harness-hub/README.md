# services/harness-hub

Status: the local stdio MCP adapter, the generated connector plugin and the CLI setup tooling are implemented in the unreleased workspace. Native setup is enabled only for the exact Claude Code and Codex CLI versions in the [compatibility evidence](../../docs/reference/member-client-compatibility.md); authenticated native MCP calls remain a release gate.

Harness Hub adapts the common member contract (`MemberPort` in `packages/harness-sdk`) to member-harness protocols ([ADR-0069](../../docs/decisions/0069-common-member-base-and-plugin-distribution.md)). The local MCP server is started by the CLI and calls the same typed HTTPS API as the CLI commands. It has no network listener and contains no Project Access or authorization rules.

| Capability | Responsibility |
|---|---|
| Local stdio MCP adapter | Registers the read-only tools `project_list`, `document_tree` and `document_get` over `MemberPort`; errors become safe MCP tool errors. |
| Connector plugin generation | Generates the client-specific MCP configuration (no skill, no hooks) for Claude Code, Codex and Copilot, and the setup plan that installs it with the client's native plugin command; prints rollback commands if setup fails partway through. |
| Plugin and activity contracts | `packages/harness-sdk` holds the plugin, marketplace, policy and activity types that plugin distribution and per-member monitoring will use. |

Run `kintsugi mcp serve --profile work` from the installed CLI. On first use an empty profile opens browser sign-in and project consent. The process keeps short-lived access credentials in memory and reads the rotating refresh credential from the OS credential store, so server-side revocation takes effect on the next call. Stdin and stdout carry only MCP messages; diagnostics go to stderr. The bridge is read-only: it cannot change a project, a document or a repository.

See the [member CLI reference](../../docs/reference/member-cli.md).
