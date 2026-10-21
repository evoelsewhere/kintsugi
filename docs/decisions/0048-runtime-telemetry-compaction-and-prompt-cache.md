# ADR-0048: Runtime telemetry, compaction and prompt-cache policy

- Status: Accepted (builds on [ADR-0018](0018-pin-pi-exact-version.md), [ADR-0023](0023-runtime-as-generic-agent-kernel.md))
- Date: 2026-10-21
- Decision register: D64

## Context

Runtime jobs failed on long inputs with a plain `error` and left almost no trace:

- the only usage record was one `usage` event at the end of a job (input and output tokens, cost), stored in the step's summary. Cache tokens were dropped, a failed job lost its usage, and nothing showed what a turn, a tool call or a compaction cost;
- pi compacts a conversation when it passes `contextWindow - reserveTokens`, with a fixed 16k reserve. That is too little for a 1M window (the summary request can itself overflow), and a job that still overflowed ended as an unclassified `error`;
- `shell` and `git` returned up to 128 KB per call into the context;
- the system prompt put the job's own paths before the skills, the session id was random, so jobs of one agent shared almost nothing in a provider's prompt cache;
- the architecture promised telemetry ("usage and cost per job, agent, model and project") and the portal showed none.

pi 1.3.0 ships the `pi-telemetry` contract (`TelemetryContext`, `TelemetrySpan`) but **emits no spans itself**: nothing in pi calls `startSpan`, and `createAgentSession` takes no telemetry option. The data is in the session events (turns, usage per message, tool durations, compactions, retries).

## Decision

1. **Spans on the `pi-telemetry` contract, built by the kernel.** `kernel/telemetry.ts` implements `TelemetryContext` (and passes pi's adapter conformance suite). The kernel turns session events into spans: `kintsugi.job` (the root, with the job's sums and outcome), `.turn` (tokens, cache tokens, cost, context percent), `.tool` (a tool call; `.codemode` and `.mcp` for those, nested calls under the call that made them), `.compaction` (reason, tokens before and after, summary usage) and `.retry`. Attributes are scalars: counts, sizes and names, never prompts, tool arguments or output. Each settled span is a `span` job event; a span still open when the job ends is closed first, so none is lost. The mock backend reports the same shape.
2. **Usage is complete.** The `usage` event adds cache read and write tokens, turns, compactions and the context peak, and counts the compaction summaries (their model calls bill to the job and to its `maxCostUsd`). A `context-overflow` failure reason separates "the conversation outgrew the window and compacting did not help" from an ordinary provider error.
3. **The worker stores spans** in `monitoring.telemetry_span` (migration 020) with the agent, provider, model and attempt, in batches as they arrive; each run of an agent step is an attempt. Rows are kept `KINTSUGI_TELEMETRY_RETENTION_DAYS` days (default 30). The agent step's summary carries the cache and compaction sums.
4. **Governance → Telemetry shows it** (permission `telemetry.view`): tokens, cache hit rate, cost, compactions, tool latency, by day, agent and model, the attempts, and a trace per attempt. The cache hit rate is `cacheRead / (input + cacheRead + cacheWrite)`. Monitoring → job runs shows the usage of a run.
5. **Compaction is early enough for the window.** `reserveTokens` is 15% of the model's context window (between 16k and 64k, at most half a small window) and `keepRecentTokens` 10% (between 20k and 40k, at most a quarter). The window comes from the model (pi's catalog, or the custom model's `contextWindow`). While a compaction runs the job counts as working, so the idle watchdog does not fire on a slow summary. `shell` and `git` results are cut to pi's limits (2000 lines or 50 KB).
6. **Prompts are cache-friendly.** The system prompt is ordered by how widely each part is shared: the agent's instructions, its skills (text only), then what is specific to a job (workspace paths, where a skill's supporting files were placed). Tools reach pi in the kernel's order. The session id is stable for an agent, version, skills, tools and model, so providers that route by it (OpenAI-style prompt cache keys) share a cache across jobs and repair runs. pi's cache warming is off (its extra requests would bill tokens the job never asked for).
7. **Cache lifetime is a provider setting**, `short` (about 5 minutes, renewed by each hit; the default) or `long` (about an hour, written at a higher price), set in Settings → Providers and passed to the job child as `PI_CACHE_RETENTION` (provider settings live in the database, not the environment). pi has no way to turn caching off.

## Consequences

- A long job compacts before it overflows, and one that still overflows says so. A compaction replaces the conversation prefix, so the next request after it misses the cache once.
- Across jobs of one agent, what is shared is the instructions, skills and tool definitions, as a prefix. Providers that cache by prefix (OpenAI-style, Bedrock) reuse it; Anthropic reads the tool block and the messages but not a system block whose tail differs by job (pi sends it as one block), so the per-job workspace note limits what it can share. Measured, not assumed: the telemetry shows the hit rate per agent.
- Spans are as many rows as turns and tool calls. Retention bounds the table; a deployment that runs very many jobs may lower it.
- pi may start emitting its own spans in a later release; the adapter is the seam where they would be reconciled.
- A killed child process loses its last events, including its root span. The step still fails with the reason the launcher knows.

## Alternatives considered

- **An OpenTelemetry exporter now.** Not built: the adapter is vendor-neutral and an OTel adapter is a second implementation of the same contract when a deployment needs it ([D24](README.md)).
- **Summing usage from `session.getSessionStats()` at the end.** Rejected: a killed child never gets there, and the budget check needs the running total.
- **Moving the workspace note into the first user message** to make the whole system prompt shareable. Rejected for now: pi still appends a per-job `<cwd>` section, so the system prompt cannot be fully shared, and the note belongs with the instructions it explains.
