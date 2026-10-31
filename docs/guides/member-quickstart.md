# Member guideline: connect your AI client

Use Kintsugi with the AI client already on your machine. The CLI signs you in and provides a local MCP bridge for project documents and permitted plugins. It does not call a model or write to your code repository.

## Before you start

Ask your administrator for the installation's HTTPS URL, your project ID and an account with `member.read` and explicit Project Access. Install Node.js 22.19 or newer and a supported Claude Code, Codex or GitHub Copilot client. On Linux, install `libsecret-tools` and run a Secret Service provider such as GNOME Keyring or KWallet.

This flow is implemented in the development workspace. Check [client compatibility evidence](../reference/member-client-compatibility.md) for tested versions and remaining release gates.

## 1. Install from your installation

Open **Guideline** (`/guideline`) in your Kintsugi portal. It provides the exact commands and downloadable packages with checksums for that installation. Replace the example origin below with yours.

macOS / Linux:

```sh
curl -fsSL https://kintsugi.example.internal/api/v1/releases/latest/install.sh | sh
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -Command "irm https://kintsugi.example.internal/api/v1/releases/latest/install.ps1 | iex"
```

Open a new terminal, add the installer-provided PATH entry if needed, and check:

```sh
kintsugi --version
```

The installer checks the package hash and remembers the installation URL. Run it again to update the CLI in place. Manual packages are available on the same Guideline page.

## 2. Sign in and set up clients

```sh
kintsugi login my-project
kintsugi init
```

Replace `my-project` with your actual project ID. In the browser, review the requested project and approve access. `init` lists detected clients and asks which to configure and whether to install globally or for the current workspace. Codex and Copilot use global setup; Claude Code supports workspace setup. Restart the client afterwards.

Codex Desktop setup stages a personal marketplace; finish installing the connector in the app's Plugins Directory. It does not yet distribute member plugins through that staged path.

## 3. Install a permitted plugin

```sh
kintsugi plugins list
kintsugi install plugin modernize --all
```

If no plugin is available, ask the project's administrator to enable it for you. Start a new client session. Claude Code exposes `/modernize:build <module>/<unit> [project]`. Codex exposes the build command as a generated skill; select it with `$` or `/skills`. Copilot exposes a plugin skill. Trust the reporting hook in Codex's `/hooks` when requested.

The `modernize` build flow reads the rules and merged design, proposes a plan for approval, implements and tests the unit locally, checks a canary, and records the unit's test result and merge request. See the [first project walkthrough](first-project.md) for the complete review loop.

## 4. Check the connection

```sh
kintsugi auth status
kintsugi project list
kintsugi document tree 01-standards
kintsugi doctor
```

In the AI client, ask it to list your Kintsugi projects and read a relevant standard through the connector. Documents are read from Git at a branch or commit. A successful `doctor` check verifies the runtime, credential and API read, not full client compatibility.

## Maintain or disconnect

```sh
kintsugi update modernize
kintsugi remove modernize --all
kintsugi auth logout
```

`auth logout` revokes the connection and removes the local credential. Access tokens stay in memory, rotating refresh credentials live in the operating system credential store, and profiles contain nonsecret configuration. Administrators can revoke connections in the portal.

## Troubleshooting

| Symptom | Next step |
|---|---|
| `kintsugi: command not found` | Open a new terminal and add the PATH line printed by the installer. |
| No accessible project | Check the requested project ID, `member.read`, and explicit Project Access with an administrator. |
| Plugin is missing | Check project plugin access, run `plugins list`, and restart the client after installation. |
| Linux credential-store error | Install `libsecret-tools`, unlock the running keyring and sign in again. |
| Private certificate authority | Use the CLI's `--ca-file` option; see the full reference. |
| Hook is skipped in Codex | Review and trust the installed hook in `/hooks`. |

Exact commands, authorization, plugin safety and reporting behavior: [member CLI reference](../reference/member-cli.md).
