# ADR-0089: Name the built-in commands without a plugin prefix

- Status: Accepted
- Date: 2026-10-31
- Decision register: D103

## Context
The built-in commands kept the names of the upstream content they were adapted from ([ADR-0027](0027-builtin-modernization-content.md)): `reverse_engineering` carried `modernize-assess`, `modernize-plan-understand` and `modernize-understand`, and `modernize` carried `modernize-design`, `modernize-review` and `build`. Since each plugin is a client plugin of its own ([ADR-0072](0072-init-install-and-plugins-as-plugins.md)), a client names a command `/<plugin>:<command>`. The prefix then repeats the plugin (`/modernize:modernize-design`) or names the wrong one (`/reverse_engineering:modernize-understand`), and the portal showed the commands under names nobody types. The stage ids already dropped the prefix (`assess`, `understand`, `design`), so a command and its stage had two names.

## Decision
- A built-in command is named for what it does, without a plugin prefix: `reverse_engineering` has `assess`, `plan-understand` and `understand`; `modernize` has `design`, `review` and `build`. The command's file is `commands/<command>.md`.
- A command's stage id is its name: the loader no longer strips a prefix.
- The portal shows a member command as `/<plugin>:<command>` (`/modernize:build`), as the member types it; a runtime command, which the portal starts, is shown by its name.
- Both plugins take a minor version: `reverse_engineering` 2.5.0 and `modernize` 5.3.0. Nothing stored refers to a command name: runs keep the stage id and member grants name the plugin, so no data changes.

## Consequences
- The names read the same in the portal, the plugin page and the member's client.
- Earlier ADRs and the changelog keep the old names; they are records. An `upstream:` line in a command's metadata still names the upstream file it was adapted from.
- A project plugin that refers to a built-in command by its old name has to be updated by the project.

## Alternatives considered
- **Keep the names and strip the prefix only in the portal**: the member's client would still show the prefixed names, and a person would see two names for one command.
- **Rename the plugins instead**: the plugin names are the client plugin names members already installed ([ADR-0072](0072-init-install-and-plugins-as-plugins.md)); the command names were the part that did not fit.
