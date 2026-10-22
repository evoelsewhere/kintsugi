// Agent jobs as child processes of the worker (ADR-0029): the mock backend and pi run in a
// child started in the job directory with a cleared environment and Node's permission model;
// the provider's API key arrives on stdin and its environment credentials in that child's
// environment only; aborts and timeouts kill the process tree.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChildAgentRuntime } from "@kintsugi/runtime/launcher";
import type { AgentDefinition, JobEvent, JobSpec } from "@kintsugi/runtime-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { builtinAgents } from "../src/jobs/agents.js";

describe("agent jobs in child processes", () => {
  let root: string;
  let agent: AgentDefinition;
  const dirs = (): { job: string; src: string; out: string } => {
    const job = mkdtempSync(join(root, "job-"));
    for (const dir of ["src", "in", "out", "tmp"]) mkdirSync(join(job, dir));
    writeFileSync(join(job, "src", "main.c"), "int main(void) { return 0; }\n");
    return { job, src: join(job, "src"), out: join(job, "out") };
  };
  const spec = (paths: { src: string; out: string }, model = { provider: "mock", id: "mock" }, timeoutSec = 60): JobSpec => ({
    agent,
    task: "Assess the fixture.",
    model,
    workspace: { root: paths.src, readOnly: [paths.src], outDir: paths.out },
    limits: { timeoutSec, maxTurns: 3 },
  });
  const collect = async (events: AsyncIterable<JobEvent>): Promise<JobEvent[]> => {
    const seen: JobEvent[] = [];
    for await (const event of events) seen.push(event);
    return seen;
  };
  /** A child entry for the tests: reports what it received, or hangs. */
  const fixture = (name: string, body: string): string => {
    const file = join(root, name);
    writeFileSync(file, body);
    return file;
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "kintsugi-agent-child-"));
    agent = await builtinAgents().definition("legacy-analyst");
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it("runs the mock backend in a child and streams its events", async () => {
    const runtime = createChildAgentRuntime({ mode: "mock" });
    expect(runtime.engine).toMatch(/^mock@/);
    const handle = await runtime.startJob(spec(dirs()));
    const events = await collect(handle.events);
    const done = await handle.done;
    expect(done).toMatchObject({ type: "job.completed" });
    expect(events[0]).toMatchObject({ type: "job.started", agent: "legacy-analyst@1.1.0" });
    expect(events.some((event) => event.type === "tool.call")).toBe(true);
    expect(events.at(-1)).toEqual(done);
  });

  it("passes the API key on stdin and provider variables in the child's environment only", async () => {
    process.env["KINTSUGI_TEST_WORKER_ONLY"] = "worker-secret";
    const entry = fixture(
      "report.mjs",
      `let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const parsed = JSON.parse(input);
  const report = { apiKey: parsed.provider.apiKey, region: process.env.KINTSUGI_TEST_REGION ?? null, leaked: process.env.KINTSUGI_TEST_WORKER_ONLY ?? null, database: process.env.DATABASE_URL ?? null, cwd: process.cwd() };
  process.stdout.write(JSON.stringify({ type: "job.completed", jobId: "x", at: new Date().toISOString(), summary: JSON.stringify(report) }) + "\\n");
});
`,
    );
    const runtime = createChildAgentRuntime({
      mode: "pi",
      entry,
      loadProvider: async () => ({
        config: { kind: "custom", id: "env-provider", enabled: true, auth: { type: "env", vars: { KINTSUGI_TEST_REGION: "s1" } } },
        credentials: { apiKey: "sk-test-key", env: { KINTSUGI_TEST_REGION: "eu-test-1" }, secrets: {} },
      }),
    });
    const paths = dirs();
    const handle = await runtime.startJob(spec(paths, { provider: "env-provider", id: "m" }));
    const done = await handle.done;
    expect(done.type).toBe("job.completed");
    const report = JSON.parse(done.type === "job.completed" ? done.summary : "{}") as Record<string, string | null>;
    expect(report).toMatchObject({ apiKey: "sk-test-key", region: "eu-test-1", leaked: null, database: null });
    expect(report["cwd"]?.toLowerCase()).toBe(paths.job.toLowerCase());
    expect(process.env["KINTSUGI_TEST_REGION"]).toBeUndefined();
    delete process.env["KINTSUGI_TEST_WORKER_ONLY"];
  });

  it("loads pi under the permission model and reports a provider failure as a failed job", async () => {
    const runtime = createChildAgentRuntime({
      mode: "pi",
      loadProvider: async () => ({
        config: {
          kind: "custom",
          id: "local",
          enabled: true,
          auth: { type: "none" },
          api: "openai-completions",
          baseUrl: "http://127.0.0.1:9/v1",
          models: [{ id: "m" }],
        },
        credentials: { env: {}, secrets: {} },
      }),
    });
    const handle = await runtime.startJob(spec(dirs(), { provider: "local", id: "m" }, 60));
    await collect(handle.events);
    const done = await handle.done;
    expect(done.type).toBe("job.failed");
    if (done.type === "job.failed") {
      expect(done.error).not.toMatch(/ERR_ACCESS_DENIED|permission/i);
      expect(done.error).toMatch(/connect/i);
    }
  }, 90_000);

  it("lets the kernel start processes and codemode start a worker, while paths outside the job stay unreadable", async () => {
    const outside = join(root, "outside.txt");
    writeFileSync(outside, "not for the job");
    const entry = fixture(
      "tools.mjs",
      `import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", async () => {
  const report = {};
  try {
    report.spawn = spawnSync(process.execPath, ["-e", "process.stdout.write('ok')"], { encoding: "utf8" }).stdout;
  } catch (error) {
    report.spawn = error.code;
  }
  try {
    report.worker = await new Promise((resolve, reject) => {
      const worker = new Worker("require('node:worker_threads').parentPort.postMessage('ok')", { eval: true });
      worker.once("message", resolve);
      worker.once("error", reject);
    });
  } catch (error) {
    report.worker = error.code;
  }
  try {
    report.outside = readFileSync(${JSON.stringify(outside)}, "utf8");
  } catch (error) {
    report.outside = error.code;
  }
  process.stdout.write(JSON.stringify({ type: "job.completed", jobId: "x", at: new Date().toISOString(), summary: JSON.stringify(report) }) + "\\n");
});
`,
    );
    const runtime = createChildAgentRuntime({
      mode: "pi",
      entry,
      loadProvider: async () => ({ config: { kind: "custom", id: "p", enabled: true, auth: { type: "none" } }, credentials: { env: {}, secrets: {} } }),
    });
    const done = await (await runtime.startJob(spec(dirs(), { provider: "p", id: "m" }))).done;
    if (done.type === "job.failed") console.log("DBG", done.error);
    expect(done.type).toBe("job.completed");
    const report = JSON.parse(done.type === "job.completed" ? done.summary : "{}") as Record<string, string>;
    expect(report).toEqual({ spawn: "ok", worker: "ok", outside: "ERR_ACCESS_DENIED" });
  });

  it("kills the child on abort and on timeout", async () => {
    const entry = fixture("hang.mjs", "setInterval(() => undefined, 1000);\n");
    const runtime = createChildAgentRuntime({ mode: "mock", entry, graceSec: 0 });
    const aborted = await runtime.startJob(spec(dirs()));
    setTimeout(() => void aborted.abort("cancelled by alice"), 300);
    expect(await aborted.done).toMatchObject({ type: "job.failed", reason: "aborted", error: "cancelled by alice" });

    const timedOut = await runtime.startJob(spec(dirs(), undefined, 1));
    expect(await timedOut.done).toMatchObject({ type: "job.failed", reason: "timeout" });
  }, 30_000);

  it("kills a child that goes silent, but not one that keeps reporting", async () => {
    const silent = fixture("silent.mjs", 'process.stdout.write(JSON.stringify({ type: "message.delta", jobId: "x", text: "thinking" }) + "\\n");\nsetInterval(() => undefined, 1000);\n');
    const stalled = await createChildAgentRuntime({ mode: "mock", entry: silent, idleTimeoutSec: 1 }).startJob(spec(dirs()));
    const done = await stalled.done;
    expect(done).toMatchObject({ type: "job.failed", reason: "timeout" });
    expect(done.type === "job.failed" ? done.error : "").toMatch(/stalled: no activity from the model for 1s/);

    const chatty = fixture(
      "chatty.mjs",
      `let n = 0;
const tick = setInterval(() => {
  n += 1;
  const event = n < 6 ? { type: "message.delta", jobId: "x", text: "." } : { type: "job.completed", jobId: "x", at: new Date().toISOString(), summary: "done" };
  process.stdout.write(JSON.stringify(event) + "\\n");
  if (n >= 6) { clearInterval(tick); setTimeout(() => process.exit(0), 50); }
}, 400);
`,
    );
    const busy = await createChildAgentRuntime({ mode: "mock", entry: chatty, idleTimeoutSec: 1 }).startJob(spec(dirs()));
    expect(await busy.done).toMatchObject({ type: "job.completed", summary: "done" });
  }, 30_000);
});
