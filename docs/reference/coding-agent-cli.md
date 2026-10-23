# Coding Agent Workflow CLI

Status: the typed client, read-only CLI, local stdio MCP bridge, generated Coding Agent Workflow packages, browser authorization, rotating credentials, connection-age policy, SSE replay, `task watch`, review findings retrieval and effective workflow continuation are implemented in the unreleased workspace. The local public-process smoke covers the API/worker OAuth and context path; release validation remains open for authenticated native MCP calls, authenticated GitHub/GHES provider flows, real provider/model behavior, crash recovery, rollback and upgrade. Native setup is enabled only for exact Claude Code and Codex CLI versions recorded in the [compatibility evidence](coding-agent-workflow-compatibility.md).

Install the project plugin before signing in. The plugin setup command records only the Kintsugi installation URL and project ID, generates a local package, and installs it with the selected AI client's native plugin command. On the first MCP connection, the CLI opens Kintsugi in a browser for sign-in and project consent. The CLI keeps short-lived access tokens in memory and a rotating refresh credential in the operating system credential store. The chosen AI reads Kintsugi context; the developer and AI implement changes and create a PR using their normal coding tools. Kintsugi can then observe the PR, provide review findings, and stream task events. The CLI does not call a model, inject text into an existing conversation, or perform the coding work.

## Build and run from the workspace

The package is not published. From the repository root, build its workspace dependencies and use the short workspace command:

```sh
corepack pnpm --filter @kintsugi/cli... build
pnpm kintsugi --help
```

The root `kintsugi` script runs the compiled package. After the CLI is published and installed, use `kintsugi` directly from any directory.

For this unpublished workspace preview, use `pnpm kintsugi` for the commands below.

The CLI requires Node.js 22.19 or newer. Native client and operating-system compatibility still needs a release matrix before claiming support.

## Install the project plugin

From the project’s Coding Agent Workflow section in the portal, copy the generated command. For a published CLI, it looks like this:

```sh
kintsugi plugins setup --harness claude-code --url https://kintsugi.example.internal --project modernization
```

The command needs no Kintsugi token. It creates a nonsecret local profile and Kintsugi-owned package, then invokes the selected AI client's native plugin commands. It refuses to overwrite unowned package files or follow symbolic links. Re-run the command to update the package. Start a new AI client session after setup so it loads the plugin.

The CLI requires Node.js 22.19 or newer. Setup checks the exact client version before writing. Claude Code 2.1.278 and Codex CLI 0.163.0-alpha.10.2 passed disposable-profile marketplace and plugin lifecycle probes. Copilot CLI package generation is available to tests, but native setup is disabled until its exact client version is verified. These lifecycle probes have not exercised a live authenticated MCP call from either client.

For the unpublished workspace preview, build once from the Kintsugi repository root and prefix the generated command with `pnpm`:

```sh
corepack pnpm --filter @kintsugi/cli... build
pnpm kintsugi plugins setup --harness claude-code --url http://127.0.0.1:5173 --project modernization
```

Replace the URL with the configured Kintsugi API installation URL shown in the portal. A hosted portal and API may use different origins; the generated command must use the configured API URL. After the CLI is published and installed, use `kintsugi` directly.

## Sign in on first use

When the AI first requests Kintsugi context, its local MCP bridge opens the system browser. Sign in to Kintsugi, review the requested project, and approve it. The browser returns a short-lived authorization code to the CLI over a temporary loopback callback. The CLI exchanges it using PKCE; it does not ask you to create or paste a token. Kintsugi issues a five-minute access token and a rotating refresh credential. Access tokens stay in CLI memory; the refresh credential stays in the OS credential store. The administrator's 15- or 30-day maximum connection age controls when consent is required again.

The profile JSON contains the installation URL and project ID, never credential material. To connect a profile for direct CLI commands without using the plugin, sign in explicitly:

```sh
kintsugi auth login --url https://kintsugi.example.internal --project modernization --profile work
kintsugi auth status --profile work
kintsugi project list --profile work
kintsugi project use modernization --profile work
```

`auth login` also uses browser authorization. A one-shot `--token-stdin` is supported only for existing legacy tokens during migration; it does not accept new OAuth access or refresh credentials. Use a separate profile for each installation. `auth logout` revokes the browser-authorized connection at Kintsugi before removing the local refresh credential. Installation URLs cannot contain credentials, query parameters, or fragments. Remote installations require HTTPS; HTTP is allowed only for loopback.

`project use` follows project-list cursors (up to 100 pages of 25 projects) before saving the local default. If that bound is reached, it reports `PROJECT_LOOKUP_LIMIT_EXCEEDED` and does not save an unverified project.

Windows and macOS use the native credential store through the pinned keyring binding. Linux uses `secret-tool` directly so the CLI uses Secret Service and fails closed when it is missing; it does not fall back to Linux kernel keyutils. Install `libsecret-tools` and configure a Secret Service provider such as GNOME Keyring or KWallet before signing in. The Linux native-store path has not yet been exercised on a supported desktop release matrix.

