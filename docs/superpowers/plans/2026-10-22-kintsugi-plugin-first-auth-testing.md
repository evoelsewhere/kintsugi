# Kintsugi Plugin-First Authentication Testing Plan

Date: 22 October 2026. Status: acceptance plan for the plugin-first authentication follow-up. It extends the original Coding Agent Workflow test matrix; it does not replace the PR/review/gate pilot gates.

**Design:** [plugin-first authentication design](../specs/2026-10-22-kintsugi-plugin-first-oauth-design.md).
**Implementation:** [plugin-first authentication implementation plan](2026-10-22-kintsugi-plugin-first-auth-implementation.md).

## Acceptance invariants

- Install the native plugin before signing in. The generated command contains the configured canonical URL and selected project ID, and setup works with no stored credential.
- First use starts authorization code + PKCE through a browser loopback callback; no raw PAT appears in the portal, command line, profile, plugin config, stdout, or logs.
- Authorization codes are hashed, single-use, five-minute, bound to the exact redirect URI and S256 verifier. Refresh credentials are hashed server-side and rotated.
- Access tokens last five minutes. Refresh stops when the original connection age reaches the current 15/30-day admin cap. The default is 15 days.
- Credentials bind to explicit project IDs. Current member status, `member.read`, and Project Access are checked on every read. New Project Access does not widen an old connection.
- Only the refresh credential is persisted in the OS credential store; access tokens remain in process memory. MCP stdout contains protocol frames only.
- Existing raw `knt_pat_` values remain usable only until their original expiry/revocation; new manual PAT issuance is disabled.
- Every MCP tool stays read-only; repository commits and PR creation use the selected harness's ordinary GitHub credentials.

## Case matrix

| ID | Layer | Scenario | Required result |
|---|---|---|---|
| AUTH-PF-01 | API unit/integration | Valid S256 code exchange | One scoped connection and access/refresh pair; only hashes are persisted |
| AUTH-PF-02 | API integration | Wrong verifier, redirect URI, project authorization, installation, or expired code | Reject with no connection and no secret in response/log |
| AUTH-PF-03 | API integration | Replay consumed code or old rotated refresh token | Reject; refresh-token reuse revokes the owning connection |
| AUTH-PF-04 | API integration | Connection granted Test; user later gains access to another project | Other project remains out of scope until renewed consent |
| AUTH-PF-05 | API integration | Remove Project Access, member.read, or disable member | Next read is denied and private markers are absent |
| AUTH-PF-06 | API integration | Admin sets 15 then 30 days; malformed/14/31 values; member attempts update | Default is 15; only admin with security.manage may set 15 or 30; updates audited |
| AUTH-PF-07 | API integration | Shorten/extend policy with active/revoked connections | Lower cap blocks next refresh based on original authorization; raising cap does not revive revoked grants |
| AUTH-PF-08 | API integration | Access token expires or connection is revoked | Expired/revoked credential is rejected on the next request |
| CLI-PF-01 | CLI unit | PKCE, state, callback success and validation failures | Valid callback completes once; state mismatch, invalid/replayed callback, cancellation, or timeout fails safely |
| CLI-PF-02 | CLI unit | Refresh before access expiry | New access token is cached in memory and rotated refresh credential replaces keyring value |
| CLI-PF-03 | CLI process | Browser opener unavailable or login cancelled during MCP start | Same-machine authorization URL or actionable failure goes to stderr; no user text reaches MCP stdout |
| CLI-PF-04 | CLI process | Auth status/logout | Status reports metadata only; logout revokes OAuth connections and deletes the refresh secret; legacy PAT logout clears local storage and points to portal revocation |
| CLI-PF-05 | CLI unit/process | Existing keyring contains a legacy `knt_pat_` value | CLI continues using it until the server rejects its original expiry/revocation; no token value is printed |
| PKG-PF-01 | CLI/Hub | `plugins setup` with URL/project and no auth | Profile and native plugin install complete without token creation |
| PKG-PF-02 | CLI/Hub | Repeat install, unowned files, broken client command | Idempotent where owned; refuses unowned files; reports recoverable rollback on partial install |
| PKG-PF-04 | CLI process | Native client executable resolution on Windows and POSIX | Uses the allowlisted client binary, preserves each argument across spaces/metacharacters, and never executes user-controlled shell text |
| PKG-PF-03 | Native client | Claude Code and Codex plugin lifecycle | Package validates, loads stdio tools, and can be removed/reinstalled on disposable profiles |
| UI-PF-01 | Portal | Project install and connection panel | One generated command, no manual URL entry, no raw secret, connection metadata can be revoked |
| UI-PF-02 | Portal | OAuth consent and signed-out browser | Exact client/project is shown; decline grants nothing; sign-in return preserves the request |
| UI-PF-03 | Portal | Security policy/connections | Admin sees only 15/30 choices and saved/default state, lists/revokes connections; unauthorized user cannot edit or inspect them |
| E2E-PF-01 | Manual local browser smoke | Test project, first plugin connection, authorized reads, revoke | Browser login completes; Test appears only in granted scope; revoke blocks the next read |
| E2E-PF-02 | Synthetic fixture | Read task brief/documents through authenticated MCP | Task/doc content is returned with stable citations and no cross-project content |
| E2E-PF-03 | Local client pilot | Claude Code and Codex on disposable profiles | First use signs in without PAT paste; AI can answer from fixture context; MCP remains read-only |
| E2E-PF-04 | Gated GitHub pilot | Authorized synthetic task and disposable branch/PR | Harness uses its normal GitHub credential to create a PR; Kintsugi observes the PR/review state. Run only after the existing provider and PR-observation gates pass. |

