// The loop guard (QA-R1): a model that asks a tool the same thing and gets the same answer, or streams a turn that
// never comes to a tool call, is halted as a `loop`.

import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { afterAll, describe, expect, it } from "vitest";
import { canonicalJson, KernelJob, LOOP_REPEATS, RUNAWAY_TOOL_ARGS_CHARS, RUNAWAY_TURN_CHARS } from "../src/kernel/job.js";
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

describe("runaway turn", () => {
  type Step = { turn: true } | { delta: "thinking_delta" | "text_delta" | "toolcall_delta"; chars: number } | { tool: string };

  /** Runs a session that streams the given turns, deltas (in chunks of 10k characters) and completed tool calls. */
  async function stream(steps: Step[]) {
    let listener: ((event: AgentSessionEvent) => void) | undefined;
    let aborted = false;
    const session = {
      subscribe: (next: (event: AgentSessionEvent) => void) => {
        listener = next;
        return () => undefined;
      },
      prompt: async () => {
        for (const [index, step] of steps.entries()) {
          if (aborted) return;
          if ("turn" in step) listener?.({ type: "turn_start" } as AgentSessionEvent);
          else if ("tool" in step) {
            const toolCallId = `call-${index}`;
            listener?.({ type: "tool_execution_start", toolCallId, toolName: step.tool, args: { index } } as AgentSessionEvent);
            listener?.({ type: "tool_execution_end", toolCallId, toolName: step.tool, result: { content: [{ type: "text", text: "ok" }] }, isError: false } as unknown as AgentSessionEvent);
          } else {
            for (let sent = 0; sent < step.chars && !aborted; sent += 10_000) {
              const delta = "x".repeat(Math.min(10_000, step.chars - sent));
              listener?.({ type: "message_update", assistantMessageEvent: { type: step.delta, delta } } as unknown as AgentSessionEvent);
            }
          }
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
    const events: unknown[] = [];
    void (async () => {
      for await (const event of job.events) events.push(event);
    })();
    await job.run(session, () => undefined);
    return { end: await job.done, events };
  }

  it("halts a turn past 150k characters of thinking and text, or 400k of tool-call arguments, without a tool call, naming the size and what it was", async () => {
    expect(RUNAWAY_TURN_CHARS).toBe(150_000);
    expect(RUNAWAY_TOOL_ARGS_CHARS).toBe(400_000);
    const thinking = await stream([{ turn: true }, { delta: "thinking_delta", chars: 190_000 }]);
    expect(thinking.end).toMatchObject({ type: "job.failed", reason: "loop", error: "stopped: one turn produced 160k characters of thinking without a tool call" });
    const text = await stream([{ turn: true }, { delta: "thinking_delta", chars: 10_000 }, { delta: "text_delta", chars: 150_000 }]);
    expect(text.end).toMatchObject({ type: "job.failed", reason: "loop", error: "stopped: one turn produced 160k characters of text without a tool call" });
    const both = await stream([{ turn: true }, { delta: "thinking_delta", chars: 40_000 }, { delta: "text_delta", chars: 120_000 }]);
    expect(both.end).toMatchObject({ type: "job.failed", reason: "loop", error: "stopped: one turn produced 160k characters of thinking and text without a tool call" });
    const args = await stream([{ turn: true }, { delta: "toolcall_delta", chars: 600_000 }]);
    expect(args.end).toMatchObject({ type: "job.failed", reason: "loop", error: "stopped: one turn produced 410k characters of tool-call arguments without a tool call" });
  });

  it("lets one large write through, and thinking beside it, when neither passes its own limit", async () => {
    const write = await stream([{ turn: true }, { delta: "toolcall_delta", chars: 200_000 }, { tool: "write" }]);
    expect(write.end).toMatchObject({ type: "job.completed" });
    const mixed = await stream([{ turn: true }, { delta: "thinking_delta", chars: 80_000 }, { delta: "toolcall_delta", chars: 80_000 }, { tool: "write" }]);
    expect(mixed.end).toMatchObject({ type: "job.completed" });
    const near = await stream([{ turn: true }, { delta: "thinking_delta", chars: 140_000 }, { delta: "toolcall_delta", chars: 390_000 }, { tool: "write" }]);
    expect(near.end).toMatchObject({ type: "job.completed" });
  });

  it("counts again at each turn and after each completed tool call, so a long job of normal turns is not a loop", async () => {
    const report = await stream([{ turn: true }, { delta: "thinking_delta", chars: 30_000 }, { delta: "toolcall_delta", chars: 60_000 }, { tool: "write" }, { delta: "text_delta", chars: 100_000 }]);
    expect(report.end).toMatchObject({ type: "job.completed" });
    const turns = await stream(Array.from({ length: 5 }, (): Step[] => [{ turn: true }, { delta: "thinking_delta", chars: 100_000 }]).flat());
    expect(turns.end).toMatchObject({ type: "job.completed" });
  });

  it("halts a real session whose answer runs away, and stops sending its text", async () => {
    const runtime = await fauxRuntime([fauxAssistantMessage("word ".repeat(40_000))]);
    const { done: end, events } = await runJob(runtime, jobSpec(workspace, agent([])));
    expect(end).toMatchObject({ type: "job.failed", reason: "loop" });
    expect((end as { error: string }).error).toMatch(/^stopped: one turn produced \d+k characters of text without a tool call$/);
    const sent = events.flatMap((event) => (event.type === "message.delta" ? [event.text.length] : [])).reduce((sum, size) => sum + size, 0);
    expect(sent).toBeLessThanOrEqual(RUNAWAY_TURN_CHARS);
  });
});