For a private certificate authority, provide a PEM bundle when logging in:

```sh
kintsugi auth login --url https://kintsugi.internal --project modernization --ca-file ./company-root.pem
```

The client adds that certificate to the normal trusted roots and retains hostname and TLS verification. It blocks redirects so a bearer token cannot be forwarded to another origin.

## Retrieve tasks and context

Project selection is local convenience only. Every request still uses the selected profile's current API authorization. A unit is always identified as `application/module/unit`.

```sh
kintsugi task list --mine --ready-for implementation
kintsugi task brief billing/invoices/tax --activity implementation
kintsugi task brief billing/invoices/tax --format markdown --output ./task-brief.md
kintsugi document get billing/invoices/tax --snapshot ctx_123 --source src_design --section sec_rounding
kintsugi document search billing/invoices/tax --snapshot ctx_123 --query rounding
kintsugi task status billing/invoices/tax
```

The default project comes from `project use`; `--project` selects one command's project. Task brief defaults to implementation and prints readiness blockers. A partial brief keeps every omitted section in its JSON and Markdown output. Follow-up document calls must use its snapshot ID and registered source IDs, so a newer branch revision cannot silently replace the original brief.

Lists use cursor pagination; pass `--cursor` to continue and `--limit` to control page size (1–100). Output supports `--format text|json|markdown`; `--json` is an alias. Results go to stdout, errors to stderr. `--no-input` disables prompts. `--output` writes a new file only and refuses to overwrite an existing destination. POSIX exports use mode `0600`; Windows exports remove inherited ACLs and grant the current user modify access.

## Retrieve review findings

```sh
kintsugi review list --task billing/invoices/tax
kintsugi review get review_123 --project modernization --json
```

`review list` reads the authorized current review IDs from task status. `review get` requires an explicit `--project`, even when the profile has a default project. It returns the immutable report's reviewed revisions, currentness, verdict, coverage and findings, including rationale, repair guidance and source citations. Check currentness before acting on an older report. The chosen AI can retrieve the same report through the read-only `review_get` MCP tool and use its own coding tools to make a fix.

## Watch task events

```sh
kintsugi task watch billing/invoices/tax --profile work
kintsugi task watch billing/invoices/tax --project modernization --limit 10 --json
kintsugi task watch billing/invoices/tax --after-event-id evt_123 --json
```

Watch uses the profile's default project unless `--project` overrides it. It follows continuously when `--limit` is omitted; an explicit limit of 1–1000 counts delivered events across reconnections and exits successfully when reached. Ctrl+C or SIGTERM closes this subscription and exits cleanly. Neither action cancels server-side work.

JSON watch output is newline-delimited JSON: one compact event object per line. Text and Markdown show each event's ID, kind, time, task identity and metadata. Results go to stdout, errors to stderr; heartbeat comments produce no output. Watch runs independently of the ordinary request timeout.

If the server closes a stream before the limit is reached, the client retries from the last delivered event ID, reloads the selected profile's credential and requests only the remaining event count. It also resumes after an interrupted connection. Retries are bounded; if recovery fails, the `NETWORK_ERROR` details include the last cursor as `afterEventId` when one exists. Use that value with `--after-event-id` to resume manually. A stream ending before the requested count does not mean the task completed.

The first watch without a cursor replays retained task events. Events replay over authorized SSE for seven days. An expired, malformed or task-mismatched cursor returns `MEMBER_EVENT_CURSOR_EXPIRED`; fetch current `task status` and start a new watch without the old cursor. The stream rechecks the token, `member.read` permission and Project Access while connected. Watching does not trigger provider reconciliation or workflow continuation.

## Serve the local MCP bridge

Start a local stdio server for a compatible coding agent:

```sh
kintsugi mcp serve --profile work
```

The bridge has no inbound network listener. It uses the selected installation profile and refreshes credentials as needed, so the installation can revoke access between tool calls. If there is no credential, the bridge opens browser sign-in using the project's nonsecret profile settings. Stdin and stdout are reserved for MCP messages; diagnostics use stderr. The `--token-stdin` option is not accepted by `mcp serve` because it would consume the MCP protocol stream.

Each tool call supplies its own project and task identity. `mcp serve --project` is rejected so a connection cannot retain hidden project context. `task_brief` returns a snapshot ID; `document_get` and `document_search` require that ID explicitly. The tools do not edit tasks, documents, or repositories; `task_brief` creates a temporary context snapshot retained for 24 hours. The selected AI reads the returned documents and answers the developer; the CLI does not inject a prompt into an already-running AI conversation.

## Current limits

The CLI and its MCP bridge cannot claim, assign, edit, approve, merge or otherwise mutate a Kintsugi task or repository. PR creation and repair stay in the developer's chosen coding tools; human decisions and workflow continuation stay in Kintsugi's authorized workflow.

`doctor` checks the runtime, profile credential availability and an authorized API read. It does not certify support for a Claude Code, Codex or Copilot version; those require native setup and interaction tests.
