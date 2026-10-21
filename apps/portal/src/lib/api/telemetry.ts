// Typed access to the telemetry of runtime jobs (Governance → Telemetry, ADR-0048). Mirrors
// apps/api → modules/monitoring/telemetry; needs the telemetry.view permission.

import { apiGet, type Page } from "../api";
import { queryString } from "./job-runs";

export interface TelemetryFilter {
  projectId?: string;
  agent?: string;
  from?: string;
  to?: string;
}

export interface TelemetryTotals {
  jobs: number;
  failedJobs: number;
  overflowFailures: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  /** Share of the prompt read from the cache, 0-1; null without prompt tokens. */
  cacheHitRate: number | null;
  compactions: number;
  retries: number;
  toolCalls: number;
  toolErrors: number;
  toolP95Ms: number | null;
  codemodeCalls: number;
  mcpCalls: number;
}

export interface TelemetryDay {
  day: string;
  jobs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export interface TelemetryBreakdown {
  key: string;
  jobs: number;
  failedJobs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  compactions: number;
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
  compactionReasons: Array<{ reason: string; count: number }>;
  tools: TelemetryToolStat[];
}

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

export type SpanAttributes = Record<string, string | number | boolean>;

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
  attributes: SpanAttributes;
}

export interface Trace {
  runId: string;
  spans: TraceSpan[];
  truncated: boolean;
}

export const telemetryApi = {
  summary: (filter: TelemetryFilter = {}) => apiGet<TelemetrySummary>(`/api/monitoring/telemetry/summary${queryString(filter)}`),
  runs: (filter: TelemetryFilter & { status?: "ok" | "error"; runId?: string; limit?: number; offset?: number } = {}) =>
    apiGet<Page<TelemetryRun>>(`/api/monitoring/telemetry/runs${queryString(filter)}`),
  trace: (runId: string, options: { step?: string; attempt?: number } = {}) =>
    apiGet<Trace>(`/api/monitoring/telemetry/runs/${encodeURIComponent(runId)}/trace${queryString(options)}`),
};
