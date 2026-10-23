# Codex Desktop installation for Coding Agent Workflow

- Date: 2026-10-22
- Status: Approved direction; implementation and local verification in progress
- Related decisions: ADR-0052, ADR-0056, and accepted ADR-0057, which amends ADR-0052 decisions 1 and 6

## Outcome

A developer who uses Codex Desktop can install the Kintsugi Coding Agent Workflow plugin from the app’s Plugins Directory, then use it in a normal local Codex session. The Kintsugi CLI prepares the local package and marketplace entry; Codex Desktop owns the final install and enable action. The developer does not run Codex CLI commands to install the plugin.

The plugin keeps the existing local stdio MCP transport and browser sign-in flow. It works with a local Docker Kintsugi installation because Codex runs the local CLI bridge on the developer’s computer. Kintsugi MCP stays read-only; the AI uses its normal repository access to create a PR, and Kintsugi observes the PR through its configured GitHub provider.

## User flow

1. In Kintsugi’s Developer Documents → Coding Agent Workflow page, the developer chooses Codex Desktop and copies the generated package-preparation command. The portal already supplies the installation URL and project ID.
2. The developer runs the Kintsugi CLI prerequisite once. Its desktop-ui install mode saves only the nonsecret Kintsugi profile, writes the Codex plugin package below the user’s personal marketplace directory, and merges one Kintsugi entry into the local marketplace catalog. It does not invoke Codex CLI or store credentials.
3. The developer restarts Codex Desktop, opens Plugins, selects the local Kintsugi marketplace, reviews the Coding Agent Workflow plugin, and installs it.
4. In a new local Codex conversation, the first Kintsugi MCP request starts the local CLI bridge and opens browser sign-in. Kintsugi shows the project and read scope, checks Project Access, and issues short-lived access plus rotating refresh credentials under the administrator’s connection-age policy.
5. The developer asks Codex about tasks, designs, standards, evidence, and status. Codex reads the cited context, then uses its normal coding and GitHub tools to implement and open a PR.
6. Kintsugi observes the PR and exposes current review findings and task progress through the same read-only MCP tools.

The package contains the canonical skill and a client manifest that starts the exact installed Kintsugi CLI entry point. Codex shows a readable project-specific plugin label in its Plugins Directory. The profile and marketplace contain no bearer, refresh, or GitHub token.

## Installation layout

Use Codex’s documented personal local marketplace:

- Marketplace catalog: user home / .agents / plugins / marketplace.json
- Generated package: user home / .codex / plugins / profile-specific-plugin-name
- Codex marketplace source path: ./.codex/plugins/profile-specific-plugin-name, resolved from the user's home directory
- Kintsugi profile: the existing platform-specific Kintsugi CLI configuration path
- Refresh credential: the existing operating-system credential store

The marketplace update is additive and idempotent. Codex's documented personal-marketplace example uses `./.codex/plugins/<profile-specific-plugin-name>` for the package in `~/.codex/plugins/`, while the catalog lives in `~/.agents/plugins/marketplace.json`. Preserve unrelated marketplace metadata and entries, update only the Kintsugi entry with the same stable profile identity, and fail closed on malformed catalogs, a conflicting entry, or a symlinked target. Verify the resolved source remains inside the user home and points to the dedicated Kintsugi-owned package. Never write plugin files into the developer’s code repository.

The app UI route is Codex Desktop first. Existing Codex CLI automation remains available as a separate install mode. Claude Code continues to use its own plugin format and current setup route; Claude Desktop Chat connectors and local desktop extensions remain separate adapters. Do not claim a Claude Desktop UI install path until its marketplace/bootstrap flow is validated with that client.

## Portal behavior

The Coding Agent Workflow guide must:

- Show Codex Desktop as the app-UI route and explain the one-time Kintsugi CLI prerequisite.
- Give one generated command with the current Kintsugi URL and project ID; do not ask the developer to type either value.
- Separate package preparation from the app’s install action: “Prepare marketplace” is the CLI step, “Install plugin” is the Codex Desktop step.
- Give the exact post-preparation UI path and explain that Codex Desktop must restart to discover the personal marketplace.
- Explain first-use browser sign-in, consent scope, 5-minute access token, OS credential storage, and 15/30-day administrator policy.
- Retain the existing CLI installation path as an alternative and identify Claude Code as a separate target.
- Say that local/private Kintsugi works through stdio; cloud-hosted AI surfaces cannot reach a localhost MCP endpoint.

## Security and failure behavior

- Keep the profile limited to a validated canonical URL, project ID, and profile identity. No access, refresh, or GitHub credential is written to the marketplace or plugin package.
- Reuse the existing browser authorization, PKCE, secure credential store, refresh rotation, per-request member.read and Project Access enforcement, revocation, and connection lifetime.
- For the personal marketplace update, reject symbolic links, malformed JSON, invalid marketplace structures, duplicate conflicting plugin IDs, and resolved package paths outside the user home. Use atomic writes and preserve every unrelated marketplace entry.
- If package staging succeeds but marketplace update fails, report the exact generated package directory and safe cleanup instructions; do not report the plugin as ready.
- Keep MCP protocol output on stdout and diagnostics on stderr.
- Do not expose any Git provider credential through Kintsugi OAuth or MCP.

## Validation and release boundary

Automate profile-specific package generation, Codex manifest and marketplace schema checks, additive/idempotent marketplace updates, conflict and symlink rejection, and CLI tests proving desktop-ui mode never invokes Codex CLI. Run the existing local stdio OAuth and context smoke against synthetic fixtures. Verify portal copy and generated command.

A real Codex Desktop install, first-use browser consent, and authenticated MCP request are a separate client pilot. Do not call them live-validated until the plugin is selected and used from Codex Desktop. Claude Code, Claude Desktop Chat, GitHub Enterprise Server, and other providers require their own client/provider tests.

## Official references reviewed on 2026-10-22

- Codex plugin packaging and local marketplace layout: https://developers.openai.com/plugins/build/plugins
- Codex plugin authentication configuration: https://developers.openai.com/plugins/build/auth
- Codex local plugin testing: https://developers.openai.com/plugins/deploy/connect-chatgpt
- Claude Code Desktop: https://code.claude.com/docs/en/desktop
- Claude Code plugin installation: https://code.claude.com/docs/en/plugins/install
- Claude remote MCP connector network requirements: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
