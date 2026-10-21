// What a job reports about its context window and its prompt cache (ADR-0048): cache tokens,
// compactions, the peak of the window, an overflow that could not be recovered, and the budget.
// The sessions are scripted: the faux provider reports no cache, no cost and no compaction.

import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { afterAll, describe, expect, it } from "vitest";
import { KernelJob } from "../src/kernel/job.js";
import { agent, createWorkspace, jobSpec, sleep } from "./helpers.js";

const workspace = createWorkspace();
afterAll(() => workspace.remove());

/** A scripted pi session: `script` receives an `emit` that plays events to the job's listener. */
function scriptedSession(script: (emit: (event: unknown) => void) => void | Promise<void>, contextPercent?: () => number | undefined): AgentSession {
  let listener: ((event: AgentSessionEvent) => void) | undefined;
  return {
    subscribe: (next: (event: AgentSessionEvent) => void) => {
      listener = next;
      return () => undefined;
    },
    prompt: async () => script((event) => listener?.(event as AgentSessionEvent)),
    abort: async () => undefined,
    getContextUsage: () => {
      const percent = contextPercent?.();
      return percent === undefined ? undefined : { tokens: 0, contextWindow: 0, percent };
    },
    dispose: () => undefined,
  } as unknown as AgentSession;
}

const answer = (usage: Record<string, unknown>) => ({ type: "message_end", message: { role: "assistant", stopReason: "stop", usage } });
const failure = (errorMessage: string) => ({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage, usage: {} } });
const OVERFLOW = "prompt is too long: 250000 tokens > 200000 maximum";

async function play(session: AgentSession, limits = {}): Promise<Array<Record<string, unknown>>> {
  const job = new KernelJob("job-1", jobSpec(workspace, agent([]), limits), "0.0.0");
  const events: Array<Record<string, unknown>> = [];
  const reading = (async () => {
    for await (const event of job.events) events.push(event as unknown as Record<string, unknown>);
  })();
  await job.run(session, () => undefined);
  await job.done;
  await reading;
  return events;
}

describe("context and cache accounting", () => {
  it("reports cache tokens, compactions, turns and the context peak, summaries included", async () => {
    let percent = 40;
    const session = scriptedSession(
      (emit) => {
        emit({ type: "turn_start" });
        emit(answer({ input: 100, output: 10, cacheRead: 900, cacheWrite: 50, cost: { total: 0.1 } }));
        percent = 83.25;
        emit(answer({ input: 0, output: 0, cost: { total: 0 } }));
        emit({ type: "compaction_start", reason: "threshold" });
        emit({ type: "compaction_end", reason: "threshold", aborted: false, willRetry: false, result: { usage: { input: 30, output: 5, cacheRead: 0, cacheWrite: 0, cost: { total: 0.02 } } } });
        emit({ type: "turn_start" });
        percent = 21;
        emit(answer({ input: 20, output: 4, cacheRead: 1000, cacheWrite: 0, cost: { total: 0.01 } }));
      },
      () => percent,
    );
    const events = await play(session);
    const usage = events.find((event) => event["type"] === "usage");
    expect(usage).toMatchObject({ inputTokens: 150, outputTokens: 19, cacheReadTokens: 1900, cacheWriteTokens: 50, turns: 2, compactions: 1 });
    expect(usage?.["costUsd"]).toBeCloseTo(0.13);
    expect(usage?.["contextPeakPercent"]).toBeCloseTo(83.3, 1);
  });

  it("counts a compaction as work for as long as it runs, so the idle watchdog does not fire", async () => {
    const seen: boolean[] = [];
    const holder: { job?: KernelJob } = {};
    const session = scriptedSession(async (emit) => {
      emit({ type: "turn_start" });
      const idle = holder.job!.lastActivityAt;
      await sleep(20);
      seen.push(holder.job!.lastActivityAt === idle);
      emit({ type: "compaction_start", reason: "overflow" });
      const before = holder.job!.lastActivityAt;
      await sleep(20);
      seen.push(holder.job!.lastActivityAt > before);
      emit({ type: "compaction_end", reason: "overflow", aborted: false, willRetry: true, result: {} });
      const after = holder.job!.lastActivityAt;
      await sleep(20);
      seen.push(holder.job!.lastActivityAt === after);
      emit(answer({ input: 1, output: 1, cost: { total: 0 } }));
    });
    const job = new KernelJob("job-1", jobSpec(workspace, agent([])), "0.0.0");
    holder.job = job;
    await job.run(session, () => undefined);
    await job.done;
    expect(seen).toEqual([true, true, true]);
  });

  it("fails with reason context-overflow when pi could not recover the conversation", async () => {
    const session = scriptedSession((emit) => {
      emit({ type: "turn_start" });
      emit({ type: "compaction_start", reason: "overflow" });
      emit({ type: "compaction_end", reason: "overflow", aborted: false, willRetry: false, errorMessage: "Context overflow recovery failed after one compact-and-retry attempt." });
      emit(failure("the request failed"));
    });
    const events = await play(session);
    expect(events.at(-1)).toMatchObject({ type: "job.failed", reason: "context-overflow" });
  });

  it("recognises an overflow error from the provider even when no compaction event reported it", async () => {
    const session = scriptedSession((emit) => {
      emit({ type: "turn_start" });
      emit(failure(OVERFLOW));
    });
    const events = await play(session);
    expect(events.at(-1)).toMatchObject({ type: "job.failed", reason: "context-overflow" });
  });

  it("keeps an ordinary provider error a plain error", async () => {
    const session = scriptedSession((emit) => {
      emit({ type: "turn_start" });
      emit(failure("upstream 500"));
    });
    const events = await play(session);
    expect(events.at(-1)).toMatchObject({ type: "job.failed", reason: "error", error: "upstream 500" });
  });

  it("charges the cost of a compaction summary to the job's budget", async () => {
    const session = scriptedSession((emit) => {
      emit({ type: "turn_start" });
      emit({ type: "compaction_end", reason: "threshold", aborted: false, willRetry: false, result: { usage: { input: 1000, output: 100, cost: { total: 2 } } } });
    });
    const events = await play(session, { maxCostUsd: 1 });
    expect(events.at(-1)).toMatchObject({ type: "job.failed", reason: "budget" });
  });
});
