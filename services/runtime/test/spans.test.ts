// The spans of a job (ADR-0048): a root, a span per turn and tool call, compactions and retries,
// all before the usage and end events, with their parents.

import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { JobEvent, JobSpan } from "@kintsugi/runtime-sdk";
import { afterAll, describe, expect, it } from "vitest";
import { startMockJob } from "../src/mock-agent.js";
import { KernelJob } from "../src/kernel/job.js";
import { agent, createWorkspace, fauxRuntime, jobSpec, runJob } from "./helpers.js";

const workspace = createWorkspace();
afterAll(() => workspace.remove());

const spansOf = (events: JobEvent[]): JobSpan[] => events.flatMap((event) => (event.type === "span" ? [event.span] : []));
const byName = (spans: JobSpan[], name: string): JobSpan[] => spans.filter((span) => span.name === name);

describe("spans of a pi job", () => {
  it("builds a root, a turn per model call and a tool span per tool call, and sends them before usage", async () => {
    const runtime = await fauxRuntime([
      fauxAssistantMessage([fauxToolCall("read", { path: "hello.txt" }, { id: "read-1" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]);
    const { events, done } = await runJob(runtime, jobSpec(workspace, agent(["read"])));
    expect(done.type).toBe("job.completed");
    const spans = spansOf(events);
    const [root] = byName(spans, "kintsugi.job");
    const turns = byName(spans, "kintsugi.turn");
    const [tool] = byName(spans, "kintsugi.tool");
    expect(root).toMatchObject({ status: "ok", attributes: { agent: "test-agent", provider: "faux", model: "m1", turns: 2, outcome: "completed" } });
    expect(turns).toHaveLength(2);
    expect(turns.every((turn) => turn.parentId === root?.id)).toBe(true);
    expect(tool).toMatchObject({ status: "ok", attributes: { tool: "read", ok: true } });
    expect(tool?.parentId).toBe(turns[0]?.id);
    // Every span precedes `usage`, which precedes the end event.
    const order = events.map((event) => event.type);
    expect(order.lastIndexOf("span")).toBeLessThan(order.indexOf("usage"));
    expect(order.indexOf("usage")).toBeLessThan(order.indexOf("job.completed"));
    expect(root?.attributes["inputTokens"]).toBe(turns.reduce((sum, turn) => sum + Number(turn.attributes["inputTokens"]), 0));
  });

  it("marks the root and the open spans of a failed job as errors", async () => {
    const failing = () => fauxAssistantMessage("", { stopReason: "error", errorMessage: "upstream 500" });
    const runtime = await fauxRuntime([failing, failing, failing, failing]);
    const { events, done } = await runJob(runtime, jobSpec(workspace, agent([])));
    expect(done).toMatchObject({ type: "job.failed", reason: "error" });
    const [root] = byName(spansOf(events), "kintsugi.job");
    expect(root).toMatchObject({ status: "error", error: "upstream 500", attributes: { outcome: "error" } });
  });
});

describe("spans of a scripted session", () => {
  function session(script: (emit: (event: unknown) => void) => void): AgentSession {
    let listener: ((event: AgentSessionEvent) => void) | undefined;
    return {
      subscribe: (next: (event: AgentSessionEvent) => void) => {
        listener = next;
        return () => undefined;
      },
      prompt: async () => script((event) => listener?.(event as AgentSessionEvent)),
      abort: async () => undefined,
      getContextUsage: () => ({ tokens: 0, contextWindow: 0, percent: 55 }),
      dispose: () => undefined,
    } as unknown as AgentSession;
  }

  async function play(script: (emit: (event: unknown) => void) => void): Promise<JobSpan[]> {
    const job = new KernelJob("job-1", jobSpec(workspace, agent([])), "0.0.0");
    const events: JobEvent[] = [];
    const reading = (async () => {
      for await (const event of job.events) events.push(event);
    })();
    await job.run(session(script), () => undefined);
    await job.done;
    await reading;
    return spansOf(events);
  }

  it("spans a compaction and a retry, and puts codemode's nested calls under the call that made them", async () => {
    const spans = await play((emit) => {
      emit({ type: "turn_start" });
      emit({ type: "compaction_start", reason: "threshold" });
      emit({ type: "compaction_end", reason: "threshold", aborted: false, willRetry: false, result: { tokensBefore: 90_000, estimatedTokensAfter: 20_000, usage: { input: 5, output: 2 } } });
      emit({ type: "auto_retry_start", attempt: 1, maxAttempts: 2, delayMs: 10, errorMessage: "upstream 500" });
      emit({ type: "auto_retry_end", success: true, attempt: 1 });
      emit({ type: "tool_execution_start", toolCallId: "c1", toolName: "codemode", args: {} });
      emit({ type: "tool_execution_start", toolCallId: "c1/1", toolName: "read", args: {} });
      emit({ type: "tool_execution_end", toolCallId: "c1/1", toolName: "read", result: {}, isError: false, durationMs: 3 });
      emit({ type: "tool_execution_start", toolCallId: "c1/2", toolName: "mcp__tracker__search", args: {} });
      emit({ type: "tool_execution_end", toolCallId: "c1/2", toolName: "mcp__tracker__search", result: {}, isError: true, durationMs: 40 });
      emit({ type: "tool_execution_end", toolCallId: "c1", toolName: "codemode", result: {}, isError: false, durationMs: 60 });
      emit({ type: "turn_end" });
      emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", usage: {} } });
    });
    const [compaction] = byName(spans, "kintsugi.compaction");
    expect(compaction).toMatchObject({ status: "ok", attributes: { reason: "threshold", tokensBefore: 90_000, tokensAfter: 20_000, summaryInputTokens: 5 } });
    expect(byName(spans, "kintsugi.retry")[0]).toMatchObject({ status: "ok", attributes: { attempt: 1, success: true } });
    const [codemode] = byName(spans, "kintsugi.codemode");
    const [read] = byName(spans, "kintsugi.tool");
    const [mcp] = byName(spans, "kintsugi.mcp");
    expect(codemode).toMatchObject({ attributes: { tool: "codemode", nestedCalls: 2, executeMs: 60 } });
    expect(read).toMatchObject({ parentId: codemode?.id, attributes: { tool: "read", nested: true, executeMs: 3 } });
    expect(mcp).toMatchObject({ parentId: codemode?.id, status: "error", attributes: { server: "tracker", nested: true } });
    expect(byName(spans, "kintsugi.turn")[0]?.attributes["contextPercent"]).toBe(55);
  });

  it("settles a span still open when the job ends, so none is lost", async () => {
    const spans = await play((emit) => {
      emit({ type: "turn_start" });
      emit({ type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: {} });
      emit({ type: "compaction_start", reason: "overflow" });
      emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", usage: {} } });
    });
    expect(byName(spans, "kintsugi.tool")[0]).toMatchObject({ attributes: { ok: false, ended: "job" } });
    expect(byName(spans, "kintsugi.compaction")[0]?.attributes["ended"]).toBe("job");
    expect(byName(spans, "kintsugi.job")).toHaveLength(1);
  });
});

describe("spans of a mock job", () => {
  it("reports the same shape with fixed numbers", async () => {
    const job = startMockJob(jobSpec(workspace, agent(["read", "write"]), { maxTurns: 2 }), "0.0.0");
    const events: JobEvent[] = [];
    for await (const event of job.events) events.push(event);
    const spans = spansOf(events);
    expect(byName(spans, "kintsugi.job")).toHaveLength(1);
    expect(byName(spans, "kintsugi.turn")).toHaveLength(2);
    expect(byName(spans, "kintsugi.tool")).toHaveLength(2);
    const usage = events.find((event) => event.type === "usage");
    expect(usage).toMatchObject({ cacheReadTokens: 128, turns: 2, compactions: 0 });
  });
});
