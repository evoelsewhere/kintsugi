# Kintsugi Plugin-First Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This follow-up authorizes local implementation and tests only; it does not authorize package publication, deployment, or installation into the user's ordinary AI profile.

**Goal:** Let a developer install the project-scoped Kintsugi plugin before signing in, then authenticate through a browser without creating or pasting a token, under an administrator-controlled 15- or 30-day connection lifetime.

**Architecture:** Keep local stdio MCP and the CLI as the local bridge. The generated project command configures the installation URL and project, installs the native plugin, and starts browser-based authorization only on first use. Kintsugi issues short access tokens and rotating refresh credentials; the CLI stores refresh credentials in the OS credential store and the API checks member permissions and Project Access on every read.

**Tech Stack:** TypeScript/ESM, Node ≥22.19.0, pnpm 10.18.0, NestJS 12, PostgreSQL, Commander 15, the existing MCP SDK 2.3.1, `@napi-rs/keyring` 2.0.0, React/Vite and Vitest.

**Spec:** [plugin-first authentication design](../specs/2026-10-22-kintsugi-plugin-first-oauth-design.md).

**Testing:** [plugin-first authentication testing plan](2026-10-22-kintsugi-plugin-first-auth-testing.md).

**Execution status (22 October 2026):** Local implementation and focused/repository-wide validation are complete. The required API/worker database suites, synthetic public-process OAuth smoke, runner tests, CLI/Hub/portal tests, root lint, root typecheck and root build passed. A real authenticated MCP session in Claude Code or Codex and a live GitHub/GHES PR observation pilot remain open release gates. See the testing plan's execution record and [local pilot guide](../../guides/coding-agent-workflow-pilot.md).

## User Flow

1. The developer installs the Kintsugi CLI once, then runs the project-generated command to install the plugin. This saves only the Kintsugi URL and project ID; installation does not create a token.
2. On first use, the plugin launches the CLI, which opens Kintsugi in the browser. The developer signs in and approves access to the named project.
3. Kintsugi then creates a five-minute access token and a rotating refresh token. The CLI uses the access token to fetch authorized Kintsugi project context. It keeps the access token in memory and stores the refresh token in the operating system's secure credential store.
4. Each request is checked against the member's current read permission and Project Access. The refresh token cannot renew the connection beyond the administrator's configured 15- or 30-day maximum age; after that, the developer signs in again.
5. The developer's AI uses the fetched context while working in the code repository with its normal GitHub login. Kintsugi observes the resulting PR and workflow progress; the Kintsugi token does not grant GitHub access.

## Global Constraints

- Keep the local stdio transport and self-hosted Compose/Postgres deployment; add no infrastructure dependency.
- Default the connection age to 15 days; the only initial admin choices are 15 or 30 days. This is the maximum time before browser sign-in is required again, not the five-minute access-token lifetime.
- Access tokens last 5 minutes; refresh credentials rotate and cannot outlive the current installation policy measured from the original authorization.
- Bind each connection to explicit project IDs; recheck member status, `member.read`, and current Project Access on every API request.
- Use the project's existing settings store and `KINTSUGI_PUBLIC_URL`; never derive canonical URLs from request `Host` headers.
- Store refresh credentials in the OS secure credential store, access tokens in process memory only, and SHA-256 hashes server-side; never log or return stored secrets.
- MCP stdout contains protocol messages only; browser and login diagnostics go to stderr.
- Keep all MCP tools read-only. The developer's AI uses its normal GitHub access for code and PRs; Kintsugi observes PR progress.
- Run native client processes with a cross-platform argument-safe adapter: use `shell: false` on POSIX; on Windows handle verified `.cmd` shims through the explicit system command interpreter with tested argument quoting and no interpolated user input.
- Do not present the current `private: true` CLI workspace package as an `npx`-installable artifact. The user-facing project command assumes the one-time CLI prerequisite is installed; package distribution remains a release prerequisite.
- Preserve unrelated dirty work. Stage or commit only files owned by this follow-up after the combined diff is reviewed.

## Review Focus

1. A code replay, wrong state, wrong verifier, or redirect mismatch must not create a connection — T19 and T20.
2. Newly granted Project Access must not widen an existing connection's project scope — T19 and T23.
3. Lowering the lifetime policy must stop refresh at the next refresh; raising it must not revive a revoked connection — T18 and T19.
4. First-use login cancellation, browser absence, or callback timeout must not corrupt MCP stdout or leave a live partial grant — T20.
5. Native plugin setup must preserve unrelated settings and roll back a partial marketplace install — T21.
6. Only `security.manage` can list/revoke all connections or change policy; members can revoke only their own connection — T18, T19, and T22.

---

## Delivery map

