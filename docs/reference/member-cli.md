# Member CLI and local MCP bridge

Status: the typed client, the CLI, the local stdio MCP bridge, the generated Kintsugi connector plugin, browser authorization, rotating credentials and the connection-age policy are implemented in the unreleased workspace. Native setup is probed with the Claude Code and Codex CLI versions listed in the [compatibility evidence](member-client-compatibility.md); another version is used with a note ([ADR-0072](../decisions/0072-init-install-and-plugins-as-plugins.md)). Authenticated native MCP calls remain a release gate.

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

## Sign in, then set up the clients

```sh
kintsugi login my-project
kintsugi init
```

`login <project>` signs in in the system browser (below). `init [project]` is the one command that sets up the AI clients ([ADR-0072](../decisions/0072-init-install-and-plugins-as-plugins.md)):

1. It asks each supported client for its version and **lists those found**: Claude Code, Codex CLI, GitHub Copilot CLI and Codex Desktop (found by its `~/.codex` folder).
2. It asks **which to set up** (numbers, `all`, or Enter for every client found).
3. It asks whether to install **globally** (every workspace) or only for **the current workspace**. For Claude Code this is the client's user scope or its `local` scope; Codex has no per-workspace install and is set up globally with a note. The scope is recorded with the package; a plugin command for a workspace install must be run from that workspace.
4. It records a nonsecret local profile (one per installation and project, the same one `login` uses), generates the Kintsugi package of each client (the MCP server entry; the Kintsugi marks for Codex) and installs it with the client's native plugin commands, makes the project the active one and, in a terminal, signs in if the member has not.

`--harness claude,codex`, `--all`, `--scope global|workspace` and `--yes` answer the questions (without a terminal the defaults apply: every client found, globally). The URL comes from `--url`, `KINTSUGI_URL`, the active profile or `install.json`, in that order. The output lists what was set up; `--verbose` lists the files written and the commands run. `kintsugi connect <claude|codex|codex-desktop> [project]` sets up one client without the questions; `kintsugi plugins setup --harness <client> --url <url> --project <id>` is the long form, always verbose. Setup refuses to overwrite unowned files or follow symbolic links; re-run it to update the package. Start a new client session afterwards. `codex-desktop` stages a personal marketplace that the member finishes installing in the app.

Setup checks the client version before writing. The versions in the [compatibility evidence](member-client-compatibility.md) were probed; another version goes ahead with a note on stderr, because the setup uses only the plain plugin commands. Codex's `--no-daemon` is passed only to a Codex from 0.163 (the desktop app's 0.148 refuses it). A client that was never probed is refused. The package contains no skill and no hooks: the connector only starts the local MCP bridge. Plugins that carry flows are installed next to it, each as a plugin of its own.

## Sign in on first use

When the AI first needs Kintsugi (or at `login` or `init`), the local MCP bridge opens the system browser. Sign in, review the requested project and approve it. The browser returns a short-lived authorization code to the CLI over a temporary loopback callback and the CLI exchanges it with PKCE; nobody creates or pastes a token. Kintsugi issues a five-minute access token and a rotating refresh credential. The access token stays in CLI memory and the refresh credential in the operating system credential store. The administrator's 15- or 30-day maximum connection age (Settings → Security) controls when consent is required again, and connections can be revoked in the portal.

```sh
kintsugi login modernization        # same as: kintsugi auth login --project modernization
kintsugi auth status
kintsugi project list
kintsugi project use modernization
```

The profile JSON holds the installation URL and project ID, never credential material. `--token-stdin` accepts only an existing legacy token. Use one profile per installation and project: `login <project>`, `init` and `connect` all name it from the installation URL and the project, so they find each other. `auth logout` revokes the connection at Kintsugi before removing the local credential. Installation URLs cannot contain credentials, a query or a fragment; remote installations require HTTPS (HTTP only for loopback). A private certificate authority is added with `--ca-file`; redirects are blocked so a bearer token is never forwarded to another origin.

Windows and macOS use the native credential store through the pinned keyring binding. Linux uses `secret-tool` directly and fails closed when Secret Service is missing; install `libsecret-tools` and a provider such as GNOME Keyring or KWallet first.

## Read projects and documents

