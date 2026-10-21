# Coding Agent Workflow compatibility and pilot baseline

Status: updated 2026-10-21. Records local package lifecycle probes; these do not establish a complete authenticated MCP integration or a release support matrix.

## Host and repository baseline

| Component | Observed value | Evidence and limit |
|---|---|---|
| Host OS | Windows x64; edition and build were not available from the sandboxed inventory call | Shell and Git were Windows builds. Record edition/build during the release matrix. |
| Node.js | 24.21.0 | Local command output. |
| Corepack pnpm | 10.18.0 | Exact MCP server/client 2.3.1 packages resolved from npm and the isolated workspace install completed; native host interoperability remains unverified. |
| Git | 2.45.1.windows.1 | Local command output; anonymous HTTPS fetch of the public repository succeeded. SSH and gh authentication were unavailable. |
| Turborepo | 2.11.7 | Resolved from the installed repository package. Its bundled README and run/reference docs were read before planning commands. |
| Claude Code | 2.1.278 | In a disposable `CLAUDE_CONFIG_DIR`, strict validation, local marketplace add/list, plugin install/list, uninstall and marketplace removal passed. No live authenticated MCP request was run. |
| Codex CLI | 0.163.0-alpha.10.2 | In a disposable `CODEX_HOME`, local marketplace add/list, available-plugin listing, plugin add/list and marketplace removal passed. Removal left no installed plugin. No live authenticated MCP request was run. A PATH alias warning was expected because the temporary profile was isolated. |
| GitHub Copilot CLI | Not installed | Generated manifest and marketplace shapes pass package tests; no native CLI validation or lifecycle probe was possible. Setup fails closed while the version is unverified. |
| GitHub.com | Public repository read only | No authenticated API, webhook, PR permission or provider workflow probe. |
| GitHub Enterprise Server | Not probed | Exact server version and configuration are release gates. |

The native probes used the generated packages from the local CLI and temporary config directories; the developer's normal client settings were not changed. Repeat them in clean Windows and Linux release environments. These results prove a bounded package lifecycle only, not tool startup, authentication, task retrieval, update compatibility or operating-system-wide support.

## Native package lifecycle evidence

The generated package and marketplace were placed in a disposable temporary root, with separate Claude and Codex homes. Claude accepted `claude plugin validate --strict` for both the generated plugin and marketplace, then completed marketplace add, plugin install/list, uninstall and marketplace removal. Codex completed marketplace add/list, available-plugin listing, plugin add/list and marketplace removal; its installed-plugin list was empty afterward. The profile-isolation PATH warning did not prevent installation or rollback.

The probes did not invoke the plugin's MCP server from either native client, authenticate to a Kintsugi installation, fetch a task, or verify client upgrades. Copilot was absent. Those cases remain explicit release-matrix work; generated configuration alone is not support evidence.

## Baseline verification

The repository test command was run in the isolated implementation worktree before product changes. One existing Windows environment test fails in services/runtime/test/shell.test.ts: it assumes the shell HOME value ends with the literal path segment tmp. The actual Windows Git Bash path does not satisfy that string check. The focused test reproduces the same assertion at line 43; the Coding Agent Workflow changes do not touch runtime shell behavior. All other reported failures were absent. This is recorded as a baseline limitation and is not counted as a regression from this work.

## Exact boundary dependency research

Versions are pinned as one compatible implementation group. Package namespace and versions must remain exact in manifests and lockfiles.

| Boundary | Pinned package | Why | Primary source |
|---|---|---|---|
| CLI | commander 15.0.0 | ESM command parser; upstream declares Node 22.12 or newer | [Commander v15.0.0 release](https://github.com/tj/commander.js/releases/tag/v15.0.0) |
| Local MCP server | @modelcontextprotocol/server 2.3.1 | Split SDK server package; current stdio server entry and serveStdio factory | [TypeScript SDK v2.3.1](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.3.1), [official stdio guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md) |
| MCP conformance client | @modelcontextprotocol/client 2.3.1 | Real client process for protocol tests, pinned to the server release | [TypeScript SDK v2.3.1](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.3.1) |
| OS credential access | @napi-rs/keyring 2.0.0 on Windows/macOS; `secret-tool` on Linux | Native Node-API bindings on Windows/macOS; Linux calls Secret Service directly so no kernel-keyutils fallback can satisfy the command | [Upstream repository](https://github.com/Brooooooklyn/keyring-node), [package README](https://www.npmjs.com/package/%40napi-rs/keyring), [Secret Tool manual](https://manpages.debian.org/unstable/libsecret-tools/secret-tool.1.en.html) |

The installed keyring package accepts only service and username in its `Entry` constructor; it has no Linux backend selector. Its Linux behavior tries Secret Service first and can silently use kernel keyutils when Secret Service is unavailable. T07 therefore uses `secret-tool` directly on Linux and fails closed if that utility or the service is unavailable. This Linux implementation is covered by injected command-runner tests but still needs a native Linux desktop test. Windows/macOS use the pinned keyring binding; the Windows round-trip is checked with a disposable account during T07, while macOS remains unverified.

## Package namespace

The implementation plan uses workspace package names @kintsugi/kintsugi-client and @kintsugi/cli. These are repository workspace identifiers, not a claim of public npm ownership. The public package namespace remains unverified and must be checked before any package publication.

## Client and provider support claims

Setup generation is enabled only for the exact Claude Code 2.1.278 and Codex CLI 0.163.0-alpha.10.2 versions that passed the bounded package lifecycle above. This is not a claim that the end-to-end MCP workflow is supported. Complete client support requires the same task retrieval, plugin-launched local stdio startup, authentication, refresh/update and clean removal cases on exact recorded versions and supported operating systems. Copilot remains disabled until its native CLI is installed and tested.

GitHub.com is the first provider. Record the GitHub App or webhook permission set, API version, event types, rate-limit behavior and full PR recovery result with the pilot. Add GitHub Enterprise Server only after recording an exact server version and passing the same provider cases. No claim is made here for GitLab, Bitbucket, Azure DevOps, CodeCommit or other AWS-hosted services.

## Research references

- [MCP SDK release v2.3.1](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.3.1)
- [MCP stdio serving guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md)
- [Commander v15.0.0 release](https://github.com/tj/commander.js/releases/tag/v15.0.0)
- [Node keyring upstream](https://github.com/Brooooooklyn/keyring-node)
- [Node keyring npm package](https://www.npmjs.com/package/%40napi-rs/keyring)
