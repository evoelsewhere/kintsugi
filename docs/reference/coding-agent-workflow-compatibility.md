# Coding Agent Workflow compatibility and pilot baseline

Status: probe record for implementation planning, recorded 2026-10-20. Presence and version checks do not establish native client compatibility.

## Host and repository baseline

| Component | Observed value | Evidence and limit |
|---|---|---|
| Host OS | Windows x64; edition and build were not available from the sandboxed inventory call | Shell and Git were Windows builds. Record edition/build during the release matrix. |
| Node.js | 24.21.0 | Local command output. |
| Corepack pnpm | 10.18.0 | Frozen install completed in the isolated worktree earlier in this execution. A later registry lookup was blocked by DNS restrictions; no install was attempted. |
| Git | 2.45.1.windows.1 | Local command output; anonymous HTTPS fetch of the public repository succeeded. SSH and gh authentication were unavailable. |
| Turborepo | 2.11.7 | Resolved from the installed repository package. Its bundled README and run/reference docs were read before planning commands. |
| Claude Code | 2.1.278 | Binary version observed. No plugin or MCP journey was run. |
| Codex CLI | 0.163.0-alpha.10.2 | Binary version observed. It reported stale temporary PATH/permission state; MCP interoperability is unproven. |
| GitHub Copilot CLI | Not installed | No version or plugin probe. |
| GitHub.com | Public repository read only | No authenticated API, webhook, PR permission or provider workflow probe. |
| GitHub Enterprise Server | Not probed | Exact server version and configuration are release gates. |

The package manager pin and installation facts are from the current implementation session; repeat them in a clean Windows and Linux release environment. This table is evidence of the local toolchain only.

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

Claude Code is the first full journey. Codex and Copilot CLI become supported only after the same task retrieval, local stdio startup, authentication, refresh/update and clean removal cases pass on exact recorded versions. A manifest that parses or a binary that is installed is not compatibility proof.

GitHub.com is the first provider. Record the GitHub App or webhook permission set, API version, event types, rate-limit behavior and full PR recovery result with the pilot. Add GitHub Enterprise Server only after recording an exact server version and passing the same provider cases. No claim is made here for GitLab, Bitbucket, Azure DevOps, CodeCommit or other AWS-hosted services.

## Research references

- [MCP SDK release v2.3.1](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.3.1)
- [MCP stdio serving guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md)
- [Commander v15.0.0 release](https://github.com/tj/commander.js/releases/tag/v15.0.0)
- [Node keyring upstream](https://github.com/Brooooooklyn/keyring-node)
- [Node keyring npm package](https://www.npmjs.com/package/%40napi-rs/keyring)
