// Job outcome and limits: failures never end as job.completed.

import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { afterAll, describe, expect, it } from "vitest";
import { TOOL_RESULT_PREVIEW_CHARS } from "@kintsugi/runtime-sdk";
import { KernelJob, resultPreview } from "../src/kernel/job.js";
import { agent, createWorkspace, fauxRuntime, jobSpec, runJob, sleep } from "./helpers.js";

const workspace = createWorkspace();
afterAll(() => workspace.remove());

const readTurn = () => fauxAssistantMessage([fauxToolCall("read", { path: "hello.txt" })], { stopReason: "toolUse" });

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