| Task | Deliverable | Depends on |
|---|---|---|
| T18 | ✅ Admin connection lifetime policy and Postgres connection/auth-code storage | — |
| T19 | ✅ Project-scoped authorization-code/PKCE and refresh API | T18 |
| T20 | ✅ CLI browser login, refresh manager, secure storage and MCP first-use behavior | T19 |
| T21 | ✅ One-command project plugin install with nonsecret profile creation | Shared CLI dependency contract |
| T22 | ✅ Portal install instructions, consent page and Security setting | T18–T21 |
| T23 | ✅ Synthetic integration smoke and user documentation; live-client and provider pilots remain open | T18–T22 |

## Orchestrated execution after plan approval

- **Coordinator (parent):** finalize ADR-0064/D80, implement T18–T19, establish the shared `CliDeps` test seams in `packages/cli/src/cli.ts`, then own T22–T23, combined-diff review, and the final verification run.
- **CLI authentication subagent:** implement T20 in the auth, OAuth, MCP, profile, and credential-store files. Do not edit `packages/cli/src/cli.ts`; the coordinator owns that shared dependency interface.
- **Plugin installer subagent:** implement T21 in `packages/cli/src/commands/plugins.ts`, Harness Hub generation/setup, and plugin tests. Do not edit `cli.ts` or the shared profile implementation; create the profile through its public store interface.
- Start the two subagent lanes after the shared contract is fixed. Keep their file ownership disjoint, review each result, and run combined tests from the parent before integrating. No agent publishes packages, deploys, or installs into an ordinary client profile.

### Task T18: Connection persistence and admin lifetime policy

**Files:**
- Create: `docs/decisions/0064-project-scoped-oauth-for-coding-agent-workflow.md`
- Modify: `docs/decisions/README.md` with ADR-0064 and decision D80
- Create: `apps/api/migrations/032_coding_agent_connections.sql`
- Modify: `apps/api/src/modules/admin/settings/domain/installation-settings.ts`
- Modify: `apps/api/src/modules/admin/settings/application/installation-settings.service.ts`
- Modify: `apps/api/src/modules/admin/settings/interface/installation-settings.dto.ts`
- Create: `apps/api/src/modules/admin/settings/interface/coding-agent-security.controller.ts`
- Modify: `apps/api/src/modules/admin/settings/installation-settings.module.ts` and public `index.ts`
- Modify: `apps/api/src/common/audit/audit-trail.ts`
- Test: `apps/api/test/integration/installation-settings.test.ts`

**Interfaces:** `CodingAgentConnectionLifetime = 15 | 30`; `getCodingAgentConnectionLifetime(): Promise<CodingAgentConnectionLifetimeView>`; `setCodingAgentConnectionLifetime(days: CodingAgentConnectionLifetime, actor: Actor): Promise<CodingAgentConnectionLifetimeView>`. Add `GET/PUT /api/admin/settings/coding-agent-connection-lifetime`, guarded by the migration-backed `security.manage` permission. The view contains `maxAgeDays`, `isDefault`, and update metadata, never secrets. Portal copy explains that this setting requires browser sign-in again after 15 or 30 days; access tokens still last five minutes.

- [x] Finalize ADR-0064 and D80; preserve ADR-0060 and supersede only its OAuth-deferral clause.
- [x] Add tests for default 15 days, admin setting 30 days, invalid values, and denial without `security.manage`.
- [x] Run the installation-settings integration coverage; it passes in the API database suite.
- [x] Add the connection, project-scope and authorization-code migration tables; add the token connection link and admin-only `security.manage` grant while preserving existing token rows.
- [x] Implement the policy in the existing installation-settings service/store with default 15 and allowed values 15/30; audit changes without credential material.
- [x] Verify setting metadata and permission denial through focused and full API tests.

### Task T19: Kintsugi authorization and connection API

**Files:**
- Create: `apps/api/src/modules/core/auth/domain/member-connection.repository.ts`
- Create: `apps/api/src/modules/core/auth/application/coding-agent-oauth.service.ts`
- Create: `apps/api/src/modules/core/auth/interface/coding-agent-oauth.controller.ts` and DTOs
- Create: `apps/api/src/modules/core/auth/interface/member-connections.controller.ts`
- Create: `apps/api/src/modules/core/auth/interface/admin-member-connections.controller.ts`
- Modify: `apps/api/src/modules/core/auth/infrastructure/pg-member-token.repository.ts`
- Modify: `apps/api/src/modules/core/auth/application/member-token.service.ts`
- Modify: `apps/api/src/modules/core/auth/interface/member-tokens.controller.ts`
- Modify: `apps/api/src/modules/core/auth/interface/auth.guard.ts` and `auth.module.ts`
- Modify: `apps/api/src/common/audit/audit-trail.ts`
- Create: `apps/api/test/unit/coding-agent-oauth.service.test.ts`
- Create: `apps/api/test/integration/coding-agent-oauth.test.ts`

