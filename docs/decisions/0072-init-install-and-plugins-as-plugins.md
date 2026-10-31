# ADR-0072: One way in — login, init, install — and plugins as plugins of their own

- Status: Accepted
- Date: 2026-10-24
- Decision register: D86
- Amends: [ADR-0069](0069-common-member-base-and-plugin-distribution.md), [ADR-0070](0070-cli-distributed-by-the-installation.md), [ADR-0071](0071-members-build-runtime-reviews.md)

## Context

A member who wants to build a unit had to learn five things in the right order: install the CLI, `connect` one client, `login`, `add` a plugin, then type `/kintsugi:build`. Reading the code showed more than clumsiness:

- `connect` named the profile after a hash of the installation and the project, `login` called it `work`, so a member who followed the guide had two profiles and `add` could not find the client they had connected.
- `connect` refused every client version but the one this release was probed with. Claude Code updates every few weeks, so on most machines the first command failed.
- Every member plugin was merged into the connector plugin `kintsugi`, so a command was `/kintsugi:build`, not `/modernize:build`, and two plugins could collide on a file.
- A client had to be named by hand; there was no way to see what was on the machine, to install for one workspace only, or to install a plugin into every client at once.
- Nothing on the member's machine said what a command used. [ADR-0071](0071-members-build-runtime-reviews.md) collects which unit was built in which merge request, but not who ran what, for how long and with how many tokens.
- The built-in member plugin `context` was a skill that answered questions about the documents. It was a demonstration, and the flows that matter are `modernize` commands.

## Decision

1. **`kintsugi login <project>`, then `kintsugi init`, then `kintsugi install plugin <name> --all`.** Three commands take a member from an installed CLI to a plugin that runs in all their clients. `connect <client> [project]` stays as the short form for one client.
2. **One profile per installation and project.** `login`, `init` and `connect` name it the same way (`kintsugi-<hash>`), so signing in and setting up meet.
3. **`init` finds the clients and asks.** It asks each supported client for its version, lists those found (Claude Code, Codex CLI, Codex Desktop), and asks which to set up and whether to install **globally** (all workspaces) or for **the current workspace**. `--harness`, `--all`, `--scope global|workspace` and `--yes` answer the questions; without a terminal the defaults are every client found, globally. For Claude Code, workspace means the client's `local` scope (this user, this folder); Codex has no per-workspace install and is set up globally with a note. The scope is recorded with the package, and a workspace install must be run from that workspace. `init` then makes the project the active profile and signs in (in a terminal) so the first use needs no consent screen.
4. **A client version other than the probed one is used, with a note.** Only a client that was never probed is refused. The setup uses only the plain plugin commands every recent version has; the compatibility evidence records what was probed, not what is allowed. The one flag that differs is Codex's `--no-daemon`, which exists from 0.163 and which the 0.148 of the desktop app refuses; it is passed only to a Codex that has it.
5. **Each member plugin is a plugin of its own** in the client: its own folder in the Kintsugi package, its own entry in the marketplace, its own name. A command is `/<plugin>:<command>` (`/modernize:build`); the connector `kintsugi` carries only the bridge. Underscores in a Kintsugi plugin name become hyphens in the client's. A record of the installed plugins (files, version, content hash) keeps updates and removals exact.
6. **`install plugin <name> [--all | -H client]` installs, `install fetch [name]` updates.** `--all` is every client the member set up; `fetch` with no name updates every installed plugin in every client that has it, and does nothing (no native command runs) for a plugin whose version and content hash are unchanged. `add` and `plugins install` remain as short forms; `remove <name>` uninstalls with the client's command and deletes the plugin's folder. *(2026-10-31: `update [name]` is now the documented way to update; `install fetch` stays as its alias.)*
7. **The one hook that may reach a member: the activity hook.** A command, agent or skill may declare hooks in its front matter, and a hook may only run `kintsugi activity hook <start|stop|end> --plugin <name> --command <name>`. Kintsugi checks this twice: the API refuses to distribute a plugin whose hook is anything else (`assertSafeHooks`), and the CLI checks again before writing. Hook files, scripts and MCP entries are still never distributed.
8. **What the hook reports.** When a turn of the command ends, the hook reads the session transcript the client keeps on the member's machine, counts from the command's invocation on — input, output and cache tokens (once per model message), turns, the model and the time since the invocation — and records `command.run` (summary `<plugin>:<command>`, scalar details) through the bounded activity record of [ADR-0069](0069-common-member-base-and-plugin-distribution.md). Numbers and names only: nothing the member or the AI wrote is sent. It uses the member's own sign-in and never fails the session. The totals are cumulative for the command; Monitoring shows the latest per session. A hook runs for the active profile, so a member who works in two projects at once should keep the project of the session active.
9. **`context` is removed.** The built-in plugins are `reverse_engineering` (runtime) and `modernize` (`both`). Stack and project knowledge stay in the document repository ([ADR-0028](0028-remove-rulebook-single-document-repo.md)).
10. **The Build page and the guideline show the new commands**, and the member's activity list shows what a command used.
11. **GitHub Copilot CLI is a supported client** (probed with 1.0.63, [client capabilities](../reference/member-client-capabilities.md)). Its package is Claude-style (`.claude-plugin/plugin.json` and the default folders `skills/`, `agents/`, `hooks/hooks.json`), which Copilot reads; the connector keeps the Agent Plugins manifest. Copilot has no install scope, refuses to add a marketplace twice and keeps a copy of it, so a package set up before is refreshed (`marketplace update`) instead of added.
12. **One source, the form each client has.** A flow is authored once, as a command (`commands/build.md`, with `arguments:` and the front matter hook). Claude Code receives the command. Codex has no commands, and Copilot loads skills as `/<plugin>:<skill>`, so both receive the same text as a generated skill (`skills/build/SKILL.md`): the named arguments become a sentence ("the member types `<unit>`, `<project>` after the name") because these clients substitute nothing. Agents are left out where the client has none (Codex).
13. **A hook that covers the whole plugin is generated, and filters.** Codex and Copilot run a plugin's hook for every session where it is enabled and cannot scope it to a command. Kintsugi writes `hooks/hooks.json` for them from the activity hooks the commands declare, each with `--harness codex|copilot`; it never takes a hook file from a plugin. The hook looks for the command in the client's transcript and reports nothing when the member did not run it. Codex also asks the member to trust a new hook once (`/hooks`), which `install` says.
14. **Each client's own numbers.** Claude Code: usage per model message. Codex: the rollout's cumulative `token_count`, the last total minus the one before the command. Copilot: `outputTokens` per reply and the total of each sub-agent; it keeps input and cache tokens only in the session's shutdown snapshot, so a command's input tokens are not reported for Copilot.
15. **What a client sees as a plugin's version carries a hash of its content** (`3.1.0-ab12cd34`): every client keeps a plugin in a folder named after the version, so a plugin edited without a new version number would not be refreshed. A failed native install restores the record of installed plugins, and setting a client up again keeps the installed plugins in the package's marketplace.

