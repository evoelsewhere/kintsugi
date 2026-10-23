# ADR-0064: Use project-scoped browser authorization for the local Coding Agent Workflow

- Status: Accepted
- Date: 2026-10-22
- Decision register: D79
- Supersedes: ADR-0060 decision 7 only (OAuth deferral for the local Coding Agent Workflow)

## Context

The local CLI and stdio MCP bridge currently use a manually created, project-scoped personal token. Developers must create the token in the portal, copy it into a CLI login prompt, and then install the coding-agent plugin. This reverses the expected plugin setup order and gives administrators no single connection-age policy. The approved plugin-first flow installs the local client package before authentication, then opens a browser when the plugin first connects.

The workflow remains self-hosted and local: Claude Code, Codex, and other tested desktop clients launch the CLI through stdio, and the CLI calls the configured Kintsugi HTTPS installation. Hosted clients that cannot launch the local process need a separately reachable MCP service and are outside this decision.

## Decision

1. Keep the CLI and local stdio MCP bridge as the client transport. Installing the generated project plugin requires no credential and stores only the canonical Kintsugi URL and selected project ID in its local profile/package.
2. On first use, the CLI opens the configured Kintsugi installation in the system browser. After normal Kintsugi sign-in and explicit project consent, use authorization code with S256 PKCE and a temporary loopback callback restricted to the exact registered URI and client state.
3. After browser sign-in and project approval, Kintsugi issues a five-minute access token that the CLI uses to fetch project data, plus a rotating refresh credential. Store only credential hashes and connection metadata on the server; store the refresh credential in the OS credential store and access tokens in CLI memory only. Fail closed when the secure store is unavailable.
4. Let an administrator choose a 15- or 30-day maximum connection age, defaulting to 15 days. Measure the cap from the initial consent; evaluate the current cap on refresh. Raising the cap never revives a revoked connection.
5. Bind each connection to the explicitly consented project IDs. Recheck member status, `member.read`, and live Project Access on every request. New Project Access does not expand a connection without renewed consent.
6. Stop issuing new manual personal access tokens for this workflow. Existing tokens remain usable only until their recorded expiry or revocation and remain subject to current authorization checks.
7. Let developers review/revoke their own connections. Let administrators with `security.manage` review/revoke all connections from Settings → Security, without exposing credential material.
8. Keep the MCP tools read-only. The developer's selected harness uses its normal GitHub credentials to create branches and PRs; Kintsugi observes provider events. Never issue GitHub credentials through this connection.
9. Use configured `KINTSUGI_PUBLIC_URL` as the canonical installation URL. Do not derive it from the request Host header. Preserve local HTTP for loopback development and require HTTPS for non-loopback installations.
10. Let the CLI revoke its connection during logout by presenting its current refresh credential to a dedicated revocation endpoint; do not require a browser session for local logout.

## Options Considered

### Option A: Keep manual personal access tokens

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| User setup | Poor: create, copy, paste, then install |
| Expiry policy | Fixed token expiry; no renewable connection lifetime setting |
| Local client fit | Works with stdio, but leaves a manual secret handoff |

**Pros:** Minimal changes; current clients already support bearer tokens.

**Cons:** Keeps the setup friction the user asked to remove; does not provide browser consent or a centrally controlled renewable connection lifetime.

### Option B: Local browser authorization code with PKCE — selected

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| User setup | Install plugin, sign in once in the browser, approve project |
| Expiry policy | Central 15/30-day connection age plus short access tokens |
| Local client fit | Uses the existing CLI and stdio MCP architecture |

**Pros:** No manual token creation or paste; explicit project consent; central revocation and expiry; no public MCP listener is required.

**Cons:** Browser and CLI must be able to reach the same installation and local loopback callback; secure OS credential storage is required for renewal.

### Option C: Remote MCP with server-side OAuth

| Dimension | Assessment |
|---|---|
| Complexity | High |
| User setup | Client-specific remote server and OAuth configuration |
| Expiry policy | Central OAuth session controls |
| Local client fit | Requires a reachable remote MCP service |

**Pros:** Supports hosted clients that cannot start local processes.

**Cons:** Adds deployment reachability, remote transport, discovery, and client compatibility requirements unrelated to the local plugin-first flow.

## Trade-off Analysis

Option B changes the authorization protocol but preserves the approved local transport and read-only tool contract. It puts the user-visible sign-in where the developer expects it, after plugin installation, while Kintsugi retains project consent, authorization checks, policy expiry, and revocation. It still requires a pinned CLI distribution before general users can install the generated command; package publication is a release prerequisite, not part of the local implementation.

## Consequences

- The local plugin can be installed before any Kintsugi credential exists.
- The first connection requires a browser and a working loopback callback; if the local browser cannot be opened, the CLI prints a URL for same-machine manual opening and otherwise fails with an actionable error. Remote device authorization is separate future work.
- Administrators can set and revise the maximum connection age without changing the browser-session lifetime.
- A refresh token must be rotated safely, and credential-store failures must not leak secrets or corrupt MCP stdout.
- CLI logout revokes the connection server-side before deleting its locally stored refresh credential.
- Existing personal tokens need a compatibility window bounded by their original expiry/revocation; the UI and API stop issuing new ones.
- The existing accepted product-flow and PR-observation decisions remain in force. Remote MCP and hosted-agent support stay separate future work.

## Action Items

1. [x] Add the 15/30-day policy, connection records, authorization codes, and migration-backed `security.manage` permission.
2. [x] Implement browser consent, PKCE callback validation, short access tokens, refresh rotation, and per-request Project Access checks.
3. [x] Implement no-auth project plugin installation, browser first-use sign-in, and OS secure-store persistence. Authenticated native-client interaction remains a release gate.
4. [x] Replace manual token issuance UI with generated install and connection revocation surfaces; keep older personal tokens visible only for migration and revocation.
5. [x] Probe native package install and removal in disposable Claude Code and Codex profiles. [ ] Verify first-use browser authorization and an authenticated MCP call from each real client, then retain GitHub PR evidence as a separate provider pilot gate.
