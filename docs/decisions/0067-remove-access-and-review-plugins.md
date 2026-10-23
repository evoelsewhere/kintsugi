# ADR-0067: Remove the Coding Agent Workflow, keep the common member base

- Status: Accepted
- Date: 2026-10-23
- Decision register: D54, D77, D78, D79, D80, D81, D82
- Supersedes: [ADR-0063](0063-evidence-bound-pr-continuation.md); [ADR-0062](0062-coding-agent-context-and-project-access.md) (except explicit Project Access)
- Amends: [ADR-0015](0015-member-assets-as-agent-plugins.md), [ADR-0035](0035-kintsugi-plugins-marketplace.md), [ADR-0061](0061-coding-agent-workflow-through-cli-and-local-mcp.md), [ADR-0064](0064-portable-agent-plugin-layouts.md)

## Context

The Coding Agent Workflow connected a member's own AI client to Kintsugi. It mixed two things: a generic base (a CLI and a local stdio MCP bridge over a scoped HTTPS API, browser-authorized connections, a generator and an installer of client plugins) and one fixed flow on top of it (task and snapshot projections, GitHub pull request observation, Kintsugi-run pull request reviews, evidence-bound gate publication, and the built-in `access` and `review` plugins). We want the engine to keep the base and the runtime flow (jobs, stages, gates and decisions, the document repository and Git), and to attach every flow later as a plugin ([ADR-0069](0069-common-member-base-and-plugin-distribution.md)).

## Decision

1. Remove the flow: the `access` and `review` plugins and the `gate-reviewer` agent; the task, snapshot, review and gate-publication modules of the API and their portal pages (the project's AI page, the developer docs, the gate publication list); the orchestrator's provider sync, pull request reviews, snapshot retention and effective-gate continuation; the GitHub App and webhook configuration of a Git server; and the parts of the domain and Git libraries that only they used.
2. Keep the base: `packages/cli`, `packages/kintsugi-client`, `packages/harness-sdk` and `services/harness-hub` (reduced to the common contract and three read-only tools: `project_list`, `document_tree`, `document_get`), the member token and OAuth connection modules of the API and their portal pages (the connection panel on the project page, the authorize page, the Security settings tab), and a new `member/v1` API for projects and documents.
3. Keep what the runtime flow uses: explicit Project Access (`admin.project_access`, `project.access.manage`), stage decisions, the workflow event log and outbox (`workflow.member_transition`, `member_event`, `member_event_cursor`, `outbox`), and the document writer's pull request watch.
4. The generated connector plugin carries only the MCP server entry of the selected client: no skill, no hooks.
5. Migration `033_remove_coding_agent_workflow.sql` drops the tables, functions, columns, secrets and permission of the removed flow. The member token and connection tables and the `member.read`, `tokens.manage-own` and `security.manage` permissions stay.

## Consequences

- The built-in plugins are `reverse_engineering` and `modernize` ([ADR-0068](0068-design-generation-in-the-modernize-plugin.md)); both run in the Kintsugi runtime. A member can already connect a coding agent and read projects and documents; flows for members come as plugins.
- The `workflow.member_*` event tables keep their names although stage decisions are their only writer now; renaming them is left to a later change.
- The reference pages and guides of the removed flow are deleted; the CLI and its compatibility evidence are in [the member CLI reference](../reference/member-cli.md) and [member client compatibility](../reference/member-client-compatibility.md). The code of the flow is in Git history.
- A developer who wants task briefs, reviews or pull request continuation has no supported way until a plugin provides one.