**Interfaces:** `POST /api/auth/coding-agent/authorize` accepts `{ projectId, clientName, redirectUri, state, codeChallenge, codeChallengeMethod: "S256" }` under the signed-in session and returns a one-use authorization code redirect. `POST /api/auth/coding-agent/token` accepts either `{ grantType: "authorization_code", code, codeVerifier, redirectUri }` or `{ grantType: "refresh_token", refreshToken }` and returns `{ accessToken, refreshToken, expiresIn: 300, connectionId, projectIds }`. `POST /api/auth/coding-agent/revoke` accepts `{ refreshToken }` and revokes only the connection bound to that credential, allowing the CLI to complete logout without a browser session. `GET /api/auth/member-connections` lists the current user's connection metadata; `DELETE /api/auth/member-connections/:connectionId` revokes one of the current user's connections. `GET /api/admin/coding-agent-connections` and `DELETE /api/admin/coding-agent-connections/:connectionId` list/revoke installation-wide connections under `security.manage`; return metadata only. Remove `POST /api/auth/member-tokens` issuance while preserving `GET/DELETE` for existing-token metadata and revocation. Add `MemberConnectionRepository` operations for code creation/consumption, connection creation, refresh rotation, per-user/admin listing and revocation, and access-token authentication.

- [x] Add the API PKCE, replay/expiry, consent, self/admin revocation, refresh rotation and permission tests; add CLI state/callback tests in T20.
- [x] Run the focused API unit/integration tests and the API auth/project-access suites.
- [x] Implement `S256` PKCE with five-minute single-use codes, loopback-only redirect URIs, hashed codes and refresh credentials, and five-minute access tokens through the existing member-token path.
- [x] Detect refresh reuse and revoke its connection. Enforce `created_at + current maxAgeDays` at refresh so policy shortening applies on renewal and revocation remains final.
- [x] Reject revoked/expired credentials; intersect token scope with explicit connection project IDs; preserve per-request member, `member.read` and Project Access checks; retain legacy PATs only to their recorded expiry/revocation.
- [x] Add secret-free audit events and metadata-only listing; stop new manual PAT issuance while preserving safe legacy list/revoke behavior.
- [x] Run API auth and project-access integration suites with no required skips.

### Task T20: CLI browser authorization and refresh

**Files:**
- Create: `packages/cli/src/oauth.ts`
- Modify: `packages/cli/src/cli.ts` (coordinator establishes shared browser, loopback-callback, and native-command dependency seams before delegation)
- Modify: `packages/cli/src/profile.ts` and `packages/cli/src/credential-store.ts`
- Modify: `packages/cli/src/commands/auth.ts`, `shared.ts`, and `mcp.ts`
- Create: `packages/cli/test/oauth.test.ts`
- Modify: `packages/cli/test/cli.test.ts` and `packages/cli/test/mcp-process.test.ts`

**Interfaces:** Store a versioned OAuth credential envelope containing `{ refreshToken, connectionId, projectIds }` in the keyring; `OAuthTokenResponse` matches T19. Preserve compatibility with an existing raw `knt_pat_` value by passing it through as a legacy bearer credential without refreshing it. `beginBrowserLogin(profile, projectId): Promise<OAuthCredential>` creates PKCE/state, opens Kintsugi's configured authorization URL, and waits for a validated loopback callback. `accessTokenFor(profileId): Promise<string>` refreshes before expiry, serializes concurrent refreshes, rotates the stored refresh credential, and returns access credentials only in memory.

- [x] Add tests for PKCE/state, malformed/replayed callbacks, cancellation/timeouts, refresh rotation/single-flight, credential-store failure and policy expiry.
- [x] Run focused CLI OAuth, CLI command and MCP process tests.
- [x] Replace new PAT prompting with browser sign-in; implement server-side connection revocation on logout and safe legacy token cleanup. Fail closed if rotated credentials cannot be saved.
- [x] Start first-use browser authorization only when MCP is unauthenticated; honor cancellation and keep human-readable output on stderr.
- [x] Keep access tokens in memory and rotating refresh credentials in the native secure store through the existing token-provider contract.
- [x] Run CLI tests, typecheck and lint.

### Task T21: Project-specific plugin installation

**Files:**
- Modify: `packages/cli/src/commands/plugins.ts`
- Modify: `services/harness-hub/src/plugins/setup.ts` and `generate.ts`
- Test: `packages/cli/test/plugins.test.ts`
- Test: `services/harness-hub/test/plugins.test.ts`

**Interfaces:** `kintsugi plugins setup --harness <claude-code|codex> --url <canonical-url> --project <project-id> [--profile <id>]` must work without credentials. It creates/updates only nonsecret profile fields, invokes the existing deterministic package generation, then installs/enables the native marketplace through an injected `runClientCommand(executable, args)` dependency. The generated plugin continues to launch local stdio MCP with the selected profile/project.

