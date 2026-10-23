# Member CLI and local MCP bridge

Status: the typed client, the CLI, the local stdio MCP bridge, the generated Kintsugi connector plugin, browser authorization, rotating credentials and the connection-age policy are implemented in the unreleased workspace. Native setup is enabled only for the exact Claude Code and Codex CLI versions listed in the [compatibility evidence](member-client-compatibility.md); authenticated native MCP calls remain a release gate.

The CLI and the MCP bridge are the **common base** between a member's own AI client (Claude Code, Codex, Copilot, ChatGPT) and Kintsugi ([ADR-0069](../decisions/0069-common-member-base-and-plugin-distribution.md)): sign-in, project access and document reads. They know no stage, task or review; flows are added by member plugins, which Kintsugi distributes, permits and monitors. The CLI does not call a model, inject text into an existing conversation or do any coding work.

## Install the CLI

The installation serves the CLI itself ([ADR-0070](../decisions/0070-cli-distributed-by-the-installation.md)). The portal page **Guideline** (`/guideline`) shows these commands with the installation's own URL, and lists the packages for a manual install:

```sh
curl -fsSL https://kintsugi.example.internal/api/v1/releases/latest/install.sh | sh
```

```powershell
powershell -ExecutionPolicy Bypass -Command "irm https://kintsugi.example.internal/api/v1/releases/latest/install.ps1 | iex"
```

The installer needs Node.js 22.19 or newer. It downloads the package of the platform (Linux, macOS or Windows; x64 or ARM64) from the installation, checks it against the SHA-256 written into the installer, unpacks it into `~/.kintsugi` (`%LOCALAPPDATA%\Kintsugi` on Windows; `KINTSUGI_HOME` changes it), writes `install.json` with the installation's URL so the CLI needs no `--url`, and prints the PATH line to add (Windows adds the `bin` folder to the user PATH itself). Running it again updates the CLI in place at the same path, so the generated client packages keep working. A package can also be downloaded from the Guideline, unpacked and put on the PATH by hand. `kintsugi --version` verifies it.

The installation builds the packages with its image (`pnpm release:cli`, run by `Dockerfile.app`) into `KINTSUGI_RELEASES_DIR` and serves `GET /api/v1/releases/latest` (version, minimum Node.js, a package per platform with SHA-256 and URL), `latest/install.sh`, `latest/install.ps1` and `<version>/<file>`. These routes are public only because `curl` and PowerShell cannot sign in; the packages prove themselves by their hashes.

From the workspace, `pnpm --filter @kintsugi/cli... build` and `pnpm kintsugi --help` run the compiled package.

## Connect an AI client

```sh
kintsugi connect claude my-project
```

`connect <claude|codex|codex-desktop> [project]` records a nonsecret local profile (the first one becomes the default), generates a Kintsugi-owned package (the MCP server entry of the client, plus the Kintsugi marks for Codex) and installs it with the client's native plugin commands. The URL comes from `--url`, `KINTSUGI_URL`, the default profile or `install.json`, in that order. The output is one line; `--verbose` lists the files written and the commands run. `kintsugi plugins setup --harness <client> --url <url> --project <id>` is the long form, always verbose. Setup refuses to overwrite unowned files or follow symbolic links; re-run it to update the package. Start a new client session afterwards. `codex-desktop` stages a personal marketplace that you finish installing in the app.

Setup checks the exact client version before writing; see the [compatibility evidence](member-client-compatibility.md). The package contains no skill and no hooks: the connector only starts the local MCP bridge. Plugins that carry flows are installed next to it.

## Sign in on first use

When the AI first needs Kintsugi, the local MCP bridge opens the system browser. Sign in, review the requested project and approve it. The browser returns a short-lived authorization code to the CLI over a temporary loopback callback and the CLI exchanges it with PKCE; nobody creates or pastes a token. Kintsugi issues a five-minute access token and a rotating refresh credential. The access token stays in CLI memory and the refresh credential in the operating system credential store. The administrator's 15- or 30-day maximum connection age (Settings → Security) controls when consent is required again, and connections can be revoked in the portal.

```sh
kintsugi login modernization        # same as: kintsugi auth login --project modernization
kintsugi auth status
kintsugi project list
kintsugi project use modernization
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
kintsugi plugins list     # what you may install, and what is installed
kintsugi add context      # install or update; add -H claude or -H codex when both are connected
kintsugi remove context
```

`add` (also `plugins install`) downloads the plugin from the installation, checks every file against its SHA-256 and the bundle against its content hash, writes the files into the Kintsugi package of the client next to the connector, and re-runs the client's native plugin commands. Re-running it updates the plugin and deletes the files the new version no longer carries; `remove` deletes exactly the files the plugin put there. A record (`.kintsugi-plugins.json`) in the package keeps which plugin owns which files, and two plugins cannot write the same file. Claude Code receives skills, agents and commands; Codex receives skills. Start a new client session afterwards. Hooks, scripts, workflows and MCP entries are never distributed: a plugin is text the AI reads. Installing needs a signed-in profile and the exact client versions listed in the [compatibility evidence](member-client-compatibility.md); Codex Desktop's staged install does not carry plugins yet.

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
