// Job outcome and limits: failures never end as job.completed.

import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { afterAll, describe, expect, it, vi } from "vitest";
import { TOOL_RESULT_PREVIEW_CHARS } from "@kintsugi/runtime-sdk";
import { KernelJob, OPEN_CALL_ACTIVE_MS, resultPreview } from "../src/kernel/job.js";
import { agent, createWorkspace, fauxRuntime, jobSpec, runJob, sleep } from "./helpers.js";

const workspace = createWorkspace();
afterAll(() => workspace.remove());

const readTurn = () => fauxAssistantMessage([fauxToolCall("read", { path: "hello.txt" })], { stopReason: "toolUse" });

describe("a call the agent policy denies (T3-005)", () => {
  it("is reported once, as blocked, with the real call id", async () => {
    const runtime = await fauxRuntime([
      () => fauxAssistantMessage([fauxToolCall("shell", { command: "curl http://example.invalid" })], { stopReason: "toolUse" }),
      () => fauxAssistantMessage("done"),
    ]);
    const { events, done } = await runJob(runtime, jobSpec(workspace, agent(["shell"], { denyCommandPatterns: ["curl"] })));
    expect(done.type).toBe("job.completed");
    const calls = events.filter((event) => event.type === "tool.call");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ tool: "shell", decision: "blocked", reason: "command denied by agent policy (/curl/)" });
    const result = events.find((event) => event.type === "tool.result");
    expect(result).toMatchObject({ callId: calls[0]!.type === "tool.call" ? calls[0]!.callId : "", ok: false });
    expect(done.type === "job.completed" ? done.summary : "").toContain("1 blocked call(s)");
  });
});

