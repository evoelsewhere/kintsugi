# ADR-0069: Common member base and plugin distribution

- Status: Accepted (the base ships; distribution and per-member monitoring are the direction)
- Date: 2026-10-23
- Decision register: D83
- Amends: [ADR-0015](0015-member-assets-as-agent-plugins.md), [ADR-0035](0035-kintsugi-plugins-marketplace.md), [ADR-0061](0061-coding-agent-workflow-through-cli-and-local-mcp.md)

## Context

Members work in their own AI clients (Claude Code, Codex, Copilot, ChatGPT). Kintsugi should not build a flow into each client. It should give every client the same small base and let plugins carry the flows (design, implement, test, and what comes after), so that new flows need no engine change ([ADR-0067](0067-remove-access-and-review-plugins.md)).

## Decision

1. **A common member base** is part of the engine: the Kintsugi CLI and a local stdio MCP bridge over one versioned HTTPS API (`/api/member/v1`). It owns what every plugin needs and no plugin should redo: sign-in (project-scoped browser authorization, rotating credentials, revocation), the identity and permissions of the member, reading resources (projects and the document repository), and, as plugins need them, recording information back (activity, results). It knows no stage, task or review.
2. **Plugins plug into the base.** A plugin is the Claude Code plugin format ([ADR-0015](0015-member-assets-as-agent-plugins.md)) and says by `kintsugi.json` whether it is for the runtime or for members. Kintsugi's built-in plugins live in `packages/agents/builtin/plugins/`, a project's own in the document repository's `plugins/`.
3. **Kintsugi manages the plugins, not the harness.** The CLI installs a plugin from the installation onto the member's host, and Kintsugi generates it for each kind of harness (native for Claude Code and Copilot, converted for Codex, a fallback render for others). The installation decides who may use which plugin (permissions per member and project) and observes its use per member (the connection, the activity the base records).
4. What ships now: the CLI, the MCP bridge with three read-only tools, browser authorization and the connection-age policy, the connector plugin generated for Claude Code and Codex, and the `member/v1` API for projects and documents. Plugin distribution through the CLI, permissions per plugin and per-member monitoring are not built yet; the contracts they will use are the plugin types and the activity record in `packages/harness-sdk`.

## Consequences

- A new member flow is a plugin plus, where it needs one, an endpoint set that plugin adds; the base is not edited for it.
- The base is deliberately read-mostly: it changes no project, document or repository. Writing back is added with a security review, in the same way as new kernel tools of the runtime ([ADR-0023](0023-runtime-as-generic-agent-kernel.md)).
- Member plugins and runtime plugins share one catalog, one format and one place in the document repository, so permissions and monitoring have one model.
