// Read model of the telemetry of runtime jobs (ADR-0048): what the agent kernel reported while a job
// ran (a span per job, model turn, tool call, compaction and retry), summed and listed. Counts and
// names only, never prompts, tool arguments or output.

/** Which spans a view covers. The window is half-open: `from` included, `to` excluded. */
export interface TelemetryFilter {
  projectId?: string;
  /** An agent id, with or without `@version`. */
  agent?: string;
  from: Date;
  to: Date;
}

export interface TelemetryTotals {
  /** Attempts of an agent job (a retry or a repair run counts as one more). */
  jobs: number;
  failedJobs: number;
  /** Jobs that ended because the conversation outgrew the context window. */
  overflowFailures: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  /** `cacheReadTokens / (inputTokens + cacheReadTokens + cacheWriteTokens)`: the share of the prompt read from the cache; null without prompt tokens. */
  cacheHitRate: number | null;
  compactions: number;
  retries: number;
  /** Tool calls the model made (nested calls of a codemode script included), and how many failed. */
  toolCalls: number;
  toolErrors: number;
  /** 95th percentile of a tool call's duration, ms; null without tool calls. */
  toolP95Ms: number | null;
  codemodeCalls: number;
  mcpCalls: number;
}

export interface TelemetryDay extends Pick<TelemetryTotals, "jobs" | "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "costUsd"> {
  /** UTC date, `YYYY-MM-DD`. */
  day: string;
}

export interface TelemetryBreakdown extends Pick<TelemetryTotals, "jobs" | "failedJobs" | "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "costUsd" | "compactions"> {
  /** `<agent>@<version>`, or `<provider>/<model>`. */
  key: string;
}

export interface TelemetryToolStat {
  tool: string;
  calls: number;
  errors: number;
  p95Ms: number | null;
}

export interface TelemetrySummary {
  from: string;
  to: string;
  totals: TelemetryTotals;
  daily: TelemetryDay[];
  byAgent: TelemetryBreakdown[];
  byModel: TelemetryBreakdown[];
  /** How often each reason started a compaction (`threshold`, `overflow`, `manual`). */
  compactionReasons: Array<{ reason: string; count: number }>;
  /** The most called tools, `codemode` and MCP tools included. */
  tools: TelemetryToolStat[];
}

/** One attempt of an agent job, as the root span reports it. */
export interface TelemetryRun {
  runId: string;
  stepRunId: string | null;
  projectId: string;
  applicationId: string | null;
  agent: string;
  provider: string;
  model: string;
  attempt: number;
  startedAt: string;
  durationMs: number;
  status: "ok" | "error";
  /** `completed`, or the reason the job failed. */
  outcome: string;
  error: string | null;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  compactions: number;
  contextPeakPercent: number | null;
}

export interface TelemetryRunsFilter extends TelemetryFilter {
  /** `ok` or `error`. */
  status?: "ok" | "error";
  limit: number;
  offset: number;
}

/** One span of a trace; the client builds the tree from `parentSpanId`. */
export interface TraceSpan {
  step: string | null;
  attempt: number;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  startedAt: string;
  durationMs: number;
  status: "ok" | "error";
  error: string | null;
  attributes: Record<string, string | number | boolean>;
}

export interface Trace {
  runId: string;
  /** Spans in start order, the oldest first; capped (see `truncated`). */
  spans: TraceSpan[];
  truncated: boolean;
}