describe("job outcome", () => {
  it("fails with reason max-turns when the agent keeps going", async () => {
    const runtime = await fauxRuntime(Array.from({ length: 6 }, () => readTurn));
    const { done } = await runJob(runtime, jobSpec(workspace, agent(["read"]), { maxTurns: 2 }));
    expect(done).toMatchObject({ type: "job.failed", reason: "max-turns" });
  });

  it("fails with reason error when the model call fails (after pi's retries)", async () => {
    const failing = () => fauxAssistantMessage("", { stopReason: "error", errorMessage: "upstream 500" });
    const runtime = await fauxRuntime([failing, failing, failing, failing]);
    const { done } = await runJob(runtime, jobSpec(workspace, agent([])));
    expect(done).toMatchObject({ type: "job.failed", reason: "error" });
  });

  it("fails with reason timeout, even when the provider ignores the abort", async () => {
    const runtime = await fauxRuntime([async () => (await sleep(3000), fauxAssistantMessage("late"))]);
    const started = Date.now();
    const { done } = await runJob(runtime, jobSpec(workspace, agent([]), { timeoutSec: 0.5 }));
    expect(done).toMatchObject({ type: "job.failed", reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("fails with reason aborted when the caller aborts", async () => {
    const runtime = await fauxRuntime([async (_context, options) => (await sleep(3000, options?.signal), fauxAssistantMessage("late"))]);
    const job = await runtime.startJob(jobSpec(workspace, agent([])));
    setTimeout(() => void job.abort("user cancelled"), 200);
    expect(await job.done).toMatchObject({ type: "job.failed", reason: "aborted", error: "user cancelled" });
  });

  it("reports what read showed as source.read, with the path relative to the workspace root", async () => {
    const readFromRoot = () => fauxAssistantMessage([fauxToolCall("read", { path: "src/hello.txt" })], { stopReason: "toolUse" });
    const runtime = await fauxRuntime([readFromRoot, fauxAssistantMessage("done")]);
    const { done, events } = await runJob(runtime, jobSpec(workspace, agent(["read"]), {}, workspace.root));
    expect(done.type).toBe("job.completed");
    expect(events.filter((event) => event.type === "source.read")).toEqual([{ type: "source.read", jobId: done.jobId, tool: "read", path: "src/hello.txt", from: 1, to: null }]);
  });

  it("previews what a tool gave the model back in its tool.result, whitespace folded and cut short", async () => {
    const runtime = await fauxRuntime([readTurn, fauxAssistantMessage("done")]);
    const { events } = await runJob(runtime, jobSpec(workspace, agent(["read"])));
    const result = events.find((event) => event.type === "tool.result");
    expect(result).toMatchObject({ type: "tool.result", ok: true, preview: expect.any(String) });
    expect(resultPreview({ content: [{ type: "text", text: "No files\n\n  found" }, { type: "image", data: "x" }] })).toBe("No files found");
    expect(resultPreview({ content: [{ type: "text", text: "x".repeat(500) }] })).toHaveLength(TOOL_RESULT_PREVIEW_CHARS);
    expect(resultPreview({ content: [] })).toBeUndefined();
    expect(resultPreview(undefined)).toBeUndefined();
  });

  it("completes with usage on a normal answer", async () => {
    const runtime = await fauxRuntime([fauxAssistantMessage("all good")]);
    const { done, events } = await runJob(runtime, jobSpec(workspace, agent([])));
    expect(done.type).toBe("job.completed");
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["job.started", "message.delta", "usage", "job.completed"]));
  });
});

describe("cost budget", () => {
  // The faux provider reports zero cost, so the session is scripted here.
  it("aborts and fails with reason budget once the cost exceeds maxCostUsd", async () => {
    let listener: ((event: AgentSessionEvent) => void) | undefined;
    let aborted = false;
    const session = {
      subscribe: (next: (event: AgentSessionEvent) => void) => {
        listener = next;
        return () => undefined;
      },
      prompt: async () => {
        for (let turn = 0; turn < 3; turn++) {
          listener?.({ type: "turn_start" } as AgentSessionEvent);
          listener?.({
            type: "message_end",
            message: { role: "assistant", stopReason: "toolUse", usage: { input: 10, output: 5, cost: { total: 0.4 } } },
          } as unknown as AgentSessionEvent);
        }
      },
      abort: async () => {
        aborted = true;
      },
      dispose: () => undefined,
    } as unknown as AgentSession;

    const job = new KernelJob("job-1", jobSpec(workspace, agent([]), { maxCostUsd: 1 }), "0.0.0");
    await job.run(session, () => undefined);
    expect(await job.done).toMatchObject({ type: "job.failed", reason: "budget" });
    expect(aborted).toBe(true);
  });
});

describe("activity", () => {
  // The launcher's idle watchdog reads lastActivityAt: a long tool call of the model is work, not a silent provider (T3-013).
  it("counts a running tool call as activity, and a silent model after it as none", async () => {
    let listener: ((event: AgentSessionEvent) => void) | undefined;
    const seen: { during: number; after: number } = { during: 0, after: 0 };
    const job = new KernelJob("job-1", jobSpec(workspace, agent([])), "0.0.0");
    const session = {
      subscribe: (next: (event: AgentSessionEvent) => void) => {
        listener = next;
        return () => undefined;
      },
      prompt: async () => {
        listener?.({ type: "tool_execution_start", toolCallId: "call-1", toolName: "shell", args: { command: "make test" } } as AgentSessionEvent);
        await sleep(400);
        seen.during = Date.now() - job.lastActivityAt;
        listener?.({ type: "tool_execution_end", toolCallId: "call-1", toolName: "shell", result: { content: [{ type: "text", text: "ok" }] }, isError: false } as unknown as AgentSessionEvent);
        await sleep(400);
        seen.after = Date.now() - job.lastActivityAt;
        listener?.({ type: "message_end", message: { role: "assistant", stopReason: "stop" } } as unknown as AgentSessionEvent);
      },
      abort: async () => undefined,
      getContextUsage: () => undefined,
      dispose: () => undefined,
    } as unknown as AgentSession;
    await job.run(session, () => undefined);
    expect(await job.done).toMatchObject({ type: "job.completed" });
    expect(seen.during).toBeLessThan(100);
    expect(seen.after).toBeGreaterThanOrEqual(350);
  });

  it("stops counting a tool call that is still open past OPEN_CALL_ACTIVE_MS, so the idle watchdog can stop a hung job", async () => {
    let clock = 1_000_000;
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      let listener: ((event: AgentSessionEvent) => void) | undefined;
      const seen: number[] = [];
      const job = new KernelJob("job-1", jobSpec(workspace, agent([])), "0.0.0");
      const session = {
        subscribe: (next: (event: AgentSessionEvent) => void) => {
          listener = next;
          return () => undefined;
        },
        prompt: async () => {
          const start = clock;
          listener?.({ type: "tool_execution_start", toolCallId: "call-1", toolName: "mcp__docs__search", args: { query: "x" } } as AgentSessionEvent);
          clock = start + OPEN_CALL_ACTIVE_MS - 1000;
          seen.push(job.lastActivityAt - start);
          clock = start + OPEN_CALL_ACTIVE_MS + 60_000;
          seen.push(job.lastActivityAt - start);
          listener?.({ type: "tool_execution_end", toolCallId: "call-1", toolName: "mcp__docs__search", result: { content: [{ type: "text", text: "ok" }] }, isError: false } as unknown as AgentSessionEvent);
          listener?.({ type: "message_end", message: { role: "assistant", stopReason: "stop" } } as unknown as AgentSessionEvent);
        },
        abort: async () => undefined,
        getContextUsage: () => undefined,
        dispose: () => undefined,
      } as unknown as AgentSession;
      await job.run(session, () => undefined);
      expect(await job.done).toMatchObject({ type: "job.completed" });
      // Still open within the bound: working now. Past it: working until the bound, and idle from then on.
      expect(seen).toEqual([OPEN_CALL_ACTIVE_MS - 1000, OPEN_CALL_ACTIVE_MS]);
    } finally {
      now.mockRestore();
    }
  });
});
