# Observability and telemetry

## Runtime jobs

- **Events**: every runtime job streams `JobEvent`s to the job gateway in `kintsugi-app`:
  - started
  - message deltas
  - tool calls with allow/block decisions
  - tool results
  - outputs
  - usage
  - completed / failed (failure reason: `error`, `timeout`, `max-turns`, `budget` or `aborted`)
- **Storage and live view**: events are stored in Postgres and pushed to the portal over SSE (`LISTEN/NOTIFY`).
- **Usage and cost**: recorded per job, agent, model and project (`UsageRecord`), from pi's `usage.cost`.
- **Session replay**: the session JSONL can be kept for replay and debugging.
- **Export**: OpenTelemetry export is optional (D24). The portal is the default place to look.

## Worker

Every worker process writes a heartbeat to Postgres every 15 seconds (host, pid, version, active jobs, queues; [ADR-0030](../../decisions/0030-worker-heartbeat-in-postgres.md)). The monitoring overview reports a worker as up when it was seen less than 45 seconds ago and flags *No worker is running* otherwise; Monitoring → Worker lists every worker next to the queue counts.

## Member harnesses

Activity from members' harnesses is normalized into `HarnessActivity` ([`packages/harness-sdk`](../../../packages/harness-sdk/src/index.ts)) from several sources of varying detail. The full list is in [harness integration → telemetry sources](../../reference/harness-integration.md#6-telemetry-sources).

| Source | Priority | Reasoning |
|---|---|---|
| Kintsugi MCP / CLI | Primary | Always available; tied to work items |
| Built-in plugin hooks | Supplementary | Session, write and blocked-write events plus active plugin versions; only where hooks are supported and enabled |
| Git / PR conventions (trailers, PR template) | Primary | Mandatory, checked by gates |
| OTel from Claude Code / Codex | Supplementary | Optional; needs managed config |
| Vendor metrics APIs (Copilot, ChatGPT Enterprise) | Supplementary | Aggregated only; depends on license tier |

These feed the [AI metrics](../../methodology/ai-metrics.md).
