# Observability and telemetry

## Runtime jobs

- **Events**: every runtime job streams `JobEvent`s to the job gateway in `kintsugi-app`:
  - started
  - message deltas
  - tool calls with allow/block decisions
  - tool results
  - outputs
  - usage (tokens, cache tokens, cost, compactions, context peak)
  - spans (job, turn, tool call, compaction, retry)
  - completed / failed (failure reason: `error`, `timeout`, `max-turns`, `budget`, `context-overflow` or `aborted`)
- **Storage and live view**: events are stored in Postgres and pushed to the portal over SSE (`LISTEN/NOTIFY`).
- **Spans** ([ADR-0048](../../decisions/0048-runtime-telemetry-compaction-and-prompt-cache.md)): pi 1.3.0 ships the `pi-telemetry` contract but emits no spans, so the kernel builds them from the session events (`kernel/telemetry.ts`, an adapter that passes pi's conformance suite) and the worker stores them in `monitoring.telemetry_span` (30 days by default, `KINTSUGI_TELEMETRY_RETENTION_DAYS`). They carry counts, sizes and names, never prompts or tool output.
- **Usage and cost**: recorded per job, agent, model and project from pi's `usage` (cache read and write tokens and the cost of compaction summaries included), shown in **Governance → Telemetry** (`telemetry.view`): tokens, cache hit rate (`cacheRead / (input + cacheRead + cacheWrite)`), cost, compactions, tool latency, and a trace per attempt. Monitoring → job runs shows the usage of one run.
- **Session replay**: the session JSONL can be kept for replay and debugging.
- **Export**: OpenTelemetry export is optional (D24). The portal is the default place to look.

## Worker

Every worker process writes a heartbeat to Postgres every 15 seconds (host, pid, version, active jobs, queues; [ADR-0030](../../decisions/0030-worker-heartbeat-in-postgres.md)). The monitoring overview reports a worker as up when it was seen less than 45 seconds ago and flags *No worker is running* otherwise; Monitoring → Worker lists every worker next to the queue counts.


## Member harnesses

The connection of a member (who connected which client to which project, when, and when it was last used) is recorded by the common member base and can be revoked in the portal. Per-member activity and plugin usage are normalized into `HarnessActivity` ([`packages/harness-sdk`](../../../packages/harness-sdk/src/index.ts)) once plugins record them; no activity source ships yet ([ADR-0069](../../decisions/0069-common-member-base-and-plugin-distribution.md)). These will feed the [AI metrics](../../methodology/ai-metrics.md).
