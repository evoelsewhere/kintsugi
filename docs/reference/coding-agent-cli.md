# Coding Agent Workflow CLI

Status: the typed client, read-only CLI, local stdio MCP bridge and generated Coding Agent Workflow packages are implemented in the unreleased workspace. The SSE client, server event replay and `task watch` command are implemented; PR ingestion and workflow continuation are still in progress. Native setup is enabled only for exact Claude Code and Codex CLI versions recorded in the [compatibility evidence](coding-agent-workflow-compatibility.md).

The CLI lets a developer or a shell-enabled coding agent retrieve Kintsugi data. The developer's chosen AI interprets those documents and decides how to answer; the CLI does not call a model or inject text into an already-running AI conversation.

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

## Serve the local MCP bridge

Start a local stdio server for a compatible coding agent:

```sh
kintsugi mcp serve --profile work
```

The bridge has no inbound network listener. It uses the selected installation profile and reads the OS-stored credential for every API request, so the installation can revoke access between tool calls. Stdin and stdout are reserved for MCP messages; diagnostics use stderr. Authenticate with auth login first. The --token-stdin option is not accepted by mcp serve because it would consume the MCP protocol stream.

Each tool call supplies its own project and task identity. `mcp serve --project` is rejected so a connection cannot retain hidden project context. `task_brief` returns a snapshot ID; `document_get` and `document_search` require that ID explicitly. The tools are read-only. The selected AI reads the returned documents and answers the developer; the CLI does not inject a prompt into an already-running AI conversation.

## Current limits

`review list --task UNIT` reads authorized review references from task status. `review get` reaches the API route, which returns `UNSUPPORTED_CAPABILITY` until review ingestion is implemented, so the local bridge does not advertise `review_get`. Task events replay over authorized SSE for seven days; an expired, malformed or task-mismatched cursor returns `MEMBER_EVENT_CURSOR_EXPIRED`, so fetch current `task status` and start a new watch. The stream rechecks the token, `member.read` permission and Project Access while connected. Watching does not trigger provider reconciliation or workflow continuation. This CLI cannot claim, assign, edit, approve, merge or otherwise mutate a Kintsugi task or repository.

`doctor` checks the runtime, profile credential availability and an authorized API read. It does not certify support for a Claude Code, Codex or Copilot version; those require native setup and interaction tests.
