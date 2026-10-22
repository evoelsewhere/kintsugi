# Plugin-first authentication for Coding Agent Workflow

- Status: Implemented locally; live client/provider pilot open (22 October 2026)
- Date: 2026-10-22
- Supersedes the authentication sequence in the current member-access design only after approval. It preserves the accepted local stdio transport and Project Access boundaries.

## Problem

The current setup asks a developer to create a project token in the portal, copy it into a CLI login prompt, and only then install the coding-agent plugin. That reverses the expected install flow, exposes a one-time secret to the developer, and makes an admin policy such as a 15- or 30-day connection lifetime difficult to apply consistently.

## Recommended experience

1. An administrator chooses the maximum Coding Agent Workflow connection lifetime in **Settings → Security**. Offer 15- and 30-day choices, default to 15 days, and explain that the limit controls how long the connection can renew before sign-in is required.
2. From a project's Coding Agent Workflow page, the developer selects **Install for Claude Code** or **Install for Codex** and copies one generated install command. Kintsugi fills in the selected client, project ID, and configured canonical URL.
3. The developer runs that command once using the installed Kintsugi CLI. The CLI creates a nonsecret profile, generates the project-specific local plugin package, and registers/enables it through that client's native plugin mechanism. No URL or token is typed by the developer. The local package contains only the Kintsugi URL and project identifier, never a credential. Install the CLI once from a pinned Kintsugi release; do not assume the current private workspace package is already available from npm.
4. On first MCP connection, the local launcher detects that it has no valid credential and opens Kintsugi sign-in in the browser using authorization code with PKCE and a loopback callback. The developer signs in with their normal Kintsugi account and confirms the named project. Kintsugi then issues a five-minute access token for project-data requests and a rotating refresh token; the CLI keeps the access token in memory and stores the refresh token in the OS credential store. No PAT is created in the portal or copied into a prompt. If the browser cannot be launched automatically, print the authorization URL on stderr so the developer can open it on the same machine. If a local browser/callback is unavailable, fail with an actionable error; a remote device-code flow is out of scope.
5. The MCP tools read the selected project's authorized tasks, documents, status, reviews, and events. The server checks member status, read permission, and current Project Access on every request, and intersects current Project Access with the project IDs explicitly granted to that connection. Newly accessible projects require renewed consent; access removal or revocation blocks the next request.
6. The developer asks their AI to explain the task, design, standards, and evidence; works in the repository with the AI's normal GitHub access; and creates a PR. Kintsugi observes the PR and advances its existing workflow. The Kintsugi MCP connection never writes to the repository or GitHub.
7. At the configured maximum connection age, Kintsugi refuses refresh and the plugin asks the developer to sign in again. The developer can revoke their own connection, and an administrator can review and revoke any connection earlier from Settings → Security.

## Authentication and expiry semantics

The plugin/CLI initiates authentication; it does not mint credentials. Kintsugi issues credentials only after the member signs in and approves the project scope. The access token is used to fetch authorized Kintsugi project data and lasts five minutes. A rotating refresh token is stored securely by the CLI to obtain later access tokens. The admin setting caps the entire connection age at 15 or 30 days; after that the member signs in again. It is not the five-minute access-token lifetime. Measure age from the original authorization. If an administrator lowers the cap, the next refresh evaluates existing connections against the new cap. Revoked connections remain revoked if the cap is later extended.

Store only credential hashes and revocation/session metadata server-side. Bind credentials to this Kintsugi installation, the Coding Agent Workflow read scope, and explicit project IDs. Do not place task or authorization decisions solely in credential claims. Never grant GitHub write access through this Kintsugi connection; the developer's chosen harness continues to use its existing GitHub authentication.

Stop issuing new manual personal access tokens for this workflow when the browser connection flow is available. Keep previously issued tokens valid only until their original expiry or revocation, and continue enforcing member status, `member.read`, and live Project Access on every request. The new 15/30-day connection-age policy applies to browser-authorized connections; it does not extend or shorten an existing token's recorded expiry.

## Installation mechanism

