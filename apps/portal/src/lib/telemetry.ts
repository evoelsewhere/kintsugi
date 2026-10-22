// Aggregation and formatting for the telemetry views (Governance → Telemetry, ADR-0048): pure
// functions, tested in telemetry.test.ts (the portal has no component tests).

import type { SpanAttributes, TelemetryDay, TraceSpan } from "./api/telemetry";

export const WINDOWS = [
  { id: "1", label: "24 hours", days: 1 },
  { id: "7", label: "7 days", days: 7 },
  { id: "30", label: "30 days", days: 30 },
  { id: "90", label: "90 days", days: 90 },
] as const;
export type WindowId = (typeof WINDOWS)[number]["id"];

/** The window ending at `now`, as the ISO instants the API takes. */
export function windowRange(id: WindowId, now: number = Date.now()): { from: string; to: string } {
  const days = WINDOWS.find((entry) => entry.id === id)?.days ?? 7;
  return { from: new Date(now - days * 86_400_000).toISOString(), to: new Date(now).toISOString() };
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** 1 234 567 → "1.2M"; small numbers stay whole. */
export function formatTokens(value: number | undefined): string {
  if (value === undefined) return "—";
  return Math.abs(value) < 1000 ? String(Math.round(value)) : compact.format(value);
}

/** Dollars: cents for amounts of a dollar or more, four decimals below (a single job often costs a fraction of a cent). */
export function formatCost(usd: number | undefined): string {
  if (usd === undefined) return "—";
  if (usd === 0) return "$0";
  return usd >= 1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`;
}

/** Durations of a tool call or a span: milliseconds below a second, then seconds, then minutes. */
export function formatMillis(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes} m ${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")} s`;
}

/** 0.874 → "87%"; null → "—". */
export function formatRate(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? "—" : `${Math.round(rate * 100)}%`;
}

export function formatPercentPoint(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${Math.round(value)}%`;
}

/** The share of the prompt read from the cache for one row of tokens. */
export function cacheHitRate(row: { inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }): number | null {
  const prompt = row.inputTokens + row.cacheReadTokens + row.cacheWriteTokens;
  return prompt === 0 ? null : row.cacheReadTokens / prompt;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  compactions: number;
}

/**
 * The usage the worker stored on the agent steps of a run (`outputSummary.usage`), summed; undefined
 * when no step has any (a script-only run, or an older run).
 */
export function sumUsage(steps: ReadonlyArray<{ outputSummary?: Record<string, unknown> | undefined }>): UsageTotals | undefined {
  let found = false;
  const sum: UsageTotals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, compactions: 0 };
  for (const step of steps) {
    const usage = step.outputSummary?.["usage"];
    if (typeof usage !== "object" || usage === null) continue;
    found = true;
    const entry = usage as Record<string, unknown>;
    for (const key of Object.keys(sum) as Array<keyof UsageTotals>) {
      const value = entry[key];
      if (typeof value === "number") sum[key] += value;
    }
  }
  return found ? sum : undefined;
}

/** `legacy-analyst@1.1.0` → `legacy-analyst`. */
export const agentName = (agent: string): string => agent.split("@")[0] ?? agent;

/** Fills the days with no job so a chart's axis is continuous, oldest first. */
export function fillDays(days: readonly TelemetryDay[], from: string, to: string): TelemetryDay[] {
  const byDay = new Map(days.map((day) => [day.day, day]));
  const filled: TelemetryDay[] = [];
  const end = new Date(to);
  const cursor = new Date(from);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor <= end && filled.length < 120) {
    const key = cursor.toISOString().slice(0, 10);
    filled.push(byDay.get(key) ?? { day: key, jobs: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return filled;
}

export interface TraceNode {
  span: TraceSpan;
  depth: number;
  /** Milliseconds from the start of the trace. */
  offsetMs: number;
  children: TraceNode[];
}

/**
 * The spans of one attempt as a tree in start order, each with its depth and its offset from the first
 * span. A span whose parent is not in the list (a retained-window edge) becomes a root.
 */
export function buildTrace(spans: readonly TraceSpan[]): { roots: TraceNode[]; totalMs: number } {
  if (spans.length === 0) return { roots: [], totalMs: 0 };
  const start = Math.min(...spans.map((span) => Date.parse(span.startedAt)));
  const nodes = new Map<string, TraceNode>();
  for (const span of spans) nodes.set(span.spanId, { span, depth: 0, offsetMs: Math.max(0, Date.parse(span.startedAt) - start), children: [] });
  const roots: TraceNode[] = [];
  for (const span of spans) {
    const node = nodes.get(span.spanId)!;
    const parent = span.parentSpanId === null ? undefined : nodes.get(span.parentSpanId);
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }
  const place = (node: TraceNode, depth: number): void => {
    node.depth = depth;
    for (const child of node.children) place(child, depth + 1);
  };
  for (const root of roots) place(root, 0);
  const end = Math.max(...spans.map((span) => Date.parse(span.startedAt) - start + span.durationMs));
  return { roots, totalMs: Math.max(end, 1) };
}

/** The nodes in display order (depth first). */
export function flattenTrace(roots: readonly TraceNode[]): TraceNode[] {
  const rows: TraceNode[] = [];
  const visit = (node: TraceNode): void => {
    rows.push(node);
    for (const child of node.children) visit(child);
  };
  for (const root of roots) visit(root);
  return rows;
}

const number = (attributes: SpanAttributes, name: string): number | undefined => (typeof attributes[name] === "number" ? (attributes[name] as number) : undefined);

/** A short name for a span row: the tool for tool calls, the turn number for turns, the reason for compactions. */
export function spanLabel(span: TraceSpan): string {
  const a = span.attributes;
  switch (span.name) {
    case "kintsugi.job":
      return `Job ${typeof a["agent"] === "string" ? a["agent"] : ""}`.trim();
    case "kintsugi.turn":
      return `Turn ${number(a, "turn") ?? ""}`.trim();
    case "kintsugi.tool":
      return typeof a["tool"] === "string" ? a["tool"] : "tool";
    case "kintsugi.codemode":
      return "codemode script";
    case "kintsugi.mcp":
      return typeof a["tool"] === "string" ? a["tool"] : "MCP call";
    case "kintsugi.compaction":
      return `Compaction (${typeof a["reason"] === "string" ? a["reason"] : "?"})`;
    case "kintsugi.retry":
      return `Retry ${number(a, "attempt") ?? ""} of ${number(a, "maxAttempts") ?? "?"}`.trim();
    default:
      return span.name.replace("kintsugi.", "");
  }
}

/** One line of detail for a span row: tokens of a turn, tokens before and after a compaction, nested calls of a script. */
export function spanDetail(span: TraceSpan): string {
  const a = span.attributes;
  const parts: string[] = [];
  const push = (label: string, value: number | undefined, format: (n: number) => string = formatTokens): void => {
    if (value !== undefined && value > 0) parts.push(`${label} ${format(value)}`);
  };
  switch (span.name) {
    case "kintsugi.turn":
      push("in", number(a, "inputTokens"));
      push("out", number(a, "outputTokens"));
      push("cache read", number(a, "cacheReadTokens"));
      push("context", number(a, "contextPercent"), (n) => `${Math.round(n)}%`);
      break;
    case "kintsugi.compaction": {
      const before = number(a, "tokensBefore");
      const after = number(a, "tokensAfter");
      if (before !== undefined) parts.push(after === undefined ? `${formatTokens(before)} tokens` : `${formatTokens(before)} → ${formatTokens(after)} tokens`);
      break;
    }
    case "kintsugi.codemode":
      push("nested calls", number(a, "nestedCalls"), String);
      break;
    case "kintsugi.job":
      push("turns", number(a, "turns"), String);
      push("in", number(a, "inputTokens"));
      push("out", number(a, "outputTokens"));
      push("cache read", number(a, "cacheReadTokens"));
      push("compactions", number(a, "compactions"), String);
      break;
    default:
      break;
  }
  if (span.status === "error" && span.error !== null) parts.push(span.error);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// What needs attention, the attempts filter and the context-window chart of a trace.

export type RunFilter = "all" | "failed" | "overflow" | "compacted" | "retried";

export const RUN_FILTERS: ReadonlyArray<{ id: RunFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "failed", label: "Failed" },
  { id: "overflow", label: "Ran out of context" },
  { id: "compacted", label: "Compacted" },
  { id: "retried", label: "Retried" },
];

type RunLike = { status: "ok" | "error"; outcome: string; compactions: number; attempt: number };

export function matchesRunFilter(run: RunLike, filter: RunFilter): boolean {
  switch (filter) {
    case "failed":
      return run.status === "error";
    case "overflow":
      return run.outcome === "context-overflow";
    case "compacted":
      return run.compactions > 0;
    case "retried":
      return run.attempt > 1;
    default:
      return true;
  }
}

export const isRunFilter = (value: string | null): value is RunFilter => RUN_FILTERS.some((entry) => entry.id === value);

/** The key of one attempt in a list and in a link. */
export const runKey = (run: { runId: string; stepRunId: string | null; attempt: number }): string => `${run.runId}/${run.stepRunId ?? ""}/${run.attempt}`;

export interface Attention {
  id: string;
  tone: "red" | "orange";
  title: string;
  detail: string;
  /** What the "Show" action sets: the attempts filter, and/or an agent. */
  show?: { filter?: RunFilter; agent?: string };
}

interface SummaryLike {
  totals: { jobs: number; failedJobs: number; overflowFailures: number; compactions: number };
  byAgent: ReadonlyArray<{ key: string; jobs: number; inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }>;
  tools: ReadonlyArray<{ tool: string; calls: number; errors: number }>;
}

/** The few things worth a person's attention in a window, most serious first. */
export function attentionOf(summary: SummaryLike): Attention[] {
  const items: Attention[] = [];
  const { totals } = summary;
  if (totals.overflowFailures > 0) {
    items.push({
      id: "overflow",
      tone: "red",
      title: `${totals.overflowFailures} job${totals.overflowFailures === 1 ? "" : "s"} ran out of context`,
      detail: "Compaction could not recover the conversation. Select fewer items per run, or bind the agent to a model with a larger window.",
      show: { filter: "overflow" },
    });
  }
  const otherFailures = totals.failedJobs - totals.overflowFailures;
  if (otherFailures > 0) {
    items.push({ id: "failed", tone: "orange", title: `${otherFailures} job${otherFailures === 1 ? "" : "s"} failed`, detail: "Open an attempt for its trace, and the run's log in Monitoring for the error.", show: { filter: "failed" } });
  }
  for (const row of summary.byAgent) {
    const rate = cacheHitRate(row);
    if (row.jobs >= 3 && rate !== null && rate < 0.3) {
      items.push({
        id: `cache:${row.key}`,
        tone: "orange",
        title: `${agentName(row.key)} reads only ${formatRate(rate)} of its prompt from the cache`,
        detail: "Cache entries last about 5 minutes: if its jobs start minutes apart, set the provider's prompt cache to long (Settings → Providers).",
        show: { agent: row.key },
      });
    }
  }
  for (const tool of summary.tools) {
    if (tool.calls >= 5 && tool.errors / tool.calls >= 0.2) {
      items.push({ id: `tool:${tool.tool}`, tone: "orange", title: `${tool.tool} fails in ${Math.round((tool.errors / tool.calls) * 100)}% of its calls`, detail: `${tool.errors} of ${tool.calls} calls failed. Check the server, or the allowed tools of an MCP server.` });
    }
  }
  if (totals.jobs >= 5 && totals.compactions / totals.jobs >= 0.5) {
    items.push({ id: "compacting", tone: "orange", title: "Most jobs compact their conversation", detail: "Each compaction rewrites the prompt prefix, so the next request misses the cache. Fewer items per run keeps jobs inside the window.", show: { filter: "compacted" } });
  }
  return items.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "red" ? -1 : 1));
}

export interface ContextPoint {
  /** Milliseconds from the start of the trace, at the end of the turn. */
  offsetMs: number;
  turn: number;
  percent: number;
}

export interface ContextMarker {
  offsetMs: number;
  reason: string;
  tokensBefore?: number;
  tokensAfter?: number;
}

/** How full the context window was after each turn, and where compactions happened: the data of the context chart. */
export function contextSeries(spans: readonly TraceSpan[]): { points: ContextPoint[]; markers: ContextMarker[]; totalMs: number } {
  if (spans.length === 0) return { points: [], markers: [], totalMs: 0 };
  const start = Math.min(...spans.map((span) => Date.parse(span.startedAt)));
  const totalMs = Math.max(1, ...spans.map((span) => Date.parse(span.startedAt) - start + span.durationMs));
  const points: ContextPoint[] = [];
  const markers: ContextMarker[] = [];
  for (const span of spans) {
    const offsetMs = Date.parse(span.startedAt) - start;
    const attributes = span.attributes;
    if (span.name === "kintsugi.turn" && typeof attributes["contextPercent"] === "number") {
      points.push({ offsetMs: offsetMs + span.durationMs, turn: typeof attributes["turn"] === "number" ? attributes["turn"] : points.length + 1, percent: attributes["contextPercent"] });
    } else if (span.name === "kintsugi.compaction") {
      markers.push({
        offsetMs,
        reason: typeof attributes["reason"] === "string" ? attributes["reason"] : "?",
        ...(typeof attributes["tokensBefore"] === "number" ? { tokensBefore: attributes["tokensBefore"] } : {}),
        ...(typeof attributes["tokensAfter"] === "number" ? { tokensAfter: attributes["tokensAfter"] } : {}),
      });
    }
  }
  points.sort((a, b) => a.offsetMs - b.offsetMs);
  return { points, markers, totalMs };
}

/** The spans that failed and every span above them, so a failure can be read in its place. */
export function problemKeys(spans: readonly TraceSpan[]): Set<string> {
  const byId = new Map(spans.map((span) => [span.spanId, span]));
  const keep = new Set<string>();
  for (const span of spans) {
    if (span.status !== "error") continue;
    let current: TraceSpan | undefined = span;
    while (current !== undefined && !keep.has(current.spanId)) {
      keep.add(current.spanId);
      current = current.parentSpanId === null ? undefined : byId.get(current.parentSpanId);
    }
  }
  return keep;
}

/** The attempt a link names: a run id, optionally narrowed by step and attempt; the first match when it names none. */
export function pickRun<T extends { runId: string; stepRunId: string | null; attempt: number }>(runs: readonly T[], target: { runId: string; step?: string | null; attempt?: number | null }): T | undefined {
  return runs.find(
    (run) => run.runId === target.runId && (target.step == null || (run.stepRunId ?? "") === target.step) && (target.attempt == null || run.attempt === target.attempt),
  );
}

/** An attribute value as a table cell shows it. */
export function formatAttribute(value: string | number | boolean): string {
  return typeof value === "number" ? value.toLocaleString("en-US", { maximumFractionDigits: 4 }) : String(value);
}
