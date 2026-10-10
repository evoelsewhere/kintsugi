// The kernel's scratch agent directory is deleted when the job ends. The temp dir is
// redirected for this file (vitest runs each file in its own worker), so other test
// files cannot interfere with the count.

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterAll, describe, expect, it } from "vitest";
import { agent, createWorkspace, fauxRuntime, jobSpec, runJob, sleep } from "./helpers.js";

const scratch = mkdtempSync(join(tmpdir(), "kintsugi-cleanup-test-"));
const saved = { TMPDIR: process.env["TMPDIR"], TMP: process.env["TMP"], TEMP: process.env["TEMP"] };
Object.assign(process.env, { TMPDIR: scratch, TMP: scratch, TEMP: scratch });
const workspace = createWorkspace();

afterAll(() => {
  workspace.remove();
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(scratch, { recursive: true, force: true });
});

const jobDirs = (): string[] => readdirSync(scratch).filter((name) => name.startsWith("kintsugi-job-"));

describe("scratch directories", () => {
  it("are removed after a completed job", async () => {
    const runtime = await fauxRuntime([fauxAssistantMessage("done")]);
    const { done } = await runJob(runtime, jobSpec(workspace, agent(["read"])));
    expect(done.type).toBe("job.completed");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(jobDirs()).toEqual([]);
  });

  it("are removed after an aborted job, once the abort settles", async () => {
    const runtime = await fauxRuntime([async (_context, options) => (await sleep(3000, options?.signal), fauxAssistantMessage("late"))]);
    const job = await runtime.startJob(jobSpec(workspace, agent([])));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(jobDirs()).toHaveLength(1);
    await job.abort("stop");
    expect(await job.done).toMatchObject({ type: "job.failed", reason: "aborted" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(jobDirs()).toEqual([]);
  });
});
