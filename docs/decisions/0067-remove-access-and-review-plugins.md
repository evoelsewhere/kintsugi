# ADR-0067: Remove the Coding Agent Workflow

- Status: Accepted
- Date: 2026-10-23
- Decision register: D54, D77, D78, D79, D80, D81, D82
- Supersedes: [ADR-0061](0061-coding-agent-workflow-through-cli-and-local-mcp.md), [ADR-0062](0062-coding-agent-context-and-project-access.md) (except explicit Project Access), [ADR-0063](0063-evidence-bound-pr-continuation.md), [ADR-0064](0064-portable-agent-plugin-layouts.md), [ADR-0065](0065-project-scoped-oauth-for-coding-agent-workflow.md) and [ADR-0066](0066-codex-desktop-plugin-installation.md)
- Amends: [ADR-0015](0015-member-assets-as-agent-plugins.md), [ADR-0035](0035-kintsugi-plugins-marketplace.md)

## Context

The Coding Agent Workflow connected a member's own AI client to Kintsugi: a CLI and a local stdio MCP bridge over a scoped HTTPS API, personal tokens and browser-authorized connections, task and snapshot projections, GitHub pull request observation and Kintsugi-run pull request reviews, evidence-bound gate publication, and two built-in plugins (`access`, `review`) with a generator and an installer of client plugins. We want the engine to keep only the runtime flow (jobs, stages, gates and decisions, the document repository and Git) and to attach every other capability later as a plugin.

## Decision

1. Remove the Coding Agent Workflow: `packages/cli`, `packages/kintsugi-client`, `packages/harness-sdk` and `services/harness-hub`; the `member`, OAuth, connection, task, snapshot, review and gate-publication modules of the API and their portal pages (the project's AI page, the developer docs, the Security settings tab, the gate publication list); the orchestrator's provider sync, pull request reviews, snapshot retention and effective-gate continuation; the GitHub App and webhook configuration of a Git server; and the packages of the domain and Git libraries that only they used.
2. Remove the built-in `access` and `review` plugins and the `gate-reviewer` agent.
3. Keep what the runtime flow uses: explicit Project Access (`admin.project_access`, `project.access.manage`), stage decisions, the workflow event log and outbox (`workflow.member_transition`, `member_event`, `member_event_cursor`, `outbox`), and the document writer's pull request watch.
4. Migration `033_remove_coding_agent_workflow.sql` drops the tables, functions, columns, secrets and permissions of the removed feature. The data in them is lost.

## Consequences

- The built-in plugins are `reverse_engineering` and `modernize` ([ADR-0068](0068-design-generation-in-the-modernize-plugin.md)); both run in the Kintsugi runtime. No member-harness integration ships; later plugins attach it.
- The `workflow.member_*` event tables keep their names although stage decisions are their only writer now; renaming them is left to a later change.
- ADRs 0061 to 0066 stay as history. Their reference pages, guides and the delivery record's Coding Agent Workflow part are deleted; the code is in Git history.
- A developer who wants to read Kintsugi context from an AI client has no supported way until a plugin provides one.
