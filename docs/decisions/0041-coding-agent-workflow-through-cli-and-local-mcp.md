# ADR-0041: Coding Agent Workflow through the CLI and stdio MCP

- Status: Accepted
- Date: 2026-10-20
- Decision register: D17, D18, D19, D43, D57
- Amends: [ADR-0015](0015-member-assets-as-agent-plugins.md), [ADR-0028](0028-remove-rulebook-single-document-repo.md), [ADR-0035](0035-kintsugi-plugins-marketplace.md)

## Context

Members use their own coding agents and subscriptions. Kintsugi must give those agents authorized project context without requiring a Kintsugi-owned assistant, a new model subscription, or a server-side coding-agent runner. A remote MCP-first design also assumes clients can reach a self-hosted Kintsugi installation and agree on an authentication flow.

The approved v1 workflow uses an installed Kintsugi CLI and a local MCP process. Both call the same HTTPS Coding Agent Context API. The selected AI reads Kintsugi documents and explains them to the developer; it does not receive a task assignment or approval authority from the connector.

## Decision

1. The CLI is the installation and interaction entry point. It stores nonsecret profile settings locally and obtains authentication secrets through the operating system's secure credential store. If persistent secure storage is unavailable, the CLI fails closed and never writes a token to a plaintext profile.
2. The CLI can launch a local stdio MCP bridge. The bridge serves the same typed Coding Agent Workflow context contract as the CLI, calls the configured HTTPS installation, and has no inbound network listener. MCP stdout contains protocol messages only.
3. The Coding Agent Workflow context contract is read-only: list authorized projects and tasks, obtain a task brief, retrieve or search documents from an explicit snapshot, inspect review findings and task status, and watch authorized workflow events. The server reauthorizes every request. Reading a task never claims or assigns it.
4. A developer's chosen AI reads Kintsugi documents and answers questions with source citations. Kintsugi's own conversational assistant, semantic search, member task writes, approval writes and administration are later decisions.
5. The Coding Agent Workflow plugin is a small generated package that starts the installed CLI's MCP bridge and teaches the agent to retrieve complete cited context and identify unresolved decisions. It has no hooks. It is separate from the optional modernization method plugin and cannot make server authorization depend on client behavior.
6. Claude Code is the end-to-end pilot. Codex and GitHub Copilot CLI use the same Coding Agent Context API contract but are not supported claims until their setup, protocol and update paths pass the client matrix. Hosted agents and other IDE surfaces are later targets.
7. The first transport is local stdio MCP plus HTTPS to Kintsugi. Remote Streamable HTTP MCP and OAuth are deferred. Existing accepted plugin and document-repository decisions remain in force except for the amendments stated here.

## Consequences

- Members can use an existing AI subscription and ask it to read Kintsugi's task, design, standards and evidence sources.
- The CLI and MCP bridge share authentication, schemas, snapshot rules and stable error codes; they cannot drift into different authorization behavior.
- Client packages need a pinned launcher and an idempotent setup and removal path. Native compatibility is measured per client and version.
- Local export is an explicit copy with provenance. Revoking server access cannot recall material already exported to another application.
- Hooks, a remote MCP endpoint, OAuth, task claiming and Kintsugi-generated answers are not prerequisites for the first Coding Agent Workflow release.

## Alternatives considered

- **CLI only.** Retained as a supported fallback, but structured tool discovery is useful for agents that can launch local MCP processes.
- **Remote Streamable HTTP and OAuth first.** Deferred because it adds self-hosted reachability and client-authentication work before the read-only workflow is proven.
- **A Kintsugi-owned assistant.** Deferred because the developer's selected AI can read the same authorized sources under the developer's existing subscription.
- **One plugin containing access and modernization methods.** Rejected because context access should not require workflow scripts, hooks or a particular modernization method.
