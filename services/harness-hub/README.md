# services/harness-hub

Status: the local stdio MCP adapter is implemented. Generated client plugins and setup tooling remain planned.

Harness Hub adapts the shared Coding Agent Workflow port to member-harness protocols. The local MCP server is started by the CLI and calls the same typed HTTPS API as the CLI commands. It has no network listener and contains no Project Access or authorization rules.

| Capability | Responsibility |
|---|---|
| Local stdio MCP adapter | Registers read-only tools over `CodingAgentWorkflowPort`; one explicit project/task/snapshot selection per call; errors are converted to safe MCP tool errors. |
| Coding Agent Workflow plugin generation | Planned small hookless skill and client-specific MCP configuration, installed separately from project method plugins. |
| Typed Coding Agent Context API contract | Shared query and result schemas. CLI and MCP use the same project, task, snapshot, citation and error vocabulary. |
| Provider PR observation | Owned by Git provider adapters and workflow services, not by this package. GitHub.com is first; webhook receipts and durable reconciliation feed the review workflow. |
| Existing harness policy and telemetry concepts | Future integrations. Client hooks and telemetry are optional later capabilities and do not enforce access or gate decisions. |

The current CLI bridge advertises seven tools: `project_list`, `task_list`, `task_brief`, `document_get`, `document_search`, `review_get` and `task_status`. `review_get` is registered only when the caller provides a functioning review capability; the API reads validated reports from PostgreSQL and scopes them to the requested project. Every contextual read requires the project and task identity, and document retrieval/search also require the snapshot returned by `task_brief`.

Run `kintsugi mcp serve --profile work` from the installed CLI. The process reads the selected profile's credential from the OS credential store for every API request, allowing server-side revocation to take effect on the next call. Stdin and stdout carry only MCP protocol messages; diagnostics go to stderr. The bridge is read-only and cannot claim tasks, change status, register arbitrary files, approve gates or administer the installation.

The developer's AI reads documents and answers with citations under the developer's existing subscription. Kintsugi continues after ordinary pull requests through server-side provider reconciliation and review. Effective phase exit still requires an authenticated human decision and a merged Git gate record bound to the final required deliverables.

See [the approved Coding Agent Workflow ADR](../../docs/decisions/0041-coding-agent-workflow-through-cli-and-local-mcp.md), [task and snapshot contract](../../docs/decisions/0042-coding-agent-context-and-project-access.md), and [PR continuation contract](../../docs/decisions/0043-evidence-bound-pr-continuation.md).
