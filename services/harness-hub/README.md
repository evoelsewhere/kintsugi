# services/harness-hub

Boundary for member-harness adapters and generated Coding Agent Workflow assets. The approved Coding Agent Workflow implementation is in progress; the existing remote MCP and member-write commands described by earlier drafts are not the v1 contract.

| Capability | Responsibility |
|---|---|
| Local stdio MCP adapter | Planned adapter over the shared typed agent-context port; launched by the installed CLI on a developer machine. It has no network listener and never owns authorization rules. |
| Coding Agent Workflow plugin generation | Planned small hookless skill and client-specific MCP configuration, installed separately from project method plugins. A client is supported only after its versioned setup and protocol matrix passes. |
| Typed Coding Agent Context API contract | Shared query and result schemas. CLI and MCP use the same project, task, snapshot, citation and error vocabulary. |
| Provider PR observation | Owned by the Git provider adapters and workflow services, not by this package. GitHub.com is first; webhook receipts and durable reconciliation feed the review workflow. |
| Existing harness policy and telemetry concepts | Future integrations. Client hooks and telemetry are optional later capabilities and do not enforce access or gate decisions. |

The target flow is developer's AI → local CLI/stdio MCP → HTTPS Coding Agent Context API. The AI retrieves documents and answers with citations under the developer's existing subscription. It cannot claim a task, change its status, register arbitrary files, approve a gate or administer the installation.

Kintsugi continues after the developer opens normal pull requests. Provider reconciliation and review are server-side. Effective phase exit requires an authenticated human decision and a merged Git gate record bound to the final required deliverables.

See [the approved Coding Agent Workflow ADR](../../docs/decisions/0041-coding-agent-workflow-through-cli-and-local-mcp.md), [task and snapshot contract](../../docs/decisions/0042-coding-agent-context-and-project-access.md), and [PR continuation contract](../../docs/decisions/0043-evidence-bound-pr-continuation.md).
