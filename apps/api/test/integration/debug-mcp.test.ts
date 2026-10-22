/* eslint-disable @typescript-eslint/no-explicit-any -- the JSON the tools answer with is read loosely, by shape */
// The debug MCP server (ADR-0056) on a development installation: who may sign in, the protocol, and each group of tools
// against a throwaway database and a throwaway data directory with a job workspace in it.

import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureLogs, pgDebugLogSink } from "@kintsugi/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { ADMIN_PASSWORD, ADMIN_USER, adminClient, memberClient, startTestApp, type Client, type TestApp } from "../support/app.js";

const dataDir = mkdtempSync(join(tmpdir(), "kintsugi-debug-data-"));
process.env["KINTSUGI_DEBUG_MCP"] = "1";
process.env["KINTSUGI_DATA_DIR"] = dataDir;

const basic = (user: string, password: string): string => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

describe.skipIf(!hasDatabase)("debug MCP server (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let id = 0;

  /** One JSON-RPC call as the administrator; the result of a tool call, parsed from its text. */
  async function rpc(method: string, params?: unknown, headers: Record<string, string> = { authorization: basic(ADMIN_USER, ADMIN_PASSWORD) }): Promise<{ status: number; body: any }> {
    id += 1;
    const response = await fetch(`${app.baseUrl}/debug/mcp`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }) });
    const text = await response.text();
    return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
  }
  async function call(name: string, args: Record<string, unknown> = {}): Promise<{ ok: boolean; data: any; text: string }> {
    const { body } = await rpc("tools/call", { name, arguments: args });
    const text: string = body.result.content[0].text;
    const ok = body.result.isError !== true;
    return { ok, text, data: ok ? JSON.parse(text) : undefined };
  }

  beforeAll(async () => {
    app = await startTestApp();
    admin = await adminClient(app);
    const q = (text: string, values: unknown[] = []): Promise<unknown> => app.db.query(text, values);
    await q("insert into admin.project (id, name) values ('demo', 'Demo')");
    await q("insert into admin.application (project_id, id, name) values ('demo', 'web', 'Web')");
    const started = new Date(Date.now() - 20 * 60_000).toISOString();
    await q(
      `insert into workflow.job_run (id, project_id, application_id, kind, name, status, attempt, failure_reason, inputs, started_at, finished_at)
       values ('run-1', 'demo', 'web', 'stage', 'assess', 'failed', 2, 'Step synthesis failed: JobOutput hook blocked the output', '{"scope":{"items":["a"]}}', $1, now() - interval '5 minutes')`,
      [started],
    );
    await q(
      `insert into workflow.job_run (id, project_id, application_id, parent_id, kind, name, status, agent, failure_reason, inputs, output_summary)
       values ('step-ok', 'demo', 'web', 'run-1', 'agent', 'legacy-analyst', 'succeeded', 'legacy-analyst@1.1.0', null, '{"label":"structure","task":"Read the code."}', '{"usage":{"inputTokens":10}}'),
              ('step-bad', 'demo', 'web', 'run-1', 'agent', 'legacy-analyst', 'failed', 'legacy-analyst@1.1.0', 'JobOutput hook blocked the output', $1, '{}')`,
      [JSON.stringify({ label: "synthesis", task: "x".repeat(9000) })],
    );
    for (const [kind, message, attempt, step] of [
      ["status", "assess started (attempt 2)", 2, null],
      ["step.started", "agent legacy-analyst started", 2, "step-bad"],
      ["tool", "read as-is/web/src/App.java", 2, "step-bad"],
      ["log", "model working: turn 3, thinking 1k chars", 2, "step-bad"],
      ["step.finished", "agent legacy-analyst failed: JobOutput hook blocked the output", 2, "step-bad"],
      ["status", "failed: Step synthesis failed", 2, null],
      ["log", "first attempt line", 1, null],
    ] as const) {
      await q("insert into workflow.job_event (job_run_id, step_run_id, kind, message, data, attempt) values ('run-1', $1, $2, $3, '{}', $4)", [step, kind, message, attempt]);
    }
    await q(
      `insert into monitoring.telemetry_span (job_run_id, step_run_id, project_id, agent, provider, model, attempt, span_id, name, started_at, duration_ms, status, error)
       values ('run-1', 'step-bad', 'demo', 'legacy-analyst@1.1.0', 'mock', 'mock', 1, 's1', 'kintsugi.job', now(), 1200, 'error', 'the model stopped'), ('run-1', 'step-bad', 'demo', 'legacy-analyst@1.1.0', 'mock', 'mock', 1, 's2', 'kintsugi.turn', now(), 300, 'ok', null)`,
    );
    for (const [service, level, message, minutesAgo] of [
      ["worker", "info", "[jobs] stage assess (run-1) started", 19],
      ["worker", "warn", "[jobs] agent legacy-analyst stalled; retrying once", 12],
      ["worker", "error", "[jobs] stage assess (run-1) failed: Step synthesis failed", 6],
      ["api", "info", "[Nest] LOG [RoutesResolver] Mapped", 30],
      ["api", "error", "[Nest] ERROR [Bootstrap] password=hunter2 boom", 1],
    ] as const) {
      await q("insert into monitoring.debug_log (at, service, level, message) values (now() - make_interval(mins => $1), $2, $3, $4)", [minutesAgo, service, level, message]);
    }
    await q("insert into workflow.worker_heartbeat (worker_id, host, pid, version, started_at, last_seen_at, active_jobs, queues) values ('w1', 'host', 1, '0.0.0', now(), now(), 1, '{job-run}')");
    await q("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('plain', 'plain-git', 'plain', 'http://127.0.0.1:9', 'none')");
    await q("insert into admin.git_repository (id, server_id, url, sync_status, last_error) values ('legacy', 'plain', 'http://127.0.0.1:9/legacy.git', 'error', 'could not resolve host')");

    // The job workspace of run-1 on the data volume (ADR-0055).
    const job = join(dataDir, "jobs", "run-1");
    for (const dir of ["as-is/web/src", "out/10-applications/web", "steps/synthesis-1a2b3c4d/out", ".state"]) mkdirSync(join(job, dir), { recursive: true });
    writeFileSync(join(job, "as-is", "web", "src", "App.java"), "class App {\n  int run() { return 1; }\n}\n");
    writeFileSync(join(job, "out", "10-applications", "web", "assessment.md"), "# Assessment\n");
    writeFileSync(join(job, "as-is", "web", "logo.bin"), Buffer.from([0x89, 0x50, 0x00, 0x47]));
    writeFileSync(join(job, "WORKSPACE.md"), "# Job workspace\n");
    writeFileSync(join(job, "workspace.json"), JSON.stringify({ version: 1, jobId: "run-1", attempt: 2, state: "parked", sources: [{ repositoryId: "web", commit: "a".repeat(40), role: "legacy" }] }));
    writeFileSync(join(job, ".state", "ledger.json"), JSON.stringify({ version: 1, gates: { which: "a" }, entries: { structure: { status: "succeeded", fingerprint: "f".repeat(64), digest: "d".repeat(64), attempt: 1, outputs: [{ path: "x.md", zone: "work" }], finishedAt: "2026-10-22T08:00:00Z" }, synthesis: { status: "failed", fingerprint: "e".repeat(64), digest: "failed", attempt: 2, outputs: [], finishedAt: "2026-10-22T08:10:00Z", reason: "boom" } } }));
    mkdirSync(join(dataDir, "outside"), { recursive: true });
    writeFileSync(join(dataDir, "outside", "secret.txt"), "not for the debug tool");
    try {
      symlinkSync(join(dataDir, "outside"), join(job, "escape"), "junction");
    } catch {
      // A link cannot be made here: the test of it is skipped below.
    }
  });
  afterAll(async () => {
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  describe("signing in", () => {
    it("needs HTTP Basic, an account of the installation and the debug.access permission", async () => {
      expect((await rpc("ping", undefined, {})).status).toBe(401);
      expect((await rpc("ping", undefined, { authorization: "Bearer abc" })).status).toBe(401);
      expect((await rpc("ping", undefined, { authorization: basic(ADMIN_USER, "wrong") })).status).toBe(401);
      expect((await rpc("ping")).body).toEqual({ jsonrpc: "2.0", id: expect.any(Number), result: {} });
      const { password } = await memberClient(app, admin, "plain-user", ["user"]);
      expect((await rpc("ping", undefined, { authorization: basic("plain-user", password) })).status).toBe(403);
      expect((await fetch(`${app.baseUrl}/debug/mcp`, { headers: { authorization: basic(ADMIN_USER, ADMIN_PASSWORD) } })).status).toBe(405);
    });

    it("locks an account out after repeated failures, like a sign-in", async () => {
      for (let attempt = 0; attempt < 6; attempt += 1) await rpc("ping", undefined, { authorization: basic("someone-else", "nope") });
      expect((await rpc("ping", undefined, { authorization: basic("someone-else", "nope") })).status).toBe(429);
    });
  });

  describe("the protocol", () => {
    it("initializes, lists the tools with their input schemas, and takes a notification without answering", async () => {
      const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
      expect(init.body.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "kintsugi-debug" } });
      expect(init.body.result.instructions).toContain("runs.failure");
      const listed = await rpc("tools/list");
      const names = listed.body.result.tools.map((tool: { name: string }) => tool.name);
      expect(names).toEqual([
        "runs.list", "runs.get", "runs.step", "runs.events", "runs.failure", "runs.telemetry", "runs.ledger",
        "workspace.jobs", "workspace.tree", "workspace.read", "logs.tail", "logs.search",
        "system.status", "queues.list", "repos.status", "db.tables", "db.query",
      ]);
      const events = listed.body.result.tools.find((tool: { name: string }) => tool.name === "runs.events");
      expect(events.inputSchema).toMatchObject({ type: "object", required: ["runId"], properties: { runId: { type: "string" }, order: { enum: ["asc", "desc"] } } });
      expect(events.inputSchema.$schema).toBeUndefined();
      const notification = await fetch(`${app.baseUrl}/debug/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: basic(ADMIN_USER, ADMIN_PASSWORD) }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
      expect(notification.status).toBe(202);
      expect((await rpc("nope/method")).body.error).toMatchObject({ code: -32601 });
    });

    it("answers a bad call as a tool error the model can read, and an unknown tool as a protocol error", async () => {
      const invalid = await call("runs.events", { runId: "run-1", limit: 0 });
      expect(invalid.ok).toBe(false);
      expect(invalid.text).toContain("Invalid arguments for runs.events: limit");
      expect((await call("runs.get", { runId: "missing" })).text).toContain("Run missing not found");
      expect((await rpc("tools/call", { name: "no.such.tool", arguments: {} })).body.error).toMatchObject({ code: -32602 });
    });

    it("audits each tool call with its arguments, and nothing it returned", async () => {
      await call("runs.list", { limit: 3 });
      const audit = await app.db.query<{ subject: string; detail: { args: unknown; username: string } }>("select subject, detail from governance.audit_event where action = 'debug.call' order by id desc limit 1");
      expect(audit.rows[0]).toMatchObject({ subject: "runs.list", detail: { args: { limit: 3 }, username: ADMIN_USER } });
    });
  });

  describe("runs", () => {
    it("lists runs and gets one with its steps, attempts and inputs", async () => {
      const list = await call("runs.list", { status: ["failed"] });
      expect(list.data.runs).toEqual([expect.objectContaining({ id: "run-1", status: "failed", attempt: 2, steps: 2, failed_steps: 1 })]);
      expect((await call("runs.list", { status: ["succeeded"] })).data.runs).toEqual([]);
      const run = (await call("runs.get", { runId: "run-1" })).data;
      expect(run).toMatchObject({ id: "run-1", attempt: 2, failureReason: expect.stringContaining("JobOutput hook"), inputs: { scope: { items: ["a"] } } });
      const byId = new Map<string, { label: string; status: string; usage: unknown }>(run.steps.map((step: { id: string; label: string; status: string; usage: unknown }) => [step.id, step]));
      expect([...byId.keys()].sort()).toEqual(["step-bad", "step-ok"]);
      expect(byId.get("step-ok")).toMatchObject({ label: "structure", status: "succeeded", usage: { inputTokens: 10 } });
    });

    it("shows the task a step ran with, cut when it is long", async () => {
      const step = (await call("runs.step", { stepId: "step-bad" })).data;
      expect(step.inputs.task).toMatch(/^x+… \[9000 characters\]$/);
      expect(step.inputs.label).toBe("synthesis");
    });

    it("pages the events and filters them by attempt, kind, step and text", async () => {
      const all = (await call("runs.events", { runId: "run-1" })).data;
      expect(all.count).toBe(7);
      const second = (await call("runs.events", { runId: "run-1", attempt: 2, limit: 2 })).data;
      expect(second.events.map((event: { message: string }) => event.message)).toEqual(["assess started (attempt 2)", "agent legacy-analyst started"]);
      expect(second.nextCursor).toBe(second.events[1].id);
      const next = (await call("runs.events", { runId: "run-1", attempt: 2, limit: 2, cursor: second.nextCursor })).data;
      expect(next.events[0].message).toBe("read as-is/web/src/App.java");
      const newest = (await call("runs.events", { runId: "run-1", order: "desc", limit: 1 })).data;
      expect(newest.events[0].message).toBe("first attempt line");
      expect((await call("runs.events", { runId: "run-1", kinds: ["tool"] })).data.events).toHaveLength(1);
      expect((await call("runs.events", { runId: "run-1", stepId: "step-bad", text: "FAILED" })).data.events).toHaveLength(1);
    });

    it("sums up a failure: the failed step, the last events without the model's progress lines, and what the services logged meanwhile", async () => {
      const failure = (await call("runs.failure", { runId: "run-1" })).data;
      expect(failure.failedSteps).toEqual([expect.objectContaining({ id: "step-bad", label: "synthesis", failure_reason: "JobOutput hook blocked the output" })]);
      const last = failure.lastEvents.map((event: { message: string }) => event.message);
      expect(last).toContain("failed: Step synthesis failed");
      expect(last.some((message: string) => message.startsWith("model working:"))).toBe(false);
      expect(last).not.toContain("first attempt line");
      expect(failure.problemEvents.map((event: { message: string }) => event.message)).toEqual(expect.arrayContaining(["agent legacy-analyst failed: JobOutput hook blocked the output"]));
      expect(failure.serviceLogWarnings.map((line: { message: string }) => line.message)).toEqual(["[jobs] agent legacy-analyst stalled; retrying once", "[jobs] stage assess (run-1) failed: Step synthesis failed"]);
    });

    it("adds up the model usage per step and lists the spans that ended in an error", async () => {
      const telemetry = (await call("runs.telemetry", { runId: "run-1" })).data;
      expect(telemetry.perStep).toEqual([expect.objectContaining({ step_run_id: "step-bad", turns: 1, errors: 1, job_ms: 1200, model: "mock/mock" })]);
      expect(telemetry.errors).toEqual([expect.objectContaining({ name: "kintsugi.job", error: "the model stopped" })]);
    });

    it("reads the ledger and the manifest of the job's workspace", async () => {
      const ledger = (await call("runs.ledger", { runId: "run-1" })).data;
      expect(ledger.manifest).toMatchObject({ attempt: 2, state: "parked" });
      expect(ledger.ledger.entries).toEqual([
        expect.objectContaining({ key: "structure", status: "succeeded", attempt: 1, fingerprint: "ffffffffffff", files: 1 }),
        expect.objectContaining({ key: "synthesis", status: "failed", attempt: 2, reason: "boom", files: 0 }),
      ]);
      expect(ledger.ledger.gates).toEqual({ which: "a" });
      expect(ledger.stepFolders).toEqual(["synthesis-1a2b3c4d"]);
      expect((await call("runs.ledger", { runId: "no-workspace" })).text).toContain("No workspace for job no-workspace");
    });
  });

  describe("the sandbox on disk", () => {
    it("lists the workspaces with their run status, and walks one", async () => {
      const jobs = (await call("workspace.jobs")).data;
      expect(jobs.jobs).toEqual([expect.objectContaining({ id: "run-1", manifest: expect.objectContaining({ state: "parked" }), run: expect.objectContaining({ status: "failed", attempt: 2 }) })]);
      expect(jobs.jobs[0].entries).toEqual(expect.arrayContaining([".state", "WORKSPACE.md", "as-is", "out", "steps", "workspace.json"]));
      expect(jobs.disk.dataDir).toBe(dataDir);
      const tree = (await call("workspace.tree", { runId: "run-1", depth: 4 })).data;
      expect(tree.entries.map((entry: { path: string }) => entry.path)).toEqual(expect.arrayContaining(["as-is/", "as-is/web/", "as-is/web/src/", "as-is/web/src/App.java", "out/10-applications/web/assessment.md", "WORKSPACE.md"]));
      const shallow = (await call("workspace.tree", { runId: "run-1", path: "as-is", depth: 1 })).data;
      expect(shallow.entries).toEqual([expect.objectContaining({ path: "as-is/web/", type: "dir", entries: 2 })]);
      expect((await call("workspace.tree", { runId: "run-1", limit: 2 })).data.truncated).toBe(true);
    });

    it("reads a file in bounded pieces, says a binary file is one, and refuses what leaves the workspace", async () => {
      const file = (await call("workspace.read", { runId: "run-1", path: "as-is/web/src/App.java" })).data;
      expect(file).toMatchObject({ path: "as-is/web/src/App.java", size: 40, binary: false, truncated: false, text: "class App {\n  int run() { return 1; }\n}\n" });
      const piece = (await call("workspace.read", { runId: "run-1", path: "as-is/web/src/App.java", offset: 6, length: 3 })).data;
      expect(piece).toMatchObject({ text: "App", offset: 6, length: 3, truncated: true });
      expect((await call("workspace.read", { runId: "run-1", path: "as-is/web/logo.bin" })).data).toMatchObject({ binary: true, size: 4 });
      expect((await call("workspace.read", { runId: "run-1", path: "../../outside/secret.txt" })).text).toContain("leaves the job's workspace");
      expect((await call("workspace.read", { runId: "run-1", path: "/etc/passwd" })).text).toMatch(/not in the workspace|leaves/);
      expect((await call("workspace.read", { runId: "../run-1", path: "WORKSPACE.md" })).text).toContain("is not a job id");
      expect((await call("workspace.read", { runId: "run-1", path: "as-is" })).text).toContain("is not a file");
      const escaped = await call("workspace.read", { runId: "run-1", path: "escape/secret.txt" });
      expect(escaped.ok === false || !String(escaped.text).includes("not for the debug tool")).toBe(true);
    });
  });

  describe("logs", () => {
    it("tails what the services printed, oldest first, with what was captured", async () => {
      const tail = (await call("logs.tail", { minLevel: "warn" })).data;
      expect(tail.lines.map((line: { service: string; level: string }) => [line.service, line.level])).toEqual([["worker", "warn"], ["worker", "error"], ["api", "error"]]);
      expect(tail.capture.services).toEqual([expect.objectContaining({ service: "api", lines: 2, errors: 1 }), expect.objectContaining({ service: "worker", lines: 3, errors: 1 })]);
      expect((await call("logs.tail", { service: "api", since: "10m" })).data.lines).toHaveLength(1);
      expect((await call("logs.tail", { since: "yesterday-ish" })).text).toContain("is not a time");
    });

    it("searches by regular expression with the lines around a hit, and rejects a bad one", async () => {
      const plain = (await call("logs.search", { pattern: "stalled|failed" })).data;
      expect(plain.hits.map((hit: { message: string }) => hit.message)).toEqual(["[jobs] agent legacy-analyst stalled; retrying once", "[jobs] stage assess (run-1) failed: Step synthesis failed"]);
      const withContext = (await call("logs.search", { pattern: "stalled", context: 1 })).data;
      expect(withContext.around[0].lines.map((line: { message: string }) => line.message)).toEqual(["[jobs] stage assess (run-1) started", "[jobs] agent legacy-analyst stalled; retrying once", "[jobs] stage assess (run-1) failed: Step synthesis failed"]);
      expect((await call("logs.search", { pattern: "(" })).ok).toBe(false);
    });
  });

  describe("capturing the logs", () => {
    it("writes what a process prints to the table through the real sink, redacted, and the tool reads it back", async () => {
      const written: string[] = [];
      const stream = { write: (chunk: unknown): boolean => (written.push(String(chunk)), true) };
      const capture = captureLogs({ service: "worker", sink: pgDebugLogSink({ query: (text, values) => app.db.query(text, values) }), stdout: stream, stderr: { write: () => true }, flushMs: 60_000 });
      stream.write("[worker] captured line one\n[worker] sign-in with password=s3cret failed\n");
      await capture.stop();
      const lines = (await call("logs.search", { pattern: "captured line|sign-in", since: "1m" })).data.hits.map((hit: { level: string; message: string }) => [hit.level, hit.message]);
      expect(lines).toEqual([["info", "[worker] captured line one"], ["error", "[worker] sign-in with [redacted] failed"]]);
    });
  });

  describe("the system", () => {
    it("reports the API, the database, the workers and the repositories", async () => {
      const status = (await call("system.status")).data;
      expect(status.api).toMatchObject({ service: "kintsugi-api", debugMcp: true });
      expect(status.database.migrations.n).toBeGreaterThanOrEqual(25);
      expect(status.workers).toEqual([expect.objectContaining({ worker_id: "w1", up: true })]);
      expect(status.runsLastDay24hAndActive ?? status.runsLast24hAndActive).toEqual([expect.objectContaining({ status: "failed", n: 1 })]);
      expect(status.repositoriesBySync).toEqual([{ sync_status: "error", n: 1 }]);
      expect(status.disk.dataDir).toBe(dataDir);
      expect(status.logCapture.services).toHaveLength(2);
      const repos = (await call("repos.status")).data;
      expect(repos.repositories).toEqual([expect.objectContaining({ id: "legacy", sync_status: "error", last_error: "could not resolve host" })]);
    });

    it("lists the queues of the worker", async () => {
      const queues = (await call("queues.list")).data;
      expect(Array.isArray(queues.queues)).toBe(true);
      expect(queues.recentFailures).toBeDefined();
    });
  });

  describe("the database", () => {
    it("lists tables and the columns of one", async () => {
      const tables = (await call("db.tables", { schema: "workflow" })).data;
      expect(tables.tables.map((entry: { table: string }) => entry.table)).toEqual(expect.arrayContaining(["job_run", "job_event", "worker_heartbeat"]));
      const columns = (await call("db.tables", { schema: "workflow", table: "job_run" })).data;
      expect(columns.columns.map((column: { name: string }) => column.name)).toEqual(expect.arrayContaining(["attempt", "attempts", "failure_reason"]));
    });

    it("runs one read-only select, with a row limit, and refuses everything else", async () => {
      const rows = (await call("db.query", { sql: "select id, status from workflow.job_run where parent_id is null order by id", limit: 5 })).data;
      expect(rows).toEqual({ columns: ["id", "status"], rows: [{ id: "run-1", status: "failed" }], truncated: false });
      const limited = (await call("db.query", { sql: "select generate_series(1, 10) as n", limit: 3 })).data;
      expect(limited.rows).toHaveLength(3);
      expect(limited.truncated).toBe(true);
      expect((await call("db.query", { sql: "with x as (select 1 as one) select * from x;" })).data.rows).toEqual([{ one: 1 }]);
      for (const [sql, message] of [
        ["update workflow.job_run set status = 'queued'", "Only select and with"],
        ["select 1; select 2", "One statement only"],
        ["with x as (delete from workflow.job_run returning 1) select * from x", "keyword that changes things"],
        ["select * from governance.restricted_record", "holds secrets"],
        ["select * from core.user_session", "holds secrets"],
        ["select pg_read_file('/etc/passwd')", "reads files"],
        ["explain select 1", "Only select and with"],
      ] as const) {
        const refused = await call("db.query", { sql });
        expect(refused.ok, sql).toBe(false);
        expect(refused.text, sql).toContain(message);
      }
      // Nothing changed.
      expect((await app.db.query("select status from workflow.job_run where id = 'run-1'")).rows[0]).toEqual({ status: "failed" });
    });
  });
});
