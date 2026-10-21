import { describe, expect, it } from "vitest";
import type { TelemetryDay, TraceSpan } from "./api/telemetry";
import { agentName, buildTrace, sumUsage, cacheHitRate, fillDays, flattenTrace, formatCost, formatMillis, formatRate, formatTokens, spanDetail, spanLabel, windowRange } from "./telemetry";

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
