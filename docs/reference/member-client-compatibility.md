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
