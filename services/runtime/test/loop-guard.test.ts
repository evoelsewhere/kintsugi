// The loop guard (QA-R1): a model that asks a tool the same thing and gets the same answer is halted as a `loop`.

import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { afterAll, describe, expect, it } from "vitest";
import { canonicalJson, KernelJob, LOOP_REPEATS } from "../src/kernel/job.js";
import { agent, createWorkspace, fauxRuntime, jobSpec, runJob } from "./helpers.js";

const workspace = createWorkspace();
afterAll(() => workspace.remove());

const call = (tool: string, args: Parameters<typeof fauxToolCall>[1]) => () => fauxAssistantMessage([fauxToolCall(tool, args)], { stopReason: "toolUse" });
const done = () => fauxAssistantMessage("done");

describe("loop guard", () => {
  it("halts as loop at the 12th identical call with the same answer, and says which tool", async () => {
    const runtime = await fauxRuntime([...Array.from({ length: LOOP_REPEATS + 3 }, () => call("read", { path: "hello.txt" })), done]);
    const { done: end, events } = await runJob(runtime, jobSpec(workspace, agent(["read"])));
    expect(LOOP_REPEATS).toBe(12);
    expect(end).toMatchObject({ type: "job.failed", reason: "loop", error: "stopped: read was called with the same arguments 12 times" });
    expect(events.filter((event) => event.type === "tool.call")).toHaveLength(LOOP_REPEATS);
    // The halt goes through the kernel's usual path: usage, then the end; the root span names the outcome.
    const types = events.map((event) => event.type);
    expect(types.indexOf("usage")).toBeLessThan(types.indexOf("job.failed"));
    const root = events.find((event) => event.type === "span" && event.span.name === "kintsugi.job");
    expect(root).toMatchObject({ span: { status: "error", attributes: { outcome: "loop" } } });
  });

  it("lets 11 identical calls through", async () => {
    const runtime = await fauxRuntime([...Array.from({ length: LOOP_REPEATS - 1 }, () => call("read", { path: "hello.txt" })), done]);
    const { done: end } = await runJob(runtime, jobSpec(workspace, agent(["read"])));
    expect(end.type).toBe("job.completed");
  });

  it("counts repeats interleaved with other calls, whatever the order of the arguments' keys", async () => {
    const steps = Array.from({ length: LOOP_REPEATS }, (_, index) => [
      call("read", index % 2 === 0 ? { path: "hello.txt", offset: 1 } : { offset: 1, path: "hello.txt" }),
      call("ls", { path: "." }),
    ]).flat();
    const runtime = await fauxRuntime([...steps, done]);
    const { done: end } = await runJob(runtime, jobSpec(workspace, agent(["read", "ls"])));
    expect(end).toMatchObject({ type: "job.failed", reason: "loop", error: "stopped: read was called with the same arguments 12 times" });
  });

  it("never counts calls with different arguments together", async () => {
    const steps = Array.from({ length: 2 * LOOP_REPEATS }, (_, index) => call("read", { path: "hello.txt", offset: 1, limit: index + 1 }));
    const runtime = await fauxRuntime([...steps, done]);
    const { done: end } = await runJob(runtime, jobSpec(workspace, agent(["read"])));
    expect(end.type).toBe("job.completed");
  });

  it("writes JSON with sorted keys at every level, without undefined members", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { f: 1, e: 0 }], c: "x" }, u: undefined })).toBe('{"a":{"c":"x","d":[2,{"e":0,"f":1}]},"b":1}');
    expect(canonicalJson(undefined)).toBe("null");
    expect(canonicalJson("x")).toBe('"x"');
  });
});

describe("loop guard on a scripted session", () => {
  /** Runs a session that emits one tool call per entry: its tool, arguments, answer and (for a nested call) parent. */
  async function run(calls: { tool: string; args: unknown; answer: string; parent?: string }[]) {
    let listener: ((event: AgentSessionEvent) => void) | undefined;
    let aborted = false;
    const session = {
      subscribe: (next: (event: AgentSessionEvent) => void) => {
        listener = next;
        return () => undefined;
      },
      prompt: async () => {
        for (const [index, entry] of calls.entries()) {
          if (aborted) return;
          const toolCallId = entry.parent === undefined ? `call-${index}` : `${entry.parent}/inner-${index}`;
          listener?.({ type: "tool_execution_start", toolCallId, toolName: entry.tool, args: entry.args } as AgentSessionEvent);
          listener?.({ type: "tool_execution_end", toolCallId, toolName: entry.tool, result: { content: [{ type: "text", text: entry.answer }] }, isError: false } as unknown as AgentSessionEvent);
        }
        listener?.({ type: "message_end", message: { role: "assistant", stopReason: "stop" } } as unknown as AgentSessionEvent);
      },
      abort: async () => {
        aborted = true;
      },
      getContextUsage: () => undefined,
      dispose: () => undefined,
    } as unknown as AgentSession;
    const job = new KernelJob("job-1", jobSpec(workspace, agent([])), "0.0.0");
    await job.run(session, () => undefined);
    return job.done;
  }

  it("starts the count again when the same call gets a different answer (a checklist listed after an item was done)", async () => {
    const calls = Array.from({ length: 30 }, (_, index) => ({ tool: "scratchpad", args: { action: "list" }, answer: `items left: ${Math.floor(index / 6)}` }));
    expect(await run(calls)).toMatchObject({ type: "job.completed" });
    const stuck = Array.from({ length: LOOP_REPEATS }, () => ({ tool: "scratchpad", args: { action: "list" }, answer: "items left: 3" }));
    expect(await run(stuck)).toMatchObject({ type: "job.failed", reason: "loop", error: "stopped: scratchpad was called with the same arguments 12 times" });
  });

  it("leaves out the calls a codemode script makes; the codemode call itself counts", async () => {
    const nested = Array.from({ length: 2 * LOOP_REPEATS }, () => ({ tool: "read", args: { path: "a.txt" }, answer: "a", parent: "call-outer" }));
    expect(await run(nested)).toMatchObject({ type: "job.completed" });
    const outer = Array.from({ length: LOOP_REPEATS }, () => ({ tool: "codemode", args: { code: "await read('a.txt')" }, answer: "a" }));
    expect(await run(outer)).toMatchObject({ type: "job.failed", reason: "loop" });
  });
});
