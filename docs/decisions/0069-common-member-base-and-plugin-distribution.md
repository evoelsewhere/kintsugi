# ADR-0069: Common member base and plugin distribution

- Status: Accepted
- Date: 2026-10-23
- Decision register: D83
- Amends: [ADR-0015](0015-member-assets-as-agent-plugins.md), [ADR-0035](0035-kintsugi-plugins-marketplace.md), [ADR-0061](0061-coding-agent-workflow-through-cli-and-local-mcp.md)

## Context

Members work in their own AI clients (Claude Code, Codex, Copilot, ChatGPT). Kintsugi should not build a flow into each client. It should give every client the same small base and let plugins carry the flows (design, implement, test, and what comes after), so that new flows need no engine change ([ADR-0067](0067-remove-access-and-review-plugins.md)). It should also manage those plugins: who may use which one, how they reach each kind of client, and what members do with them.

## Decision

1. **A common member base** is part of the engine: the Kintsugi CLI and a local stdio MCP bridge over one versioned HTTPS API (`/api/member/v1`). It owns what every plugin needs: sign-in (project-scoped browser authorization, rotating credentials, revocation), the identity and permissions of the member, reading resources (projects and the document repository), receiving plugins, and one write, the activity record. It knows no stage, task or review.
2. **Plugins plug into the base.** A plugin is the Claude Code plugin format ([ADR-0015](0015-member-assets-as-agent-plugins.md)) and says by `kintsugi.json` whether it is for the runtime or for members. Built-in plugins live in `packages/agents/builtin/plugins/`, a project's own in the document repository's `plugins/`. The built-in `context` plugin (audience `member`) is the first: a skill that reads the project's documents through the base.
3. **Kintsugi distributes member plugins.** The member API lists the member plugins a member may use in a project and serves one as a bundle: its skills, agents and commands as text files, each with a SHA-256 and a hash over all of them. Hooks, scripts, workflows and MCP entries are never distributed. The CLI (`kintsugi plugins list|install|remove`) verifies the hashes and writes the files into the Kintsugi-owned package of the client (the connector plugin), then runs the client's native plugin commands. A record in the package says which plugin put which files there, so an update or a removal deletes exactly those. Claude Code gets skills, agents and commands; Codex gets skills.
4. **Kintsugi permits plugins per member.** `admin.plugin_access` grants a member plugin to every member with Project Access to a project (`*`) or to one member; only `audience: member` plugins can be granted. Managing grants needs `plugin.access.manage` (admin by default). The grant is checked on every list, download and record.
5. **Kintsugi monitors use per member.** `monitoring.member_activity` records what a member's connection did: a plugin download and a document read (both written by Kintsugi from what it observes), and what a plugin records itself. Monitoring → Members shows the records and a per-member summary by kind and plugin; reading needs `member.activity.view` (admin by default). Records hold names, counts and a short summary, never document content, and the worker prunes them with the telemetry (`KINTSUGI_TELEMETRY_RETENTION_DAYS`).
6. **The write-back is one bounded record.** `POST /member/v1/activity`, the MCP tool `activity_record` and `kintsugi activity record` add one record of a `kind` (not `plugin.*` or `document.*`, which Kintsugi sets), an optional plugin the member may use, a summary of at most 500 characters and up to 20 scalar details of 4 KiB. A member can add at most 600 records an hour. It changes no project, document or repository. The member token guard allows POST only on routes marked as a write and still limits a token to its projects. Other writes are added only with a security review, like new kernel tools of the runtime ([ADR-0023](0023-runtime-as-generic-agent-kernel.md)).

## Consequences

- A new member flow is a plugin plus, where it needs one, an endpoint set that plugin adds; the base is not edited for it.
- Member plugins and runtime plugins share one catalog, one format and one place in the document repository, so permissions and monitoring have one model.
- A distributed plugin cannot run code on the member's machine through Kintsugi: it is text for the AI to read. A plugin that needs hooks or scripts needs a decision of its own.
- Project plugins in the document repository's `plugins/` are not served yet; the catalog is the built-in set.
- The activity record is as trustworthy as the member's connection: it is evidence of use, not proof of work.