## Consequences

- `planClientSetup` takes member plugins (each its own folder and marketplace entry, installed or updated by name, uninstalled when removed) and an install scope; `SetupInput.extraFiles` is gone. `clientVersionStatus` replaces the exact-version check. `harness-sdk` gains `assertSafeHooks`.
- The CLI gains `init`, `install plugin|fetch`, `activity hook` and a numbered terminal choice (`CliDeps.choose`, absent in tests and pipes).
- `modernize` 3.1.0: the command `build` declares the Stop hook; the member bundle is unchanged in shape.
- Codex and Copilot receive the command as a skill; Codex also leaves out agents. A Codex member runs the skill with `$` or `/skills`; the exact namespaced form in Codex was not verifiable without a session.
- Nothing moves in the API's data: `command.run` is a kind of the existing activity record.

## Alternatives considered

- **Keep one merged `kintsugi` plugin.** No change in the client, but commands stay under the wrong name and plugins collide.
- **Hooks as plugin-authored scripts.** More flexible, and it puts arbitrary code on the member's machine from a document repository. The hook is a fixed command with fixed arguments, checked by pattern.
- **Token counts from the client's own telemetry (OpenTelemetry).** Needs the member to configure an exporter; the transcript is already there and carries the same numbers.
- **A graphical installer or one-click link from the portal.** Considered and left for later; this decision makes the CLI path short enough that a wizard can be a thin layer on top.
- **A Kintsugi-hosted remote MCP server and marketplace, with no CLI.** The way to reach clients with no local plugins (ChatGPT) and to drop the version question. It changes the architecture of [ADR-0069](0069-common-member-base-and-plugin-distribution.md) and [ADR-0070](0070-cli-distributed-by-the-installation.md) and needs its own decision.