- [x] Add tests proving setup needs no credential, saves only URL/project, quotes generated arguments, and orders native marketplace/install commands.
- [x] Cover idempotence, preservation of unowned files/settings, rollback guidance, and Windows/POSIX quoting edge cases.
- [x] Implement the no-auth install path and argument-safe native command runner with allowlisted executables, rollback guidance, and refusal to overwrite unowned files.
- [x] Run CLI and Harness Hub plugin tests; both pass.

### Task T22: Portal install, consent, and Security setting

**Files:**
- Modify: `apps/portal/src/pages/agent-context/member-tokens.tsx` and `member-task.tsx`
- Modify: `apps/portal/src/lib/api/agent-context.ts`; create `apps/portal/src/lib/api/coding-agent-security.ts`
- Create: `apps/portal/src/pages/coding-agent-authorize.tsx` and `apps/portal/src/pages/agent-context/coding-agent-install-model.ts`
- Create: `apps/portal/src/pages/settings/sections/coding-agent-security-section.tsx` and `coding-agent-security-model.ts`
- Modify: `apps/portal/src/pages/settings/settings-tabs.tsx`, `apps/portal/src/pages/login.tsx`, and `apps/portal/src/App.tsx`
- Modify: `apps/api/src/common/config/env.ts` and `apps/api/src/modules/core/auth/interface/auth.controller.ts` to expose the canonical installation URL from configured `KINTSUGI_PUBLIC_URL`; do not derive it from request headers
- Create: `apps/portal/src/pages/agent-context/coding-agent-install-model.test.ts` and `apps/portal/src/pages/settings/sections/coding-agent-security-model.test.ts`

- [x] Test project install-command generation, Security setting choices, connection list/revoke contracts and secret-free metadata.
- [x] Test consent request parsing, safe sign-in return and validated loopback redirect behavior.
- [x] Run focused portal/API tests; the portal suite passes 76/76 and the API suite passes 371/371.
- [x] Replace manual token creation with plugin setup and connection management; retain legacy token revocation and clearly label the private CLI prerequisite.
- [x] Add the consent route, safe login return, and canonical URL sourced from `KINTSUGI_PUBLIC_URL`.
- [x] Add the Security panel, permission filtering, saving/error states and audited policy updates; distinguish maximum connection age from five-minute access tokens.
- [x] Run portal typecheck/lint and tests.

### Task T23: Combined smoke and documentation

**Files:**
- Modify: `scripts/run-member-integration.mjs`
- Modify: `scripts/smoke-coding-agent-context.mjs`
- Modify: `docs/guides/coding-agent-workflow.md` with a local first-run/pilot section covering project, synthetic task and document fixture, plugin install, browser sign-in, MCP reads, revocation, and the normal GitHub PR handoff
- Modify: `docs/reference/coding-agent-cli.md` and `docs/reference/harness-integration.md`
- Modify: the existing workflow implementation/testing plan links

- [x] Add OAuth tests to the required API database runner and redact OAuth codes/access/refresh values from diagnostics.
- [x] Extend public-process smoke with a synthetic project/task/document fixture, consent and PKCE exchange, context reads, and revocation denial; retain a separate live-client gate.
- [x] Document CLI setup, browser consent, secure-store prerequisites, connection-age policy, Project Access and GitHub boundaries; add the [local pilot guide](../../guides/coding-agent-workflow-pilot.md).
- [x] Run API/worker integration suites, CLI/Hub/portal tests, runner tests, root lint, typecheck and build. Results and limitations are recorded in the test plan.
- [ ] Run the root `pnpm test` umbrella after the repository-pinned pnpm 10.18.0 is available; current package and database-suite evidence is recorded separately.
- [x] Review the combined implementation and keep publication, deployment and ordinary user-profile installation outside this plan.

## Planning self-review

- T18–T19 cover every backend/data/permission requirement; T20 covers browser PKCE, refresh, secure storage, and MCP stream behavior; T21 covers plugin-first setup; T22 covers install/consent/admin UX; T23 covers smoke, docs, and release evidence.
- The critical conditions appear in Review Focus and have explicit owning tests.
- ADR-0064/D80 captures the authentication protocol change without rewriting ADR-0060; both the ADR and decision register mark it accepted.
- User and administrator revocation paths are distinct and permission-checked; existing PATs retain only original expiry/revocation behavior.
- The existing Test project is used only for a safely empty read/revoke smoke; task/document retrieval uses a separate synthetic fixture.
- The project-scoped credential shape and the five-minute access / 15-or-30-day refresh policy match the approved spec.
- The CLI package is currently private; the plan does not misrepresent it as an available npm bootstrap. A pinned release artifact remains required before a general user can perform the one-time CLI installation.
