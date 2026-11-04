# Member client compatibility

Status: updated 2026-10-23. Records local package lifecycle probes of the generated Kintsugi connector plugin; these do not establish a complete authenticated MCP integration or a release support matrix.

## Host baseline

| Component | Observed value | Evidence and limit |
|---|---|---|
| Host OS | Windows x64 | Edition and build were not recorded. Record them in the release matrix. |
| Node.js | 24.21.0 | Local command output. |
| Corepack pnpm | 10.18.0 | Exact MCP server and client 2.3.1 packages resolved and installed; native host interoperability remains unverified. |
| Claude Code | 2.1.278 | In a disposable `CLAUDE_CONFIG_DIR`: strict validation, local marketplace add/list, plugin install/list, uninstall and marketplace removal passed. No live authenticated MCP request was run. |
| Codex CLI | 0.163.0-alpha.10.2 | In a disposable `CODEX_HOME`: local marketplace add/list, plugin add/list, explicit plugin removal and marketplace removal passed. The rollback removes the installed plugin and its versioned cache before removing the source. No live authenticated MCP request was run. |
| Codex CLI (desktop app) | 0.148.0-alpha.9 | In a disposable `CODEX_HOME`: `plugin marketplace add`, `plugin add --json`, `plugin list --json --available` for the connector and for a member plugin with skills and `hooks/hooks.json`; `--no-daemon` is refused. The hook trust step and a live skill run were not exercised. |
| GitHub Copilot CLI | 1.0.63 | In a disposable `COPILOT_HOME`: marketplace add, plugin install, update, list for the connector and for a member plugin with skills, a generated `hooks/hooks.json` and the command as a skill ("Installed 3 skills"). `marketplace add` of a registered marketplace fails (exit 1), so it is refreshed. Slash commands of an installed plugin could not be listed without a sign-in. |

The probes used generated packages and temporary config directories; the developer's normal client settings were not changed. They prove a bounded package lifecycle only, not tool startup, authentication, document retrieval, update compatibility or operating-system-wide support. Repeat them in clean Windows and Linux release environments.

Generated Codex packages carry the Kintsugi mark in light and dark SVG variants as the composer icon and plugin logo; package tests verify that every referenced file is bundled and matches the brand assets. The staged Codex Desktop package has not been visually checked in the plugin browser.

## Pinned boundary dependencies

Versions are one compatible group and stay exact in manifests and lockfiles.

| Boundary | Pinned package | Why | Primary source |
|---|---|---|---|
| CLI | commander 15.0.0 | ESM command parser; upstream declares Node 22.12 or newer | [Commander v15.0.0 release](https://github.com/tj/commander.js/releases/tag/v15.0.0) |
| Local MCP server | @modelcontextprotocol/server 2.3.1 | Split SDK server package with the stdio factory | [TypeScript SDK v2.3.1](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.3.1), [stdio guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md) |
| MCP conformance client | @modelcontextprotocol/client 2.3.1 | Real client process for protocol tests, pinned to the server release | [TypeScript SDK v2.3.1](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.3.1) |
| OS credential access | @napi-rs/keyring 2.0.0 on Windows and macOS; `secret-tool` on Linux | Native Node-API bindings; Linux calls Secret Service directly so no kernel-keyutils fallback can satisfy the command | [Upstream repository](https://github.com/Brooooooklyn/keyring-node), [Secret Tool manual](https://manpages.debian.org/unstable/libsecret-tools/secret-tool.1.en.html) |

The keyring package has no Linux backend selector and can silently fall back to kernel keyutils when Secret Service is missing, so Linux uses `secret-tool` and fails closed. That path is covered by injected command-runner tests and still needs a native Linux desktop test; macOS is unverified.

## Package namespace

The workspace names `@kintsugi/cli` and `@kintsugi/kintsugi-client` are repository identifiers, not a claim of public npm ownership. Check the public namespace before any publication.

## Client support claims

The package lifecycle above was probed with Claude Code 2.1.278 and Codex CLI 0.163.0-alpha.10.2. Setup goes ahead with another version of either client and says so on stderr ([ADR-0072](../decisions/0072-init-install-and-plugins-as-plugins.md)): it uses only the plain plugin commands, and clients update faster than a release can be probed. A client that was never probed is refused. This is not a claim of end-to-end MCP support: that needs plugin-launched stdio startup, authentication, refresh, update and clean removal on exact recorded versions and supported operating systems.

## Features header: new fields without breaking an installed CLI

An installed CLI parses every response of `/api/member/v1` with a strict schema, so a field it does not know makes the call fail. The schema version stays `"1"`; a field is added only for a client that asks for it ([ADR-0097](../decisions/0097-brain-indexes-wiki-pages.md) decision 8: reads gain fields, not new shapes).

| | |
|---|---|
| Header | `Kintsugi-Member-Features`, a comma-separated list of names, read in any case. The Kintsugi client sends it on every request |
| `page-attributes` | Every Brain node in `brain_tree`, `brain_read`, `brain_lookup`, `brain_grep` and `brain_changes` (a node, a child, a link, a match, a changed node) also carries `labels`, `space`, `status`, `owner` and `template`. Without the name the nodes are exactly as before |
| Unknown or missing | A name the server does not know is ignored, so a later feature needs no change here. A header longer than 200 characters is ignored whole, only the first 10 names are read, and a header is never the reason for a `400` |
| Older server | It ignores the header and answers in the old shape; the client's schema takes the new fields as optional, so both parse |
| Tests | `apps/api/test/unit/member-api-features.test.ts` parses the response of all five Brain reads, without and with the header, against a frozen copy of the version 1 schemas (`apps/api/test/unit/fixtures/member-brain-v1-schemas.ts`). Never edit that copy to make a test pass |

The local MCP bridge prints a second line of text after the JSON of a Brain tool when a node has attributes (`path — labels: a, b · space: ENG · status: current`). The values come from a page's front matter, so they are printed as plain text, clipped, one line each, and never put into a tool description.

### A new read instead of a new field: backlinks

`GET /api/member/v1/brain/backlinks?projectId&node&offset&limit` and the tool `brain_backlinks` (P2-025) list the pages that link to a page or to one of its headings or cards, in windows (at most 100, 20 by default) with `total` and `nextOffset`. An installed CLI never calls a route it does not know, so the schema version stays `"1"` and the five reads above do not change; `brain_read` keeps its `incoming` (the links to exactly that node, the first 20). Every node of the answer goes through the same function as the other reads, so the page attributes come only with the features header. The route has the same guards as the other member Brain reads (`member.read`, the token's projects, Project Access). The bridge prints one text part after the JSON, one line per entry (`path:first-last@commit — title → target (link)`), clipped and as plain text, and never puts a page's words into a tool description.
