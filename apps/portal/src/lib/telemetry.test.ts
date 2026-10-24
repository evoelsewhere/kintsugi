import { describe, expect, it } from "vitest";
import type { TelemetryDay, TraceSpan } from "./api/telemetry";
import {
  agentName,
  attentionOf,
  buildTrace,
  cacheHitRate,
  contextSeries,
  fillDays,
  flattenTrace,
  formatAttribute,
  formatCost,
  formatMillis,
  formatRate,
  formatTokens,
  isRunFilter,
  matchesRunFilter,
  pickRun,
  problemKeys,
  runKey,
  spanDetail,
  spanLabel,
  sumUsage,
  windowRange,
  changeOf,
  dailyCacheRate,
  dayMetric,
  formatChange,
  isUsageMetric,
  niceCeil,
  previousRange,
  successRate,
  tokenTotal,
} from "./telemetry";

const span = (over: Partial<TraceSpan> & Pick<TraceSpan, "spanId" | "name">): TraceSpan => ({
  step: "s1",
  attempt: 1,
  parentSpanId: null,
  startedAt: "2026-10-21T10:00:00.000Z",
  durationMs: 10,
  status: "ok",
  error: null,
  attributes: {},
  ...over,
});

describe("formatting", () => {
  it("shortens token counts and keeps small ones whole", () => {
    expect(formatTokens(812)).toBe("812");
    expect(formatTokens(1234)).toBe("1.2K");
    expect(formatTokens(2_500_000)).toBe("2.5M");
    expect(formatTokens(undefined)).toBe("—");
  });

  it("shows cents above a dollar and four decimals below", () => {
    expect(formatCost(0)).toBe("$0");
    expect(formatCost(0.0123)).toBe("$0.0123");
    expect(formatCost(12.345)).toBe("$12.35");
  });

  it("writes a duration in the unit that reads best", () => {
    expect(formatMillis(42)).toBe("42 ms");
    expect(formatMillis(1840)).toBe("1.8 s");
    expect(formatMillis(25_000)).toBe("25 s");
    expect(formatMillis(125_000)).toBe("2 m 05 s");
    expect(formatMillis(null)).toBe("—");
  });

  it("formats a rate as a whole percent and null as a dash", () => {
    expect(formatRate(0.874)).toBe("87%");
    expect(formatRate(null)).toBe("—");
  });

  it("derives the cache hit rate from a row of tokens", () => {
    expect(cacheHitRate({ inputTokens: 200, cacheReadTokens: 800, cacheWriteTokens: 0 })).toBe(0.8);
    expect(cacheHitRate({ inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeNull();
  });

  it("drops the version of an agent", () => {
    expect(agentName("legacy-analyst@1.1.0")).toBe("legacy-analyst");
    expect(agentName("plain")).toBe("plain");
  });
});

describe("windowRange", () => {
  it("ends now and starts the chosen number of days earlier", () => {
    const range = windowRange("7", Date.parse("2026-10-21T12:00:00Z"));
    expect(range).toEqual({ from: "2026-10-14T12:00:00.000Z", to: "2026-10-21T12:00:00.000Z" });
    expect(windowRange("1", Date.parse("2026-10-21T12:00:00Z")).from).toBe("2026-10-20T12:00:00.000Z");
  });
});

describe("fillDays", () => {
  it("adds the days with no job, oldest first, and keeps the ones with data", () => {
    const given: TelemetryDay[] = [{ day: "2026-10-20", jobs: 2, inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.1 }];
    const days = fillDays(given, "2026-10-18T09:00:00Z", "2026-10-21T08:00:00Z");
    expect(days.map((day) => day.day)).toEqual(["2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21"]);
    expect(days.map((day) => day.jobs)).toEqual([0, 0, 2, 0]);
  });
});

describe("buildTrace", () => {
  const spans: TraceSpan[] = [
    span({ spanId: "s1", name: "kintsugi.job", durationMs: 1000, attributes: { agent: "legacy-analyst@1.1.0", turns: 1, inputTokens: 1500, outputTokens: 20 } }),
    span({ spanId: "s2", name: "kintsugi.turn", parentSpanId: "s1", startedAt: "2026-10-21T10:00:00.100Z", durationMs: 600, attributes: { turn: 1, inputTokens: 1500, cacheReadTokens: 4000, contextPercent: 63.4 } }),
    span({ spanId: "s3", name: "kintsugi.codemode", parentSpanId: "s2", startedAt: "2026-10-21T10:00:00.200Z", durationMs: 300, attributes: { tool: "codemode", nestedCalls: 2 } }),
    span({ spanId: "s4", name: "kintsugi.tool", parentSpanId: "s3", startedAt: "2026-10-21T10:00:00.250Z", durationMs: 20, attributes: { tool: "read", nested: true } }),
    span({ spanId: "s5", name: "kintsugi.mcp", parentSpanId: "s9", startedAt: "2026-10-21T10:00:00.700Z", durationMs: 100, status: "error", error: "timeout", attributes: { tool: "mcp__tracker__search" } }),
    span({ spanId: "s6", name: "kintsugi.compaction", parentSpanId: "s2", startedAt: "2026-10-21T10:00:00.500Z", durationMs: 200, attributes: { reason: "threshold", tokensBefore: 90000, tokensAfter: 20000 } }),
  ];

  it("nests the spans under their parents with depth and offset, and roots a span whose parent is missing", () => {
    const { roots, totalMs } = buildTrace(spans);
    expect(roots.map((node) => node.span.spanId)).toEqual(["s1", "s5"]);
    const rows = flattenTrace(roots);
    expect(rows.map((node) => [node.span.spanId, node.depth, node.offsetMs])).toEqual([
      ["s1", 0, 0],
      ["s2", 1, 100],
      ["s3", 2, 200],
      ["s4", 3, 250],
      ["s6", 2, 500],
      ["s5", 0, 700],
    ]);
    expect(totalMs).toBe(1000);
  });

  it("is empty for no spans", () => {
    expect(buildTrace([])).toEqual({ roots: [], totalMs: 0 });
  });

  it("labels and describes each kind of span", () => {
    const by = (id: string): TraceSpan => spans.find((entry) => entry.spanId === id)!;
    expect(spanLabel(by("s1"))).toBe("Job legacy-analyst@1.1.0");
    expect(spanLabel(by("s2"))).toBe("Turn 1");
    expect(spanLabel(by("s3"))).toBe("codemode script");
    expect(spanLabel(by("s4"))).toBe("read");
    expect(spanLabel(by("s5"))).toBe("mcp__tracker__search");
    expect(spanLabel(by("s6"))).toBe("Compaction (threshold)");
    expect(spanDetail(by("s2"))).toBe("in 1.5K · cache read 4K · context 63%");
    expect(spanDetail(by("s3"))).toBe("nested calls 2");
    expect(spanDetail(by("s5"))).toBe("timeout");
    expect(spanDetail(by("s6"))).toBe("90K → 20K tokens");
  });
});

describe("sumUsage", () => {
  it("adds the usage stored on the agent steps and ignores steps without any", () => {
    const steps = [
      { outputSummary: { usage: { inputTokens: 100, outputTokens: 10, costUsd: 0.5, cacheReadTokens: 300, cacheWriteTokens: 50, compactions: 1 } } },
      { outputSummary: { files: 3 } },
      { outputSummary: { usage: { inputTokens: 50, outputTokens: 5, costUsd: 0.25 } } },
      {},
    ];
    expect(sumUsage(steps)).toEqual({ inputTokens: 150, outputTokens: 15, cacheReadTokens: 300, cacheWriteTokens: 50, costUsd: 0.75, compactions: 1 });
  });

  it("is undefined when no step has usage", () => {
    expect(sumUsage([{ outputSummary: { files: 1 } }, {}])).toBeUndefined();
  });
});

describe("attempt filters", () => {
  const ok = { status: "ok" as const, outcome: "completed", compactions: 0, attempt: 1 };
  it("matches each filter on the fields of an attempt", () => {
    expect(matchesRunFilter(ok, "all")).toBe(true);
    expect(matchesRunFilter(ok, "failed")).toBe(false);
    expect(matchesRunFilter({ ...ok, status: "error", outcome: "context-overflow" }, "failed")).toBe(true);
    expect(matchesRunFilter({ ...ok, status: "error", outcome: "context-overflow" }, "overflow")).toBe(true);
    expect(matchesRunFilter({ ...ok, compactions: 2 }, "compacted")).toBe(true);
    expect(matchesRunFilter({ ...ok, attempt: 2 }, "retried")).toBe(true);
    expect(matchesRunFilter(ok, "retried")).toBe(false);
  });

  it("recognises a filter named in a link", () => {
    expect(isRunFilter("failed")).toBe(true);
    expect(isRunFilter("nope")).toBe(false);
    expect(isRunFilter(null)).toBe(false);
  });

  it("builds a stable key and finds the attempt a link names", () => {
    const runs = [
      { runId: "r1", stepRunId: "s1", attempt: 1 },
      { runId: "r1", stepRunId: "s1", attempt: 2 },
      { runId: "r1", stepRunId: null, attempt: 1 },
    ];
    expect(runKey(runs[0]!)).toBe("r1/s1/1");
    expect(runKey(runs[2]!)).toBe("r1//1");
    expect(pickRun(runs, { runId: "r1" })).toBe(runs[0]);
    expect(pickRun(runs, { runId: "r1", step: "s1", attempt: 2 })).toBe(runs[1]);
    expect(pickRun(runs, { runId: "r1", step: "", attempt: 1 })).toBe(runs[2]);
    expect(pickRun(runs, { runId: "other" })).toBeUndefined();
  });
});

describe("attentionOf", () => {
  const quiet = { totals: { jobs: 10, failedJobs: 0, overflowFailures: 0, compactions: 0 }, byAgent: [], tools: [] };

  it("says nothing about a healthy window", () => {
    expect(attentionOf(quiet)).toEqual([]);
  });

  it("puts a context overflow first and counts the other failures separately", () => {
    const items = attentionOf({ ...quiet, totals: { ...quiet.totals, failedJobs: 3, overflowFailures: 1 } });
    expect(items.map((item) => item.id)).toEqual(["overflow", "failed"]);
    expect(items[0]).toMatchObject({ tone: "red", title: "1 job ran out of context", show: { filter: "overflow" } });
    expect(items[1]?.title).toBe("2 jobs failed");
  });

  it("flags an agent that reads little from the cache, but only with enough jobs", () => {
    const row = { key: "legacy-analyst@1.0.0", jobs: 5, inputTokens: 900, cacheReadTokens: 50, cacheWriteTokens: 50 };
    const [item] = attentionOf({ ...quiet, byAgent: [row] });
    expect(item).toMatchObject({ id: "cache:legacy-analyst@1.0.0", show: { agent: "legacy-analyst@1.0.0" } });
    expect(attentionOf({ ...quiet, byAgent: [{ ...row, jobs: 2 }] })).toEqual([]);
    expect(attentionOf({ ...quiet, byAgent: [{ ...row, cacheReadTokens: 900 }] })).toEqual([]);
  });

  it("flags a tool that fails often and jobs that mostly compact", () => {
    const items = attentionOf({ ...quiet, totals: { ...quiet.totals, compactions: 6 }, tools: [{ tool: "mcp__tracker__search", calls: 10, errors: 3 }, { tool: "read", calls: 100, errors: 1 }] });
    expect(items.map((item) => item.id)).toEqual(["tool:mcp__tracker__search", "compacting"]);
  });
});

describe("contextSeries", () => {
  const start = "2026-10-21T10:00:00.000Z";
  const at = (ms: number): string => new Date(Date.parse(start) + ms).toISOString();

  it("reads the window fill after each turn and the compactions between them", () => {
    const spans = [
      span({ spanId: "j", name: "kintsugi.job", startedAt: start, durationMs: 9000 }),
      span({ spanId: "t2", name: "kintsugi.turn", startedAt: at(4000), durationMs: 1000, attributes: { turn: 2, contextPercent: 30 } }),
      span({ spanId: "t1", name: "kintsugi.turn", startedAt: at(0), durationMs: 2000, attributes: { turn: 1, contextPercent: 70 } }),
      span({ spanId: "c", name: "kintsugi.compaction", startedAt: at(3000), durationMs: 800, attributes: { reason: "threshold", tokensBefore: 90_000, tokensAfter: 20_000 } }),
    ];
    const series = contextSeries(spans);
    expect(series.totalMs).toBe(9000);
    expect(series.points).toEqual([
      { offsetMs: 2000, turn: 1, percent: 70 },
      { offsetMs: 5000, turn: 2, percent: 30 },
    ]);
    expect(series.markers).toEqual([{ offsetMs: 3000, reason: "threshold", tokensBefore: 90_000, tokensAfter: 20_000 }]);
  });

  it("is empty without spans and skips turns that report no window share", () => {
    expect(contextSeries([])).toEqual({ points: [], markers: [], totalMs: 0 });
    expect(contextSeries([span({ spanId: "t", name: "kintsugi.turn", attributes: { turn: 1 } })]).points).toEqual([]);
  });
});

describe("problemKeys", () => {
  it("keeps each failed span with its ancestors", () => {
    const spans = [
      span({ spanId: "job", name: "kintsugi.job", status: "error" }),
      span({ spanId: "turn", name: "kintsugi.turn", parentSpanId: "job" }),
      span({ spanId: "tool", name: "kintsugi.tool", parentSpanId: "turn", status: "error" }),
      span({ spanId: "read", name: "kintsugi.tool", parentSpanId: "turn" }),
    ];
    expect([...problemKeys(spans)].sort()).toEqual(["job", "tool", "turn"]);
    expect(problemKeys([span({ spanId: "a", name: "kintsugi.job" })]).size).toBe(0);
  });
});

describe("formatAttribute", () => {
  it("groups big numbers and keeps text as is", () => {
    expect(formatAttribute(12345.678912)).toBe("12,345.6789");
    expect(formatAttribute("threshold")).toBe("threshold");
    expect(formatAttribute(true)).toBe("true");
  });
});

describe("overview helpers", () => {
  it("takes the previous period of the same length", () => {
    const range = { from: "2026-10-10T00:00:00.000Z", to: "2026-10-17T00:00:00.000Z" };
    expect(previousRange(range)).toEqual({ from: "2026-10-03T00:00:00.000Z", to: "2026-10-10T00:00:00.000Z" });
  });

  it("computes and formats the change, with no comparison against zero", () => {
    expect(changeOf(12, 10)).toBeCloseTo(0.2);
    expect(changeOf(5, 0)).toBeNull();
    expect(changeOf(5, undefined)).toBeNull();
    expect(formatChange(0.124)).toBe("+12%");
    expect(formatChange(-0.5)).toBe("−50%");
    expect(formatChange(0.001)).toBe("0%");
    expect(formatChange(12)).toBe("+999%+");
    expect(formatChange(null)).toBe("—");
  });

  it("sums tokens, rates success and picks the metric of a day", () => {
    const day = { day: "2026-10-01", jobs: 4, inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 20, costUsd: 0.5 };
    expect(tokenTotal(day)).toBe(135);
    expect(successRate({ jobs: 4, failedJobs: 1 })).toBe(0.75);
    expect(successRate({ jobs: 0, failedJobs: 0 })).toBeNull();
    expect([dayMetric(day, "cost"), dayMetric(day, "jobs"), dayMetric(day, "tokens")]).toEqual([0.5, 4, 135]);
    expect(isUsageMetric("cost")).toBe(true);
    expect(isUsageMetric("x")).toBe(false);
  });

  it("carries the cache rate over a day without prompts", () => {
    const base = { day: "d", jobs: 0, outputTokens: 0, costUsd: 0 };
    expect(dailyCacheRate([{ ...base, inputTokens: 50, cacheReadTokens: 50, cacheWriteTokens: 0 }, { ...base, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }])).toEqual([0.5, 0.5]);
  });

  it("rounds an axis top up to 1, 2, 2.5 or 5 times a power of ten", () => {
    expect([niceCeil(0), niceCeil(0.7), niceCeil(1.3), niceCeil(2.2), niceCeil(3.4), niceCeil(7), niceCeil(1200)]).toEqual([1, 1, 2, 2.5, 5, 10, 2000]);
  });
});
