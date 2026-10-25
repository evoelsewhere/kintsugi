# ADR-0077: Agents access current project memory through tools

- Status: Accepted; learning/trust, scope and tool lifecycle amended by [ADR-0078](0078-agent-memory-learning-lifecycle.md)
- Date: 2026-10-25
- Decision register: D91
- Supersedes: [ADR-0076](0076-project-memory-for-understand.md) decisions 1, 5, 6, 7, 8 and 9 for runtime integration, read behavior and proposal transport. Its authority, evidence and human review rules remain in effect.
- Amends: [ADR-0023](0023-runtime-as-generic-agent-kernel.md) generic kernel tools and [ADR-0029](0029-job-workspaces-instead-of-os-sandboxes.md) child communication.

## Context

The first project-memory pilot selected hints before a run, copied them into a retained snapshot and inserted selected content into each analyst task. This limits the agent's ability to choose its own queries and gives it memory text it may not need. The user explicitly chose on-demand tools and no snapshots.

## Decision

1. Remove project-memory snapshots, preselection and prompt injection. `JobSpec.memory` carries only optional capability metadata and a write schema, never memory entries. Migration 037 removes a pre-tool snapshot table if it exists. The kernel keeps no memory read cache.
2. Add four optional tools: `memory_search`, `memory_read`, `memory_write`, `memory_status`. The agent decides whether and when to use them. Tool descriptions explain their contract; the task contains no mandatory search instruction or preloaded hints.
3. Each read queries the current Postgres data, approval state, project setting, run publication and source revision. The worker binds project/application/run/source scope before the model sees the tools; model arguments cannot select another scope. `memory_search` uses bounded, paginated PostgreSQL full-text search and returns summaries/locations; `memory_read` retrieves one current eligible entry with evidence. Empty or disabled memory returns no eligible entries. Content already returned remains in the conversation; later calls observe reset, rejection and disable.
4. `memory_write` validates a schema supplied by the caller. In the Understand adapter, the worker verifies the source excerpt and stages at most eight proposals per step in worker memory. Proposals are collected only after output checks; project epoch checks stop old in-flight proposals after reset/disable. There is no agent-authored memory file and no immediate sharing of an unreviewed proposal. Existing approval and accepted-output requirements remain.
5. Extend the generic `AgentRuntime.startJob` with optional caller services. A child accesses that service over a private Node IPC channel; initial JobSpec/provider input still uses stdin and events still use stdout. The child receives no database URL, database credentials or project selectors. In-process runtime consumers use the same caller service contract.
6. Only Understand's legacy analyst receives the capability in this pilot. Read memory tools require the agent's existing `read` permission; proposing memory requires `write`. Memory tools are separate from the default kernel-tool list, are explicitly allowlisted in the final JobSpec and are model-only. Codemode cannot invoke them. Jobs without the capability retain their existing tools and process setup.
7. IPC checks operation, allowlist, request identifiers and payload size; caps requests at 512 per child and eight concurrent calls; and uses a ten-second child request timeout. Replies have a 12,000-byte ceiling. Failures return tool errors without database details. Job abort/disconnect removes pending client requests and closes the channel. The service checks cancellation before staging writes.
8. An enabled live-memory analyst step is re-executed on a later run attempt. Its attempt number and the live protocol version participate in the reuse fingerprint, because the worker cannot claim mutable memory was unchanged. Other steps retain the existing retry ledger behavior; downstream dependencies follow its normal fingerprint chain.
9. Existing tool events/spans report each explicit call. Analyst summaries add search/read/write/status call counts and collected candidate counts. No memory body, query or excerpt is added to run console summaries. There is no extra LLM call, embedding service or infrastructure dependency.

## Consequences

- Agents control retrieval and can issue multiple queries during a job. Memory only consumes model context after an explicit read/search response.
- New approvals, rejections, disable and reset affect subsequent calls in already-running jobs. Two reads can intentionally observe different states; reproducibility comes from the tool trace and evidence, not a retained copy of the memory pool.
- Live-memory retries may cost more because participating analyst steps run again. Cost savings must be measured rather than inferred from tool use.
- The runtime remains use-case neutral: its tools call an opaque host service and never implement project lookup or source-validation policy. The orchestrator owns those checks.
- A process channel is an additional host-service boundary and is reviewed by the checks above. It does not give the agent direct database access or a general RPC method surface.

## Alternatives considered

- **Keep a hidden snapshot behind the tools.** Rejected: the user explicitly chose current memory without snapshots.
- **Give the child Postgres credentials.** Rejected: scope enforcement and credentials belong to the worker.
- **Start an HTTP memory server.** Rejected for this local child/worker boundary: IPC needs no listener, token distribution or additional service.
- **Allow direct mutation of shared memory.** Rejected: source verification, output checks, acceptance and review remain required.
