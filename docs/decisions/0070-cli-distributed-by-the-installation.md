# ADR-0070: The CLI is distributed by the installation

- Status: Accepted
- Date: 2026-10-23
- Decision register: D84
- Amends: [ADR-0069](0069-common-member-base-and-plugin-distribution.md)

## Context

The member base ([ADR-0069](0069-common-member-base-and-plugin-distribution.md)) needs the CLI on every member's machine, before they can sign in. The installation is self-hosted and often private, so a public registry or release page is not an option, and a member should not need the repository or its build tools. The commands a member types must be short.

## Decision

1. **The installation serves the CLI.** The image build packs one `.tar.gz` per platform (Linux, macOS and Windows; x64 and ARM64) and a manifest with their SHA-256 into `KINTSUGI_RELEASES_DIR`. The CLI is bundled into one file; `zod` stays a package beside it because its module graph does not survive bundling; Windows and macOS carry the native keyring addon of their platform, taken from the npm registry at build time and verified against the registry's integrity hash. Node.js is not packed: the installers require version 22.19 or newer.
2. **Public routes** `GET /api/v1/releases/latest` (manifest), `latest/install.sh`, `latest/install.ps1`, and `<version>|latest/<file>` (a package the manifest lists). They are public only because `curl` and PowerShell cannot sign in. Nothing secret is served; every package is checked against a SHA-256 that is written into the installer that fetches it, and the installers use only the installation's canonical URL (`KINTSUGI_PUBLIC_URL`), never request headers. The human side is a page of the portal, **Guideline** (`/guideline`, for signed-in members): quick start, install (with the packages and their hashes for a manual install), connect, plugins, record activity, the CLI reference and an administrator page. There is no public documentation site.
3. **The installers** are one-liners (`curl -fsSL <url>/install.sh | sh`, `powershell … irm <url>/install.ps1 | iex`). They install into `~/.kintsugi` or `%LOCALAPPDATA%\Kintsugi` at a stable path (an update replaces it in place, so generated client packages keep working), need no administrator rights, change only the user PATH on Windows, and write `install.json` with the installation's URL. A manual package from the Guideline works the same way.
4. **Short commands.** `kintsugi connect <client> [project]`, `kintsugi login [project]`, `kintsugi add|remove <plugin>`; the URL comes from `--url`, `KINTSUGI_URL`, the default profile or `install.json`, and the client of `add` from the one connected. The long forms (`plugins setup`, `plugins install --harness`) stay.

## Consequences

- An installation without a release (a development checkout) answers 404 on these routes; the workspace runs the CLI with `pnpm kintsugi`.
- The image build needs the npm registry for the Windows and macOS addons; `pnpm release:cli --platforms linux-x64` builds a subset offline.
- The packages are not signed or notarized. Integrity is the hash from the installation over TLS; Gatekeeper and SmartScreen are not involved because the installers download with `curl` and `Invoke-WebRequest` and the payload is JavaScript run by Node.js.
- A single self-contained binary (Node.js embedded) is possible later without changing the routes or the installers.