A static plugin cannot know the base URL of every self-hosted Kintsugi instance. Use the portal's project-scoped **Install** action to generate a single command such as `kintsugi plugins setup --harness claude-code --project <project-id> --url <configured-url>`. The installed CLI creates the local profile and plugin package, then registers/enables the package with the selected client. The browser page does not claim to write files or install the client plugin directly. The only command parameters come from the Kintsugi page; the developer does not manually enter the URL or project ID. Provide a separate one-time link to the pinned CLI release for users who do not have the CLI installed. The current repository package is private, so do not present `npx @kintsugi/cli` as installable until a distribution artifact exists.

Use the existing `KINTSUGI_PUBLIC_URL` deployment setting as the canonical installation URL. Do not derive OAuth or API URLs from an untrusted `Host` header. For the local Docker pilot, local coding-agent clients connect to Kintsugi through stdio and the CLI, so no public HTTPS endpoint or remote OAuth discovery is required. WSL or remote-container clients need a URL reachable from both the CLI environment and the browser. A non-loopback deployment must use HTTPS. Hosted coding agents that cannot launch local stdio remain out of scope until Kintsugi offers a reachable remote MCP endpoint.

MCP stdout remains protocol-only. Browser/login progress, errors, and headless instructions go to stderr. The launcher must return a clear cancellation/timeout error if sign-in is abandoned, without corrupting the MCP session.

## Admin setting

Add an installation-level setting for maximum Coding Agent Workflow connection lifetime under **Settings → Security**. Initial options: 15 or 30 days; default to 15. Restrict changes to the existing security-settings permission. Record policy changes and connection revocation in the audit trail. Keep this setting separate from the existing browser session lifetime and describe their different effects.

## Scope and preserved decisions

This changes the manual PAT issuance and login order; it does not replace the current CLI/local-stdio architecture. The authorization protocol change requires a new ADR that amends the auth decision in ADR-0052; do not rewrite that accepted ADR. Preserve Project Access, per-request authorization, task/document snapshot rules, read-only MCP tools, and the existing GitHub PR observation flow.

Not included: Kintsugi's own assistant, task claims or writes, approval or merge actions, GitHub credentials issued by Kintsugi, public cloud hosting, GitLab/Bitbucket adapters, or support claims for hosted AI surfaces that cannot reach the local stdio process.

## Verification plan

- Install the CLI once, then run the generated project command to install/enable the native plugin before authenticating on Claude Code and Codex; neither step requires manual URL entry or portal token creation.
- Verify first connection launches browser sign-in, loopback PKCE state, callback validation, issuer/installation binding, token expiry, refresh rotation, and cross-installation credential rejection.
- Verify headless login provides usable instructions on stderr and that no login text leaks to MCP stdout.
- Verify a connection granted for Test cannot read a second project even if that member later receives Project Access to it; renewed consent is required to add project scope.
- Verify 15-day and 30-day policies; reject refresh after the configured cap; shortening the cap blocks renewal on existing connections; extending the cap does not revive revoked connections.
- Verify revocation, member disablement, and Project Access removal deny the next request despite an otherwise valid access token.
- Verify unauthenticated users see no task/document data, authorized users receive only selected project context, and every MCP tool remains read-only.
- Verify native plugin install/remove/update for supported Claude Code and Codex versions, credential storage in the OS secure store, and the local Docker URL path.
- Verify the end-to-end path: read task/design/evidence, implement in the repository using normal harness GitHub credentials, open a PR, then observe PR/review/status in Kintsugi.

## Review decision

The user approved the plugin-first flow on 22 October 2026. Local implementation is complete on `feature/coding-agent-workflow-mcp`; API/worker integration, synthetic public-process smoke, package tests, lint, typecheck and build have passed. Authenticated first-use MCP calls from a live Claude Code/Codex client and a live GitHub/GHES PR pilot remain open. The approved scope covers browser sign-in, project-scoped read access, administrator-controlled connection lifetime, and plugin-first setup; release publication and installation into the user's ordinary AI profile remain separate actions.
