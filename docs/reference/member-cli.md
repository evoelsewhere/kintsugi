# Member CLI and local MCP bridge

Status: the typed client, the CLI, the local stdio MCP bridge, the generated Kintsugi connector plugin, browser authorization, rotating credentials and the connection-age policy are implemented in the unreleased workspace. Native setup is enabled only for the exact Claude Code and Codex CLI versions listed in the [compatibility evidence](member-client-compatibility.md); authenticated native MCP calls remain a release gate.

The CLI and the MCP bridge are the **common base** between a member's own AI client (Claude Code, Codex, Copilot, ChatGPT) and Kintsugi ([ADR-0069](../decisions/0069-common-member-base-and-plugin-distribution.md)): sign-in, project access and document reads. They know no stage, task or review; flows are added by member plugins, which Kintsugi distributes, permits and monitors. The CLI does not call a model, inject text into an existing conversation or do any coding work.

## Build and run from the workspace

The package is not published. From the repository root:

```sh
corepack pnpm --filter @kintsugi/cli... build
pnpm kintsugi --help
```

The root `kintsugi` script runs the compiled package. After the CLI is published and installed, use `kintsugi` directly. It requires Node.js 22.19 or newer.

## Install the connector plugin

From the project page in the portal, copy the generated command. For a published CLI it looks like this:

```sh
kintsugi plugins setup --harness claude-code --url https://kintsugi.example.internal --project modernization
```

The command needs no Kintsugi token. It records a nonsecret local profile, generates a Kintsugi-owned package (the MCP server entry of the selected client, plus the Kintsugi marks for Codex) and installs it with the client's native plugin command. It refuses to overwrite unowned files or follow symbolic links; re-run it to update the package. Start a new client session afterwards. For Codex Desktop, `--install-mode desktop-ui` stages a personal marketplace that you finish installing in the app.

Setup checks the exact client version before writing; see the [compatibility evidence](member-client-compatibility.md). The package contains no skill and no hooks: the connector only starts the local MCP bridge. Plugins that carry flows are installed next to it.

## Sign in on first use

When the AI first needs Kintsugi, the local MCP bridge opens the system browser. Sign in, review the requested project and approve it. The browser returns a short-lived authorization code to the CLI over a temporary loopback callback and the CLI exchanges it with PKCE; nobody creates or pastes a token. Kintsugi issues a five-minute access token and a rotating refresh credential. The access token stays in CLI memory and the refresh credential in the operating system credential store. The administrator's 15- or 30-day maximum connection age (Settings → Security) controls when consent is required again, and connections can be revoked in the portal.

```sh
kintsugi auth login --url https://kintsugi.example.internal --project modernization --profile work
kintsugi auth status --profile work
kintsugi project list --profile work
kintsugi project use modernization --profile work
```

The profile JSON holds the installation URL and project ID, never credential material. `--token-stdin` accepts only an existing legacy token. Use one profile per installation. `auth logout` revokes the connection at Kintsugi before removing the local credential. Installation URLs cannot contain credentials, a query or a fragment; remote installations require HTTPS (HTTP only for loopback). A private certificate authority is added with `--ca-file`; redirects are blocked so a bearer token is never forwarded to another origin.

Windows and macOS use the native credential store through the pinned keyring binding. Linux uses `secret-tool` directly and fails closed when Secret Service is missing; install `libsecret-tools` and a provider such as GNOME Keyring or KWallet first.

## Read projects and documents

```sh
kintsugi project list
kintsugi document tree 01-standards
kintsugi document get 01-standards/conventions/typescript.md --ref refs/heads/main
```

`--project` selects one command's project; otherwise the profile default from `project use` applies. Every request is authorized again by the API: the token's project scope, the member's `member.read` permission and explicit Project Access. Documents come from the project's document repository mirror ([ADR-0028](../decisions/0028-remove-rulebook-single-document-repo.md)), read-only, at a branch or commit (default branch when `--ref` is omitted); `restricted/` and `.git` are never served and files over 2 MiB are refused. Lists use cursor pagination (`--cursor`, `--limit` 1–100). Output supports `--format text|json|markdown`; `--json` is an alias. Results go to stdout, errors to stderr, and `--no-input` disables prompts.

## Install member plugins

A member plugin (`audience: member`) carries a flow for the member's own AI client, as skills, agents and commands. Kintsugi offers it to a project's members (Project → Member plugins, `plugin.access.manage`); the CLI installs it:

```sh
kintsugi plugins list                                  # what you may install, and what is installed
kintsugi plugins install context --harness claude-code
kintsugi plugins remove context --harness claude-code
```

`install` downloads the plugin from the installation, checks every file against its SHA-256 and the bundle against its content hash, writes the files into the Kintsugi package of the client next to the connector, and re-runs the client's native plugin commands. Re-running it updates the plugin and deletes the files the new version no longer carries; `remove` deletes exactly the files the plugin put there. A record (`.kintsugi-plugins.json`) in the package keeps which plugin owns which files, and two plugins cannot write the same file. Claude Code receives skills, agents and commands; Codex receives skills. Start a new client session afterwards. Hooks, scripts, workflows and MCP entries are never distributed: a plugin is text the AI reads. Installing needs `--harness`, a signed-in profile and the exact client versions listed in the [compatibility evidence](member-client-compatibility.md); Codex Desktop's staged install does not carry plugins yet.

The built-in `context` plugin is the first one: a skill that reads the project's documents through the tools below, answers with citations and records what it did.

## Record activity

```sh
kintsugi activity record result --plugin context --summary "Reviewed the standards" --detail documents=3
```

This is the only write of the base. It adds one record to the project's monitoring (Monitoring → Members): a `kind` (not `plugin.*` or `document.*`, which Kintsugi sets itself), the plugin it belongs to (one you may use), a summary of at most 500 characters and up to 20 scalar details. Never put document content, credentials or personal data in it. At most 600 records an hour per member; the worker deletes records after `KINTSUGI_TELEMETRY_RETENTION_DAYS` (30 by default). The request is sent once and never retried, so a lost response cannot record twice. Kintsugi also records, without the plugin asking, each plugin download and each document read.

## Serve the local MCP bridge

```sh
kintsugi mcp serve --profile work
```

The bridge has no inbound listener. It uses the selected profile and refreshes credentials as needed, so the installation can revoke access between tool calls; without a credential it opens browser sign-in. Stdin and stdout carry only MCP messages (`--token-stdin` is rejected for that reason) and diagnostics go to stderr. Each tool call names its project; `mcp serve --project` is rejected so a connection holds no hidden project context.

| Tool | Result |
|---|---|
| `project_list` | Projects the member's connection covers and may read |
| `document_tree` | A directory of the document repository at a branch or commit |
| `document_get` | A Markdown file of the document repository |
| `plugin_list` | The member plugins the member may install in a project |
| `activity_record` | Records one bounded note for the project's monitoring (the only tool that is not read-only) |

Plugins add their own commands and skills on top of this set.

## Current limits

The CLI and the bridge cannot change a project, a document or a repository; their one write is the activity record. `doctor` checks the runtime, the profile credential and an authorized API read; it does not certify support for a Claude Code, Codex or Copilot version.
