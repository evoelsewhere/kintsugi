# Testing plan: Codex Desktop plugin installation

**Goal:** Prove that Kintsugi can stage a project-scoped, credential-free plugin in Codex’s personal local marketplace and that the existing local MCP bridge still reads authorized project context.

**Spec:** ../specs/2026-10-22-kintsugi-native-app-install-design.md

**Implementation:** 2026-10-22-kintsugi-codex-desktop-install-implementation.md

## Automated checks

1. Generate the Codex package for two distinct profiles. Verify unique plugin IDs, readable project-specific directory labels, canonical skill, portable plugin.json and mcp.json, stdio transport, absolute CLI entry point, explicit profile, and no credential material.
2. Create a new personal marketplace catalog. Verify its source path is `./.codex/plugins/<name>` and resolves to the staged package inside the user home, plus AVAILABLE install policy and ON_INSTALL authentication policy.
3. Merge into an existing marketplace with unrelated top-level fields and plugin entries. Verify they survive; re-run setup and update the same profile to prove idempotence.
4. Reject invalid JSON, an invalid plugins list, a conflicting package entry, symlinked paths, and any resolved source path outside the user home. Confirm no unrelated data is overwritten.
5. Exercise the CLI command with fake profile storage, file store, and client runner. Confirm desktop-ui skips client CLI detection and invocation, writes only nonsecret profile data, and reports “staged” rather than “installed.”
6. Run existing OAuth tests for callback timeout/cancellation, PKCE mismatch/replay, project scope, refresh rotation/reuse, revocation, and maximum connection age.
7. Run local stdio MCP tool-call smoke with synthetic API fixtures and verify results remain read-only, scoped, and structured.
8. Run portal tests for command generation, Codex Desktop steps, prerequisites, expiry/sign-in copy, and truthful pilot status.

## Local Codex Desktop pilot

Use the local Docker installation and a non-sensitive test project.

1. Confirm API and portal are healthy at the configured Kintsugi URL and build the CLI from the Kintsugi workspace.
2. From the Kintsugi workspace, run the generated plugins setup command with desktop-ui mode for the test project.
3. Confirm the report points to `~/.agents/plugins/marketplace.json`, preserves existing entries, and created the profile-specific package at `~/.codex/plugins/<name>` with no token.
4. Restart Codex Desktop. Open Plugins, choose the local Kintsugi marketplace, review the Coding Agent Workflow plugin, and install it.
5. Start a new local conversation and ask for the authorized project list. Complete browser sign-in and approve only the named project.
6. Ask Codex to list tasks and explain the task brief/design/standards. Confirm citations and compare with Kintsugi’s task page.
7. Ask Codex to claim a task, change a Kintsugi gate, or write through Kintsugi MCP. Confirm those actions are unavailable. Implement code with Codex’s normal repository tools only when using an explicitly authorized test repository.
8. For an authorized test PR, open or update a PR using the user’s normal GitHub access; confirm Kintsugi shows the latest revision and status while the Kintsugi MCP token grants no GitHub access.
9. Uninstall the plugin through Codex Plugins UI. Remove only the Kintsugi profile entry/package using the documented cleanup route; keep unrelated marketplace entries and project data intact.

## Limits to report

Automated tests do not prove the actual Codex app’s plugin browser, OAuth callback, or model tool-selection behavior. Record a real client pilot only after the plugin is installed and a successful authenticated MCP call completes in Codex Desktop. If no test task or PR exists in the local database, use synthetic fixtures and do not modify project data without separate authorization.

## Execution record (2026-10-22)

- Harness Hub: 22 tests passed; typecheck, lint, and build passed.
- CLI: 155 tests passed; typecheck, lint, and build passed.
- Portal: 80 tests passed; typecheck, lint, and build passed. The focused install-command and guide diagram checks also passed (12 tests).
- Kintsugi client: 34 tests passed.
- Coding Agent OAuth API unit and integration tests: 10 passed.
- Final `git diff --check` passed. Existing `.tmp/` and prior feature work were preserved.
- Local Codex Desktop package staging completed idempotently. The CLI reported “Prepared for Codex Desktop; not installed yet.” The app install, first-use browser consent, and authenticated MCP request remain pending the local UI pilot above.
