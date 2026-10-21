// The job's telemetry adapter against pi-telemetry's conformance suite, plus the spans the
// kernel builds from session events (ADR-0048).

import { createTelemetryAdapterConformance, type TelemetryAdapterFixture } from "@earendil-works/pi-telemetry/testing";
import type { JobSpan } from "@kintsugi/runtime-sdk";
import { describe, expect, it } from "vitest";
import { beginSpan, JobTelemetry } from "../src/kernel/telemetry.js";

const conformance = createTelemetryAdapterConformance(async () => {
  const telemetry = new JobTelemetry(() => undefined, { retain: true });
  return {
    context: telemetry,
    getSpans: async () => {
      await telemetry.whenIdle();
      return telemetry.snapshot();
    },
    async [Symbol.asyncDispose]() {},
  } satisfies TelemetryAdapterFixture;
});

for (const group of new Set(conformance.map((testCase) => testCase.group))) {
  describe(`JobTelemetry conformance: ${group}`, () => {
    for (const testCase of conformance.filter((candidate) => candidate.group === group)) {
      it(testCase.name, () => testCase.run());
    }
  });
}

describe("JobTelemetry spans", () => {
  const collect = (): { spans: JobSpan[]; telemetry: JobTelemetry } => {
    const spans: JobSpan[] = [];
    return { spans, telemetry: new JobTelemetry((span) => spans.push(span)) };
  };

  it("hands each settled span to the sink with its parent, start time, duration and scalar attributes", async () => {
    const { spans, telemetry } = collect();
    await telemetry.startSpan({ name: "kintsugi.job", attributes: { agent: "a", tags: ["x", "y"], skipped: undefined } }, async (job) => {
      await job.startSpan({ name: "kintsugi.turn", attributes: { turn: 1 } }, async (turn) => {
        turn.setAttributes({ inputTokens: 10 });
        await new Promise((resolve) => setTimeout(resolve, 15));
      });
    });
    expect(spans.map((span) => span.name)).toEqual(["kintsugi.turn", "kintsugi.job"]);
    const [turn, job] = spans as [JobSpan, JobSpan];
    expect(turn.parentId).toBe(job.id);
    expect(job.parentId).toBeUndefined();
    expect(turn.durationMs).toBeGreaterThanOrEqual(10);
    expect(Date.parse(turn.startedAt)).not.toBeNaN();
    expect(job.attributes).toEqual({ agent: "a", tags: "x,y" });
    expect(turn.attributes).toEqual({ turn: 1, inputTokens: 10 });
    expect(turn.status).toBe("ok");
  });

  it("records a failed span as an error with its message", async () => {
    const { spans, telemetry } = collect();
    await expect(telemetry.startSpan({ name: "kintsugi.tool" }, () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(spans[0]).toMatchObject({ name: "kintsugi.tool", status: "error", error: "boom" });
  });

  it("never lets a failing sink fail the work", async () => {
    const telemetry = new JobTelemetry(() => {
      throw new Error("sink down");
    });
    await expect(telemetry.startSpan({ name: "x" }, () => 42)).resolves.toBe(42);
  });

  it("opens a span that stays open until the kernel closes it, under another span", async () => {
    const { spans, telemetry } = collect();
    const job = beginSpan(telemetry, "kintsugi.job", { agent: "a" });
    const compaction = beginSpan(job.span, "kintsugi.compaction", { reason: "threshold" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(spans).toEqual([]);
    compaction.end({ tokensBefore: 1000 });
    job.end({ turns: 2 }, { status: "error", error: { name: "Error", message: "failed" } });
    job.end({ ignored: true });
    await telemetry.whenIdle();
    expect(spans.map((span) => span.name)).toEqual(["kintsugi.compaction", "kintsugi.job"]);
    expect(spans[0]?.attributes).toEqual({ reason: "threshold", tokensBefore: 1000 });
    expect(spans[1]).toMatchObject({ status: "error", error: "failed", attributes: { agent: "a", turns: 2 } });
  });
});
