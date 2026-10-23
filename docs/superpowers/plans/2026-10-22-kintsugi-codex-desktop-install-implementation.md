# Implementation plan: Codex Desktop plugin installation

**Goal:** Let a developer stage the project-scoped Coding Agent Workflow plugin into Codex’s personal local marketplace, then install it from Codex Desktop’s Plugins Directory while retaining the existing local stdio OAuth bridge.

**Spec:** ../specs/2026-10-22-kintsugi-native-app-install-design.md

**Decision:** ADR-0064, amending ADR-0059 decisions 1 and 6.

**Execution:** Inline implementation in the isolated feature/coding-agent-workflow-mcp worktree. Preserve all prior OAuth and plugin changes in this worktree.

## Global constraints

- Keep local stdio MCP and the existing PKCE/browser sign-in, OS credential storage, refresh rotation, Project Access checks, and administrator lifetime policy.
- Do not add remote MCP, a new datastore, or an infrastructure dependency.
- Do not write plugin assets into a source repository. Stage the package below `~/.codex/plugins/` and the catalog at `~/.agents/plugins/marketplace.json`.
- Preserve unrelated marketplace entries and metadata. Reject malformed, conflicting, or symlinked files; use atomic writes.
- Do not call Codex CLI when desktop-ui mode is selected. Do not represent staging as a completed app install.
- Use the canonical packages/agents/builtin/plugins/access skill; generate only Codex manifests and Kintsugi-owned metadata.
- Keep refresh credentials in the OS credential store, access tokens in memory, and MCP stdout protocol-only.
- Do not commit or push during this implementation. Preserve all existing uncommitted branch work.

## Review focus

1. A desktop-UI setup must not invoke any native client command or require Codex CLI to be installed.
2. A user’s existing personal marketplace entries and metadata must survive setup and update.
3. A profile’s package path and plugin identity must be stable and unique; resolve the marketplace-relative source path and prove it remains inside the user home.
4. A conflict, malformed marketplace, symlink, or partial write must fail safely without claiming readiness.
5. The generated Codex plugin must start the intended Kintsugi CLI profile and must contain no credentials.
6. The guide must distinguish CLI package preparation from the Codex Desktop UI install and from the existing Claude Code setup.

## Delivery map

| Task | Deliverable | Depends on |
|---|---|---|
| T1 | Tests for profile-specific Codex plugin IDs and safe marketplace merge | — |
| T2 | Idempotent personal marketplace writer and desktop-UI package layout | T1 |
| T3 | CLI desktop-ui mode with no native client invocation | T2 |
| T4 | Portal guide, generated command, exact desktop steps, and pilot limits | T3 |
| T5 | ADR-0064, D80/register update, and testing runbook | T1–T4 |
| T6 | Focused suites, root checks, combined diff review, app pilot if safe | T1–T5 |

### T1: Write failing setup tests first

Files: services/harness-hub/test/plugins.test.ts, packages/cli/test/plugins.test.ts

- [x] Assert profile-specific Codex plugin identities are deterministic and distinct across Kintsugi profiles.
- [x] Assert desktop-UI package generation uses only the canonical skill, a local stdio MCP manifest, the expected absolute CLI launcher/profile, and no access or refresh token.
- [x] Assert marketplace creation, update, and repeat setup preserve unrelated entries and metadata.
- [x] Assert malformed catalogs, a conflicting plugin identity, and symlinked marketplace/package paths are rejected.
- [x] Assert desktop-ui mode does not call getClientVersion or runClientCommand, and rejects unsupported harnesses.

Verification: Run the new focused tests and confirm each fails for the missing contract before implementation.

### T2: Implement safe package staging and marketplace merge

Files: services/harness-hub/src/plugins/generate.ts, services/harness-hub/src/plugins/setup.ts, services/harness-hub/src/index.ts

- [x] Add a profile-specific plugin name and readable project label for Codex Desktop while preserving the existing native-CLI package identity.
- [x] Add a desktop-UI package layout in `~/.codex/plugins/<name>` and use Codex’s personal source path `./.codex/plugins/<name>` in the catalog.
- [x] Implement a marketplace merge that validates the existing catalog, updates only the matching Kintsugi entry, preserves all others, rejects conflicts and symlinks, and writes atomically.
- [x] Keep native CLI setup behavior and rollback commands unchanged.
- [x] Return a report that distinguishes staged files and marketplace path from native install steps.

Verification: Run the Harness Hub tests and typecheck/build that package.

### T3: Implement the CLI desktop-UI mode

Files: packages/cli/src/commands/plugins.ts, packages/cli/test/plugins.test.ts

- [x] Add --install-mode native-cli|desktop-ui, defaulting to current native-cli behavior.
- [x] For desktop-ui mode, require Codex, derive the personal marketplace root from the OS home directory, write the existing nonsecret Kintsugi profile, stage files, merge the catalog, and skip native client version checks/invocations.
- [x] Print restart, Plugins Directory, local Kintsugi marketplace, review/install, and first-use browser sign-in steps.
- [x] On failure, report exact generated paths and a safe cleanup action. Never claim installed until the user completes the Codex UI step.

Verification: Run the CLI tests and prove the fake client command runner remains untouched in desktop-ui mode.

### T4: Update the portal installation guide

Files: apps/portal/src/pages/developer-documents.tsx, related install-model code/tests

- [x] Make Codex Desktop the first app-UI route and generate the package-preparation command from the current portal origin and selected project.
- [x] Explain the CLI prerequisite once and distinguish “Prepare marketplace” from “Install in Codex Desktop.”
- [x] Link to current official Codex download/plugin instructions; keep Node/Git prerequisites accurate.
- [x] Preserve a clearly labeled Claude Code native-CLI route and mark other desktop/cloud surfaces as separate or pending validation.
- [x] Replace unsupported preview claims with observable automated checks plus explicit real-client pilot status.

Verification: Portal model/page tests and production build passed. Direct rendered-page inspection redirected to login, so the guide reports the real-client pilot as pending instead of claiming visual or authenticated client validation.

### T5: Record the decision and testing runbook

Files: docs/decisions/0064-codex-desktop-plugin-installation.md, docs/decisions/README.md, docs/superpowers/specs/2026-10-22-kintsugi-native-app-install-design.md, docs/superpowers/plans/2026-10-22-kintsugi-codex-desktop-install-testing.md

- [x] Add the accepted ADR and amend D80 without rewriting ADR-0059 or ADR-0063.
- [x] Add a step-by-step testing plan covering local package staging, Codex Desktop installation, OAuth consent, read-only context, PR observation, and cleanup.
- [x] Keep release-gate language honest: automated MCP/protocol tests do not prove desktop-client installation.

Verification: Check links, decision register, and instructions against the actual generated package paths.

### T6: Verify and review

- [x] Run focused Harness Hub, CLI, portal, client, and Coding Agent OAuth unit/integration tests; stage the actual local Codex Desktop package and verify the command reports “not installed yet.”
- [x] Run package typecheck, lint, and build checks after the focused suites pass.
- [x] Review the branch diff/status and whitespace; preserve unrelated `.tmp/` and prior feature changes.
- [x] The desktop app UI cannot be operated from this session. The testing plan contains the exact in-app pilot steps; actual marketplace selection, OAuth consent, and authenticated Codex tool use remain a user-run client pilot.