```sh
kintsugi project list
kintsugi document tree 01-standards
kintsugi document get 01-standards/conventions/typescript.md --ref refs/heads/main
```

`--project` selects one command's project; otherwise the profile default from `project use` applies. Every request is authorized again by the API: the token's project scope, the member's `member.read` permission and explicit Project Access. Documents come from the project's document repository mirror ([ADR-0028](../decisions/0028-remove-rulebook-single-document-repo.md)), read-only, at a branch or commit (default branch when `--ref` is omitted); `restricted/` and `.git` are never served and files over 2 MiB are refused. Lists use cursor pagination (`--cursor`, `--limit` 1–100). Output supports `--format text|json|markdown`; `--json` is an alias. Results go to stdout, errors to stderr, and `--no-input` disables prompts.

## Install member plugins

A member plugin (`audience: member`, or `both` for `modernize`) carries a flow for the member's own AI client, as skills, agents and commands. Kintsugi offers it to a project's members (Project → Member plugins, `plugin.access.manage`); the CLI installs it into the clients the member set up with `init`:

```sh
kintsugi plugins list                    # what you may install, and where it is installed
kintsugi install plugin modernize --all  # into every client you set up (or -H claude, or choose when asked)
kintsugi update modernize                # bring it up to date (all installed plugins when no name)
kintsugi remove modernize --all
```

`install plugin` (short forms `add` and `plugins install`) downloads the plugin from the installation, checks every file against its SHA-256 and the bundle against its content hash, writes the files into **a folder of their own** in the Kintsugi package of each client, lists the plugin in the package's marketplace and installs it with the client's native plugin commands, in the scope `init` chose. A plugin is therefore a plugin of its own in the client, and its commands are named after it (`/modernize:build`); the connector `kintsugi` carries only the bridge. A name with underscores becomes a name with hyphens in the client. `update` (also `install fetch`) downloads again and, for a plugin whose version and content hash are unchanged, does nothing; otherwise it updates the plugin with the client's update command and deletes the files the new version no longer carries. `remove` uninstalls with the client's command and deletes the plugin's folder. A record (`.kintsugi-plugins.json`) in the package keeps each plugin's version, content hash and files. Claude Code receives skills, agents and commands. Codex and Copilot, which have no commands of their own to run by name, receive a command as a generated skill (`skills/build/SKILL.md`, with its named arguments turned into a sentence), and Codex has no agents, so it receives none. What a client shows as the plugin's version has a hash of its content appended (`3.1.0-ab12cd34`), because every client keeps a plugin in a folder named after the version. A native install the client refuses leaves no record. Start a new client session afterwards. Copilot has no install scope, so `init --scope workspace` applies to Claude Code only; a package set up before is refreshed in Copilot with `marketplace update`, because Copilot refuses to add a marketplace twice.

Scripts, workflow files, hook files and MCP entries are never distributed: a plugin is text the AI reads, with one exception. A command, agent or skill may declare **hooks in its front matter**, and a hook may only run `kintsugi activity hook <start|stop|end> --plugin <name> --command <name>` ([ADR-0072](../decisions/0072-init-install-and-plugins-as-plugins.md)). The API refuses to distribute a plugin that declares anything else, and the CLI checks again before it writes (`assertSafeHooks` in `@kintsugi/harness-sdk`). Installing needs a signed-in profile; Codex Desktop's staged install does not carry plugins yet.

The built-in `modernize` plugin is a plugin of **both** audiences ([ADR-0071](../decisions/0071-members-build-runtime-reviews.md)): its runtime part (the `design` and `review` stages) never leaves the installation, and a member receives only the command `build` and the skills it names (`build-method`, `unit-testing`). In Claude Code the command is `/modernize:build <module>/<unit> [project]`: it reads the unit's rules and merged design with `document_get`, plans and waits for a yes, implements and tests the unit in the member's own repository, shows with a canary that the tests can fail, and records what was built (below). The member commits and opens the merge request; the runtime's `review` stage reads it.

## Record activity

```sh
kintsugi activity record result --plugin modernize --summary "Reviewed the standards" --detail documents=3
```

