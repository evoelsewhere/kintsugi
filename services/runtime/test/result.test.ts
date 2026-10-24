// The submit_result tool in a real pi session (faux provider): a job with a result schema gets the tool, a result
// that does not fit the schema is refused before the tool runs, and one that fits is written as result.json.

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterAll, describe, expect, it } from "vitest";
import { agent, createWorkspace, fauxRuntime, jobSpec, runJob } from "./helpers.js";

const workspace = createWorkspace();
afterAll(() => workspace.remove());

const verdict = {
  type: "object",
  required: ["real", "reason"],
  properties: { real: { type: "boolean" }, reason: { type: "string" }, adjustedSeverity: { type: "string", enum: ["Critical", "High", "Medium", "Low"] } },
};

const resultOf = (events: Awaited<ReturnType<typeof runJob>>["events"], callId: string): { ok: boolean; output?: string } | undefined => {
  const event = events.find((entry): entry is Extract<typeof entry, { type: "tool.result" }> => entry.type === "tool.result" && entry.callId === callId);
  return event === undefined ? undefined : { ok: event.ok };
};

describe("submit_result", () => {
  it("is offered to a job with a result schema, besides the agent's tools", async () => {
    let offered: string[] = [];
    const runtime = await fauxRuntime([
      (context) => {
        offered = context.messages.filter((message) => message.role === "system").flatMap((message) => (message as unknown as { toolsAdded?: { name: string }[] }).toolsAdded ?? []).map((tool) => tool.name);
        return fauxAssistantMessage("done");
      },
    ]);
    await runJob(runtime, { ...jobSpec(workspace, agent(["read"])), resultSchema: verdict });
    expect(offered.sort()).toEqual(["read", "submit_result"]);
  });

  it("is not offered to a job without one", async () => {
    let offered: string[] = [];
    const runtime = await fauxRuntime([
      (context) => {
        offered = context.messages.filter((message) => message.role === "system").flatMap((message) => (message as unknown as { toolsAdded?: { name: string }[] }).toolsAdded ?? []).map((tool) => tool.name);
        return fauxAssistantMessage("done");
      },
    ]);
    await runJob(runtime, jobSpec(workspace, agent(["read"])));
    expect(offered).toEqual(["read"]);
  });

  it("refuses a result that does not fit, lets the model correct it, and writes the one that fits", async () => {
    rmSync(join(workspace.out, "result.json"), { force: true });
    const runtime = await fauxRuntime([
      // What a model sometimes does with a schema: hand it back as the result.
      fauxAssistantMessage([fauxToolCall("submit_result", { type: "object", required: ["real"], properties: {} }, { id: "schema-copy" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("submit_result", { real: "yes", reason: 3 }, { id: "wrong-types" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("submit_result", { real: false, reason: "sanitized upstream", adjustedSeverity: "Low" }, { id: "fits" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]);
    const { events, done } = await runJob(runtime, { ...jobSpec(workspace, agent([])), resultSchema: verdict });
    expect(done.type).toBe("job.completed");
    expect(resultOf(events, "schema-copy")?.ok).toBe(false);
    expect(resultOf(events, "wrong-types")?.ok).toBe(false);
    expect(resultOf(events, "fits")?.ok).toBe(true);
    expect(JSON.parse(readFileSync(join(workspace.out, "result.json"), "utf8"))).toEqual({ real: false, reason: "sanitized upstream", adjustedSeverity: "Low" });
  });

  it("writes nothing for a result that never fits", async () => {
    rmSync(join(workspace.out, "result.json"), { force: true });
    const runtime = await fauxRuntime([fauxAssistantMessage([fauxToolCall("submit_result", { real: 1 }, { id: "bad" })], { stopReason: "toolUse" }), fauxAssistantMessage("done")]);
    await runJob(runtime, { ...jobSpec(workspace, agent([])), resultSchema: verdict });
    expect(existsSync(join(workspace.out, "result.json"))).toBe(false);
  });
});