## Commands and evidence

Run focused contracts first, then the required database and package lanes:

```powershell
pnpm --filter @kintsugi/api exec vitest run test/unit/coding-agent-oauth.service.test.ts
node scripts/run-member-integration.mjs --suite api
pnpm run test:coding-agent:smoke
pnpm --filter @kintsugi/cli exec vitest run test/oauth.test.ts test/cli.test.ts test/mcp-process.test.ts test/plugins.test.ts
pnpm --filter @kintsugi/harness-hub test
pnpm --filter @kintsugi/portal exec vitest run
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

The local `Test` project currently has no tasks. Use it to verify plugin-first login, project listing, a safely empty task list, and immediate revocation. Test task-brief and cited-document behavior against a separate synthetic disposable project/repository fixture. Do not add fixture files to the `falo-be` document repository as part of this test plan.

## Local first-run smoke sequence

1. Start the existing local Docker-backed Kintsugi stack and confirm the portal, API, worker, and Postgres are healthy. Keep the current `Test` document repository unchanged.
2. Set the administrator policy to 15 days and confirm a regular member cannot change it. Verify the smoke account has `member.read` and current Project Access to `Test`.
3. Install the plugin for `Test` before signing in. First use must open the browser; confirm consent names the exact project, approve it, list the authorized project, verify the empty task list, revoke the connection, and confirm the next read is denied.
4. Separately run `pnpm run test:coding-agent:smoke`; it creates and removes its own disposable database and synthetic project/task/document fixture, proving process-level retrieval and revocation. Do not rely on that temporary fixture for an interactive client session.
5. For a live client answer test, use a separate disposable local project and synthetic document repository with a task brief, `standards/` document, evidence item, and an ungranted second project. Do not modify `falo-be` or reuse data from the automatically cleaned smoke database; document the fixture creation and cleanup steps with the feature's local pilot guide.
6. Grant the synthetic test member `member.read` and Project Access only to the fixture project. Run its generated install command before signing in, using a separate CLI profile and disposable Claude Code/Codex profiles.
7. Start each client and confirm first MCP use opens Kintsugi in the browser. Sign in, verify client/project consent, approve it, and confirm the CLI stores only a refresh credential in the OS credential store. Ask the AI to summarize the task, standards, and evidence; verify citations and that the ungranted project's marker cannot be retrieved. Revoke and confirm the next read fails.
8. For the separate GitHub pilot, the developer uses a disposable branch and ordinary harness GitHub login to open a PR for the synthetic task. Confirm Kintsugi observes the PR and review events; do not grant GitHub write access to the Kintsugi CLI/MCP connection.

The eight steps above are manual pilot evidence, not a substitute for automated API, CLI, portal, and Hub tests. Record environment and versions, redact tokens and task secrets, and mark unavailable clients/providers as unverified.

Run native client checks only in disposable profiles. Record exact CLI, plugin, OS, Node, and client versions, OAuth result, secure-store backend, and redacted test report. Do not claim Claude/Codex support from package generation alone. The current CLI workspace package is private; use the feature checkout's built CLI for local verification until a pinned release artifact exists. Package publication, deployment, and a real GitHub PR are separate release actions.

## Release gates

- **R1 — Authorization:** AUTH-PF-01 through AUTH-PF-08 pass against disposable PostgreSQL with no required skips.
- **R2 — Client setup:** PKG-PF-01 through PKG-PF-04 pass for each advertised local client/version and supported OS; no ordinary user profile is modified.
- **R3 — Integrated context:** E2E-PF-01 and E2E-PF-02 pass; revoke and Project Access removal take effect on the next request.
- **R4 — User pilot:** E2E-PF-03 passes for the exact Claude Code/Codex versions advertised. Any unavailable client, secure-store backend, or live installation is recorded as unverified, not passed.

No case is marked passed until the command and report are recorded with source revision and environment. Missing database, browser, client, or keyring evidence is an open gate, not a pass.

## Local execution record — 22 October 2026

The approved implementation was tested in the uncommitted `feature/coding-agent-workflow-mcp` worktree based on `8754c8e20119ea3bfd73f273cef0ffdd585e2ad9`, with Node 24.21.0, available global pnpm 8.10.5, and Turbo 2.11.7. The repository pins pnpm 10.18.0, but Corepack could not fetch it because registry access was unavailable; the pinned-pnpm rerun remains open. Because the tested changes are uncommitted, this record is local verification evidence rather than a release artifact.

- API integration suite: 61/61; worker integration suite: 85/85; both ran through `pnpm run test:coding-agent:integration` against a dedicated disposable PostgreSQL server.
- Public-process smoke: passed using a uniquely named disposable database. It covered PKCE exchange, five-minute scoped access, task/document/search reads, refresh rotation, redacted connection metadata, Git sync A/B, API restart, pinned snapshot/staleness, write denial, Project Access revocation, connection revocation and process cleanup.
- API full suite: 371/371 across 64 files with `--maxWorkers=4`. API typecheck, lint and build passed.
- CLI: 148/148 tests; Harness Hub: 19/19; portal: 76/76. Their typechecks and lints passed; CLI and Hub builds passed.
- Workflow runner: 17/17. Root lint passed (14/14 tasks), typecheck passed (25/25), and build passed (14/14).

The execution above proves local code and synthetic API/worker behavior. It does not pass E2E-PF-01, E2E-PF-03 or R4: no authenticated MCP call was made through a live Claude Code or Codex session, no browser consent was completed in an AI client, and no live GitHub.com/GHES PR was observed. Package publication, the pinned-pnpm rerun, and a client/provider pilot remain release gates.
