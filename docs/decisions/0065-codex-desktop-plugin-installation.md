# ADR-0065: Install the Coding Agent Workflow plugin from Codex Desktop

- Status: Accepted
- Date: 2026-10-22
- Decision register: D80
- Amends: ADR-0060 decisions 1 and 6
- Preserves: ADR-0060 local stdio transport and read-only context contract; ADR-0064

## Context

The local Coding Agent Workflow already has a generated plugin and browser sign-in, but setup invokes each client’s CLI to register and install the plugin. The user currently works in Codex Desktop and wants to install the plugin through its UI, then ask the AI normally. Codex Desktop reads a personal local marketplace catalog at `~/.agents/plugins/marketplace.json` and personal packages from `~/.codex/plugins/`; after a restart, the developer can browse and install plugins from that marketplace.

The existing local stdio bridge fits local Docker deployments. A remote MCP endpoint would add OAuth discovery, public reachability, client registration, and provider compatibility work. That transport remains outside this decision.

## Decision

1. Keep the Kintsugi CLI as the package-preparation tool and keep its local stdio MCP bridge as the data transport. Add a Codex Desktop installation mode that stages a plugin and adds it to the user’s personal local marketplace without invoking Codex CLI.
2. Store the package in `~/.codex/plugins/<profile-specific-name>` and merge its entry into `~/.agents/plugins/marketplace.json`. Use Codex’s documented personal source path, `./.codex/plugins/<profile-specific-name>`. Preserve unrelated entries and metadata, and never modify the developer’s code repository.
3. Keep the generated package project-scoped and nonsecret. It points to the existing local Kintsugi CLI and a named profile; first-use browser authorization remains unchanged and credentials remain in the OS secure store.
4. The developer restarts Codex Desktop and installs or enables the staged plugin through the app’s Plugins Directory. The CLI command only prepares the package and catalog; it does not claim to have installed the plugin.
5. Preserve the current native CLI install mode and Claude Code package/setup path. Treat Claude Code in Claude Desktop, Claude Desktop Chat, and other app surfaces as distinct adapters. Add UI installation support for another client only after its package source, staging action, sign-in behavior, and real-client use have been verified.
6. Keep the MCP read-only and preserve the separate ownership boundary: the developer’s AI uses its normal GitHub access for code and PRs; Kintsugi observes PRs through its provider connection.

## Consequences

- Codex Desktop users can install the generated local package in the app after a one-time Kintsugi CLI staging command.
- Local Docker and private-network deployments continue to work without an inbound public MCP endpoint.
- The personal marketplace update must be safe, additive, idempotent, atomic, and tolerant of unrelated plugin entries. The resolved package path must remain inside the user home.
- The CLI prerequisite remains until the Kintsugi package is distributed through a supported public package registry.
- The Codex app UI and authenticated tool call still require a real-client pilot; generated-package tests alone do not establish live support.

## Options considered

### Keep installation entirely in the client CLI

This is the existing automation path. It stays available for headless setup but does not meet the request to install from the desktop app.

### Prepare a local marketplace and install in Codex Desktop

Selected. It uses Codex’s supported personal marketplace and app install flow, preserves the established local MCP architecture, and avoids a remote OAuth service.

### Add remote Streamable HTTP MCP and OAuth now

Deferred. It is a separate transport and authorization-server decision with additional discovery, client-registration, redirect, public-network, and per-client validation requirements. It is not necessary for local Codex Desktop to reach the local stdio bridge.

## Follow-up

- Add an idempotent Codex Desktop staging mode and tests for local marketplace merge, conflict handling, and symlink rejection.
- Update the Developer Documents guide with the exact preparation command and Codex Desktop install steps.
- Validate the package in a real Codex Desktop local marketplace before calling the app surface live-supported.
