// codemode inside a kernel job (ADR-0047): scripts reach only the read tools, inside bounds.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, type FauxResponseFactory } from "@earendil-works/pi-ai";
import type { JobEvent, JobSpan } from "@kintsugi/runtime-sdk";
import { afterAll, describe, expect, it } from "vitest";
import { boundScript, SCRIPT_MAX_OUTPUT_TOKENS, SCRIPT_TIMEOUT_MS } from "../src/kernel/codemode.js";
import { agent, createWorkspace, fauxRuntime, jobSpec, runJob } from "./helpers.js";

const workspace = createWorkspace();
afterAll(() => workspace.remove());

describe("boundScript", () => {
  const ceilings = { timeout_ms: SCRIPT_TIMEOUT_MS, max_output_tokens: SCRIPT_MAX_OUTPUT_TOKENS };
  const optionsOf = (code: string): Record<string, unknown> => JSON.parse(code.split("\n")[0]!.replace("// @options: ", "")) as Record<string, unknown>;

  it("gives a script with no options line the deadline and the output cap", () => {
    const bounded = boundScript("return 1");
    expect(optionsOf(bounded)).toEqual(ceilings);
    expect(bounded.endsWith("\nreturn 1")).toBe(true);
  });

  it("keeps the smaller numbers a script asks for and lowers the larger ones", () => {
    expect(optionsOf(boundScript('// @options: {"timeout_ms": 5000, "max_output_tokens": 100}\nreturn 1'))).toEqual({ timeout_ms: 5000, max_output_tokens: 100 });
    expect(optionsOf(boundScript('// @options: {"timeout_ms": 99999999, "max_output_tokens": 999999}\nreturn 1'))).toEqual(ceilings);
    expect(optionsOf(boundScript('// @options: {"timeout_ms": -1}\nreturn 1'))).toEqual(ceilings);
  });

  it("keeps the rest of the script and any other option", () => {
    const bounded = boundScript('// @options: {"other": true}\nconst a = 1;\nreturn a');
    expect(optionsOf(bounded)).toEqual({ other: true, ...ceilings });
    expect(bounded.split("\n").slice(1).join("\n")).toBe("const a = 1;\nreturn a");
  });

  it("leaves a script alone when its options line is not valid, so pi rejects it", () => {
    const broken = "// @options: {nope\nreturn 1";
    expect(boundScript(broken)).toBe(broken);
  });
});

/** Runs one job whose first turn calls `codemode` with `code`; returns what the model saw and the events. */
async function runScript(code: string, tools = ["read", "write", "codemode"]): Promise<{ seen: string; events: JobEvent[] }> {
  let seen = "";
  const steps: FauxResponseFactory[] = [
    () => fauxAssistantMessage([fauxToolCall("codemode", { code }, { id: "script-1" })], { stopReason: "toolUse" }),
    (context) => {
      seen = JSON.stringify(context.messages);
      return fauxAssistantMessage("done");
    },
  ];
  const runtime = await fauxRuntime(steps);
  const { events, done } = await runJob(runtime, jobSpec(workspace, agent(tools)));
  expect(done.type).toBe("job.completed");
  return { seen, events };
}

const spansOf = (events: JobEvent[]): JobSpan[] => events.flatMap((event) => (event.type === "span" ? [event.span] : []));

describe("codemode in a job", () => {
  it("runs a script that reads through the read tool and shows the model only its output", async () => {
    const { seen, events } = await runScript('const text_ = await tools.read({ path: "hello.txt" }); text(text_.toUpperCase());');
    expect(seen).toContain("HELLO FROM THE WORKSPACE");
    const spans = spansOf(events);
    const codemode = spans.find((span) => span.name === "kintsugi.codemode");
    expect(codemode).toMatchObject({ status: "ok", attributes: { tool: "codemode" } });
    const nested = spans.find((span) => span.name === "kintsugi.tool" && span.attributes["tool"] === "read");
    expect(nested).toMatchObject({ parentId: codemode?.id, attributes: { nested: true } });
  });

  it("cannot call a tool that writes, and writes nothing", async () => {
    const { seen } = await runScript('await tools.write({ path: "from-script.md", content: "x" }); text("wrote");');
    expect(seen).not.toContain('"wrote"');
    expect(seen).toMatch(/Script failed/);
    expect(existsSync(join(workspace.out, "from-script.md"))).toBe(false);
  });

  it("is not offered to an agent that does not list it", async () => {
    let tools: string[] = [];
    const runtime = await fauxRuntime([
      (context) => {
        tools = context.messages.flatMap((message) => (message.role === "system" ? ((message as { toolsAdded?: { name: string }[] }).toolsAdded ?? []).map((tool) => tool.name) : []));
        return fauxAssistantMessage("done");
      },
    ]);
    await runJob(runtime, jobSpec(workspace, agent(["read"])));
    expect(tools).toEqual(["read"]);
  });

  it("is offered to an agent that lists it, next to the tools it lists", async () => {
    let tools: string[] = [];
    const runtime = await fauxRuntime([
      (context) => {
        tools = context.messages.flatMap((message) => (message.role === "system" ? ((message as { toolsAdded?: { name: string }[] }).toolsAdded ?? []).map((tool) => tool.name) : []));
        return fauxAssistantMessage("done");
      },
    ]);
    await runJob(runtime, jobSpec(workspace, agent(["read", "codemode"])));
    expect(tools.sort()).toEqual(["codemode", "read"]);
  });
});
