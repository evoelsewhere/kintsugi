# Coding Agent Workflow CLI

Status: the typed client, read-only CLI, local stdio MCP bridge and generated Coding Agent Workflow packages are implemented in the unreleased workspace. The SSE client, server event replay, `task watch` and review findings retrieval are implemented; effective workflow continuation remains in progress (T15 still has open implementation and verification items in the [implementation plan](../superpowers/plans/2026-10-20-kintsugi-coding-agent-workflow-implementation.md)). Native setup is enabled only for exact Claude Code and Codex CLI versions recorded in the [compatibility evidence](coding-agent-workflow-compatibility.md).

Authenticate a local profile, generate the package for the chosen AI client, and run the printed native install commands. The installed package configures a local MCP bridge that lets the chosen AI read Kintsugi context. The developer and that AI implement the changes and create a PR using their normal coding tools. The CLI can then retrieve review findings and watch durable task events. It does not call a model, inject text into an already-running conversation, or perform the coding work.

## Build and run from the workspace

The package is not published. From the repository root, build its workspace dependencies and launch the compiled entry point:

```sh
corepack pnpm --filter @kintsugi/cli... build
node packages/cli/dist/main.js --help
```

The CLI requires Node.js 22.19 or newer. Native client and operating-system compatibility still needs a release matrix before claiming support.

## Generate a client package

After signing in, generate the client-specific package for a tested client version:

```sh
kintsugi plugins setup --client claude --profile work
```

The command writes a Kintsugi-owned package below the selected profile's local configuration directory and prints native marketplace/install and removal commands. Run the printed commands to change the client installation. The CLI does not edit client settings or execute those commands. Re-running setup updates files only inside the marked Kintsugi-owned package. It refuses to overwrite an existing unowned package or follow symbolic links in the target path.

Setup checks the exact client version before writing. Claude Code 2.1.278 and Codex CLI 0.163.0-alpha.10.2 passed disposable-profile marketplace and plugin lifecycle probes. Copilot CLI package generation is available to tests, but native setup is disabled until its exact client version is verified. The probes have not yet exercised an authenticated plugin-launched MCP request against a live Kintsugi installation.

## Connect a profile

`auth login` asks for a hidden token when run in an interactive terminal. For automation, `--token-stdin` reads one line from standard input. Both login methods save the token only to the operating-system credential store; profile JSON contains the installation URL and optional default project. An installation URL cannot contain credentials, query parameters or fragments. Remote installations require HTTPS; HTTP is allowed only for loopback.

```sh
kintsugi auth login --url https://kintsugi.example.internal --profile work
kintsugi auth status --profile work
kintsugi project list --profile work
kintsugi project use modernization --profile work
```

If the profile already belongs to another installation, login fails before reading a token. Use a separate profile name for each installation. `auth logout` removes the selected profile's token. A one-shot `--token-stdin` on read commands is never saved.

`project use` follows project-list cursors (up to 100 pages of 25 projects) before saving the local default. If that bound is reached, it reports `PROJECT_LOOKUP_LIMIT_EXCEEDED` and does not save an unverified project.

Windows and macOS use the native credential store through the pinned keyring binding. Linux uses `secret-tool` directly so the CLI uses Secret Service and fails closed when it is missing; it does not fall back to Linux kernel keyutils. Install `libsecret-tools` and configure a Secret Service provider such as GNOME Keyring or KWallet before signing in. The Linux native-store path has not yet been exercised on a supported desktop release matrix.

For a private certificate authority, provide a PEM bundle when logging in:

```sh
kintsugi auth login --url https://kintsugi.internal --ca-file ./company-root.pem
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

Task events replay over authorized SSE for seven days. An expired, malformed or task-mismatched cursor returns `MEMBER_EVENT_CURSOR_EXPIRED`; fetch current `task status` and start a new watch without the old cursor. The stream rechecks the token, `member.read` permission and Project Access while connected. Watching does not trigger provider reconciliation or workflow continuation.

## Serve the local MCP bridge

Start a local stdio server for a compatible coding agent:

```sh
kintsugi mcp serve --profile work
```

The bridge has no inbound network listener. It uses the selected installation profile and reads the OS-stored credential for every API request, so the installation can revoke access between tool calls. Stdin and stdout are reserved for MCP messages; diagnostics use stderr. Authenticate with auth login first. The --token-stdin option is not accepted by mcp serve because it would consume the MCP protocol stream.

Each tool call supplies its own project and task identity. `mcp serve --project` is rejected so a connection cannot retain hidden project context. `task_brief` returns a snapshot ID; `document_get` and `document_search` require that ID explicitly. The tools are read-only. The selected AI reads the returned documents and answers the developer; the CLI does not inject a prompt into an already-running AI conversation.

## Current limits

The CLI and its MCP bridge cannot claim, assign, edit, approve, merge or otherwise mutate a Kintsugi task or repository. PR creation and repair stay in the developer's chosen coding tools; human decisions and workflow continuation stay in Kintsugi's authorized workflow.

`doctor` checks the runtime, profile credential availability and an authorized API read. It does not certify support for a Claude Code, Codex or Copilot version; those require native setup and interaction tests.
