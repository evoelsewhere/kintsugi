import { afterAll, describe, expect, it } from "vitest";
import { createAgentRuntime } from "../src/agent-runtime.js";
import { agent, createWorkspace, jobSpec, runJob } from "./helpers.js";

const workspace = createWorkspace();
afterAll(() => workspace.remove());

describe("mock backend", () => {
  const runtime = createAgentRuntime();

  it("follows the job contract without an LLM", async () => {
    const { events, done } = await runJob(runtime, jobSpec(workspace, agent(["read", "outputs_write"]), { maxTurns: 3 }));
    expect(done.type).toBe("job.completed");
    expect(events[0]).toMatchObject({ type: "job.started", agent: "test-agent@1.0.0", metadata: { projectId: "p1" } });
    expect(events).toContainEqual(expect.objectContaining({ type: "output" }));
    expect(events.at(-1)).toEqual(done);
  });

  it("reports tools outside the allowlist as blocked", async () => {
    const { events } = await runJob(runtime, jobSpec(workspace, agent([]), { maxTurns: 1 }));
    expect(events).toContainEqual(expect.objectContaining({ type: "tool.call", tool: "read", decision: "blocked" }));
  });

  it("fails with reason budget when the simulated cost exceeds the limit", async () => {
    const { done } = await runJob(runtime, jobSpec(workspace, agent(["read"]), { maxCostUsd: 0.000001 }));
    expect(done).toMatchObject({ type: "job.failed", reason: "budget" });
  });

  it("fails with reason aborted when aborted", async () => {
    const job = await runtime.startJob(jobSpec(workspace, agent(["read"])));
    await job.abort("stop");
    expect(await job.done).toMatchObject({ type: "job.failed", reason: "aborted" });
  });
});