This is the only write of the base. It adds one record to the project's monitoring (Monitoring → Members): a `kind` (not `plugin.*` or `document.*`, which Kintsugi sets itself), the plugin it belongs to (one you may use), a summary of at most 500 characters and up to 20 scalar details. Never put document content, credentials or personal data in it. At most 600 records an hour per member; the worker deletes records after `KINTSUGI_TELEMETRY_RETENTION_DAYS` (30 by default). The request is sent once and never retried, so a lost response cannot record twice. Kintsugi also records, without the plugin asking, each plugin download and each document read.

### The activity hook of a command

`kintsugi activity hook stop --plugin modernize --command build` is what a command's front matter runs when a turn of the command ends. The client passes the session as JSON on stdin (`session_id`, `transcript_path`). The hook reads the transcript the client keeps on the member's machine and counts **from the command's last invocation** (the line holding `/<plugin>:<command>`, else the start of the session): input, output, cache-read and cache-creation tokens (a model message is written once per content block with the same usage, so it counts once, by its id), the number of model messages, the model and the seconds between the invocation and the last line. It records `command.run` with the summary `<plugin>:<command>` and the numbers as scalar details, plus the session id (cut to 64 characters). It sends numbers and names only, never the transcript, uses the member's own sign-in and the same bounded record, and always exits 0: a hook that cannot report (not signed in, no transcript) says so briefly on stderr and stays out of the way. The totals are cumulative for the command and each turn adds a record; Monitoring → Members shows them as a line (`modernize:build · 12.3k in / 3.4k out · 5 turns · 2m 10s · model`). The hook runs for the active profile.

**Per client.** Claude Code runs the hook from the command's front matter, so it runs for that command only. Codex and Copilot run a plugin's hook for every session, so Kintsugi writes `hooks/hooks.json` for them from the hooks the commands declare (`hooks.json` with `Stop` for Codex, `agentStop` with `bash` and `powershell` for Copilot), each command line with `--harness codex` or `--harness copilot`; a plugin cannot bring its own hook file. The hook finds the command in that client's transcript and sends nothing when it was not run: for Codex a user message that names the skill (`$modernize:build`, `@` or `/` forms) in the rollout, for Copilot a `user.message` with `/modernize:build`. Counts come from each client's own record: Claude Code the usage of every model message; Codex the cumulative `token_count` of the rollout, as the last total minus the one before the command (uncached input, cached input, output); Copilot the output tokens of each reply and the total of each sub-agent (`subagentTokens`), without input tokens, which Copilot keeps only for the whole session. If the client sends no transcript path the hook looks for it by session id under `CODEX_HOME` or `COPILOT_HOME`. A new Codex hook is skipped until the member trusts it in `/hooks`; `install` says so.

### Records of `modernize`

`modernize` records two more kinds, with the unit (`<module>/<unit>`) as the summary: `build.test` (details `cases`, `failed`, `canary` = `killed` or `survived`, `rulesPassed` and `rulesFailed`, each a comma-separated string of rule ids, `rulesPassed` `*` for every rule a test names except the failed ones, and `legacyCases` and `legacyMatched` when the new code was compared with the legacy system) and `build.mr` (details `mr`, the URL of the merge request, `branch`, `commit`, the full head commit, and the same values from a test run at that commit; [ADR-0088](../decisions/0088-parity-of-a-built-unit-with-its-rules.md)). The review shows them, rule by rule, as the member's report. The portal's Build page shows the latest `build.mr` of each unit and reviews that merge request at that commit; it displays a link only when it is an `http(s)` URL and a commit only when it is a full hexadecimal id.

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
| `brain_tree` | One level of the project's [Brain](brain.md) (the tree index of its documents) with a summary per node and no text |
| `brain_read` | A Brain node's text with its citation (path, lines, commit), its children and its links, in bounded parts |
| `brain_lookup` | The Brain nodes a reference id, node id or repository path names |
| `brain_grep` | The Brain nodes whose text contains an exact string |
| `plugin_list` | The member plugins the member may install in a project |
| `activity_record` | Records one bounded note for the project's monitoring (the only tool that is not read-only) |

Plugins add their own commands and skills on top of this set.

## Current limits

The CLI and the bridge cannot change a project, a document or a repository; their one write is the activity record. `doctor` checks the runtime, the profile credential and an authorized API read; it does not certify support for a Claude Code, Codex or Copilot version.
