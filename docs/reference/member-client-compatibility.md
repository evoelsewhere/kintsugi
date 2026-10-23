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
| GitHub Copilot CLI | Not installed | Generated manifest and marketplace shapes pass package tests; setup fails closed while the version is unverified. |

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

Setup generation is enabled only for the exact Claude Code 2.1.278 and Codex CLI 0.163.0-alpha.10.2 that passed the package lifecycle above. This is not a claim of end-to-end MCP support: that needs plugin-launched stdio startup, authentication, refresh, update and clean removal on exact recorded versions and supported operating systems. Copilot stays disabled until its native CLI is installed and tested.
