// Job runs through the worker (integration): a queued assess stage on the `job-run` queue,
// run against a real Git remote and a throwaway database with the mock agent backend; the
// Postgres store records the steps, artifacts and the encrypted restricted record, and the
// stage's output lands in the document repo through the writer.

import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { type GitHttpServer, startGitHttpServer } from "@kintsugi/git/testing";
import { createChildAgentRuntime } from "@kintsugi/runtime/launcher";
import { decryptSecret } from "@kintsugi/secrets";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgJobStore } from "../src/jobs/store.js";
import { startWorker } from "../src/worker.js";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./support/database.js";
import { writingAgentRuntime } from "./support/jobs.js";

describe.skipIf(!hasDatabase)("job runs through the worker (integration)", () => {
  let db: TestDatabase;
  let remote: GitHttpServer;
  let dataDir: string;

  beforeAll(async () => {
    process.env["KINTSUGI_SECRET_KEY"] ??= randomBytes(32).toString("base64");
    db = await createTestDatabase();
    remote = await startGitHttpServer();
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-job-runs-data-"));
    await remote.createRepository("legacy");
    await remote.commit("legacy", "main.c", "int main(void) { if (1) return 0; return 1; }\n");
    await remote.createRepository("docs");
    await db.pool.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('plain', 'plain-git', 'plain', $1, 'none')", [remote.baseUrl]);
    for (const id of ["legacy", "docs"]) {
      await db.pool.query("insert into admin.git_repository (id, server_id, url, default_branch) values ($1, 'plain', $2, 'main')", [id, `${remote.baseUrl}/${id}.git`]);
    }
    await db.pool.query("insert into admin.project (id, name) values ('demo', 'Demo')");
    await db.pool.query("insert into admin.application (project_id, id, name) values ('demo', 'web', 'Web')");
    await db.pool.query("insert into admin.project_repository (project_id, repository_id, role) values ('demo', 'docs', 'document')");
    await db.pool.query("insert into admin.project_repository (project_id, application_id, repository_id, role) values ('demo', 'web', 'legacy', 'legacy')");
  });
  afterAll(async () => {
    await remote?.close();
    await db?.drop();
    if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
  });

  it("runs a queued assess stage and hands its output to the document repo writer", async () => {
    const agents = writingAgentRuntime({
      "legacy-analyst": (spec): Record<string, string> =>
        spec.task.startsWith("Write the assessment")
          ? { "10-applications/web/01-legacy/assessment.md": "# Assessment of web (draft)\n", "restricted/SECRETS.local.md": "| preview | location |\n| hu** | main.c:1 |\n" }
          : {},
    });
    const storage = new CheckoutStorage(dataDir);
    const worker = await startWorker({ databaseUrl: db.url, pool: db.pool, storage, pollIntervalSeconds: 3600, log: () => undefined, jobs: { agents } });
    try {
      const id = randomUUID();
      await db.pool.query(
        "insert into workflow.job_run (id, project_id, application_id, kind, name, source_repository_id, actor) values ($1, 'demo', 'web', 'stage', 'assess', 'legacy', 'alice')",
        [id],
      );
      await worker.requestJobRun({ jobRunId: id });

      const run = async (): Promise<{ status: string; failure_reason: string | null; source_commit: string | null; document_write_id: string | null }> =>
        (await db.pool.query("select status, failure_reason, source_commit, document_write_id from workflow.job_run where id = $1", [id])).rows[0];
      await expect.poll(async () => (await run()).status, { timeout: 150_000, interval: 250 }).not.toMatch(/queued|running/);
      const finished = await run();
      expect(finished).toMatchObject({ status: "succeeded", failure_reason: null, source_commit: remote.git("legacy", "rev-parse", "main").trim() });

      const steps = await db.pool.query<{ id: string; kind: string; name: string; status: string; script_hash: string | null; agent: string | null }>(
        "select id, kind, name, status, script_hash, agent from workflow.job_run where parent_id = $1 order by created_at",
        [id],
      );
      expect(steps.rows.map((row) => [row.kind, row.name, row.status])).toEqual([
        ["script", "inventory.py", "succeeded"],
        ["agent", "legacy-analyst", "succeeded"],
        ["agent", "legacy-analyst", "succeeded"],
        ["agent", "security-auditor", "succeeded"],
        ["agent", "legacy-analyst", "succeeded"],
        ["script", "extract_topology.py", "succeeded"],
        ["script", "render_topology.py", "succeeded"],
        ["script", "catalog_from_topology.py", "succeeded"],
        ["agent", "legacy-analyst", "succeeded"],
        ["script", "apply_catalog_edits.py", "succeeded"],
        ["script", "reconcile_catalog.py", "succeeded"],
        ["script", "render_catalog.py", "succeeded"],
        ["agent", "legacy-analyst", "succeeded"],
        ["script", "style_architecture.py", "succeeded"],
      ]);
      expect(steps.rows[0]?.script_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(steps.rows[12]?.agent).toBe("legacy-analyst@1.1.0");

      // Every agent step left the spans of its attempt (ADR-0048), tied to the step and the model it ran with.
      const spans = await db.pool.query<{ step_run_id: string; name: string; agent: string; provider: string; model: string; attempt: number }>(
        "select step_run_id, name, agent, provider, model, attempt from monitoring.telemetry_span where job_run_id = $1",
        [id],
      );
      const agentSteps = steps.rows.filter((row) => row.kind === "agent");
      expect(spans.rows.filter((row) => row.name === "kintsugi.job").map((row) => row.step_run_id).sort()).toEqual(agentSteps.map((row) => row.id).sort());
      expect(spans.rows.every((row) => row.provider === "mock" && row.model === "mock" && row.attempt === 1 && row.agent.includes("@"))).toBe(true);
      expect(spans.rows.some((row) => row.name === "kintsugi.turn")).toBe(true);

      const artifacts = await db.pool.query<{ path: string; provenance: { origin: string } }>("select path, provenance from workflow.artifact where job_run_id = $1 order by path", [id]);
      // Compared in code-unit order: the database collation may place `_` folders elsewhere.
      expect(artifacts.rows.map((row) => [row.path, row.provenance.origin]).sort(([a], [b]) => (a! < b! ? -1 : a! > b! ? 1 : 0))).toEqual([
        ["10-applications/web/01-legacy/_catalog/index.md", "tool"],
        ["10-applications/web/01-legacy/_catalog/root.md", "tool"],
        ["10-applications/web/01-legacy/_tools/extract_topology.py", "runtime-agent"],
        ["10-applications/web/01-legacy/architecture.mmd", "tool"],
        ["10-applications/web/01-legacy/assessment.md", "runtime-agent"],
        ["10-applications/web/01-legacy/inventory.md", "tool"],
        ["10-applications/web/01-legacy/topology.md", "tool"],
      ]);

      const restricted = await db.pool.query<{ path: string; ciphertext: string; iv: string; auth_tag: string }>(
        "select path, ciphertext, iv, auth_tag from governance.restricted_record where job_run_id = $1",
        [steps.rows[12]!.id],
      );
      expect(restricted.rows).toHaveLength(1);
      expect(restricted.rows[0]!.ciphertext).not.toContain("hu**");
      expect(decryptSecret({ ciphertext: restricted.rows[0]!.ciphertext, iv: restricted.rows[0]!.iv, authTag: restricted.rows[0]!.auth_tag })).toContain("hu**");

      // The writer commits the stage's out/ to a kintsugi/* branch (plain-git: no pull request).
      const writeId = finished.document_write_id!;
      await expect.poll(async () => (await db.pool.query("select status from workflow.document_write where id = $1", [writeId])).rows[0]?.status, { timeout: 30_000, interval: 250 }).toBe("committed");
      // The output has landed: the job's workspace is gone.
      await expect.poll(() => existsSync(storage.job(id).root), { timeout: 10_000, interval: 100 }).toBe(false);
      const write = (await db.pool.query<{ branch: string; job_id: string; agent: string; actor: string }>("select branch, job_id, agent, actor from workflow.document_write where id = $1", [writeId])).rows[0]!;
      expect(write).toMatchObject({ branch: `kintsugi/legacy-analyst/${id}`, job_id: id, agent: "legacy-analyst@1.1.0", actor: "alice" });
      expect(remote.git("docs", "show", `${write.branch}:10-applications/web/01-legacy/assessment.md`)).toContain("Assessment of web");
      expect(remote.git("docs", "show", `${write.branch}:10-applications/web/01-legacy/inventory.md`)).toContain('sourceFileCount:');
      expect(() => remote.git("docs", "show", `${write.branch}:restricted/SECRETS.local.md`)).toThrow();
      expect(remote.git("docs", "log", "-1", "--format=%(trailers:only,unfold)", write.branch).trim()).toBe(`Kintsugi-Job: ${id}\nKintsugi-Agent: legacy-analyst@1.1.0\nKintsugi-Actor: alice`);
    } finally {
      await worker.stop();
    }
  });

  it("cancels a running run on request: the worker kills its processes and records it as cancelled, with its live events", async () => {
    const hang = join(dataDir, "hang.mjs");
    writeFileSync(hang, "setInterval(() => undefined, 1000);\n");
    const storage = new CheckoutStorage(dataDir);
    const agents = createChildAgentRuntime({ mode: "mock", entry: hang });
    const worker = await startWorker({ databaseUrl: db.url, pool: db.pool, storage, pollIntervalSeconds: 3600, cancelPollSeconds: 0.2, log: () => undefined, jobs: { agents } });
    try {
      const id = randomUUID();
      await db.pool.query("insert into workflow.job_run (id, project_id, application_id, kind, name, source_repository_id, actor) values ($1, 'demo', 'web', 'stage', 'assess', 'legacy', 'alice')", [id]);
      await worker.requestJobRun({ jobRunId: id });
      const agentRunning = async (): Promise<boolean> =>
        (await db.pool.query("select 1 from workflow.job_event where job_run_id = $1 and kind = 'step.started' and data->>'kind' = 'agent'", [id])).rowCount! >= 1;
      await expect.poll(agentRunning, { timeout: 150_000, interval: 250 }).toBe(true);

      await db.pool.query("update workflow.job_run set cancel_requested_at = now(), cancel_requested_by = 'bob' where id = $1", [id]);
      await expect.poll(async () => (await db.pool.query("select status from workflow.job_run where id = $1", [id])).rows[0]?.status, { timeout: 30_000, interval: 250 }).toBe("cancelled");
      const steps = await db.pool.query<{ kind: string; status: string }>("select kind, status from workflow.job_run where parent_id = $1 order by created_at", [id]);
      const [script, ...agentSteps] = steps.rows.map((row) => [row.kind, row.status]);
      expect(script).toEqual(["script", "succeeded"]);
      expect(agentSteps.length).toBeGreaterThan(0);
      for (const step of agentSteps) expect(step).toEqual(["agent", "cancelled"]);
      const events = await db.pool.query<{ kind: string; message: string }>("select kind, message from workflow.job_event where job_run_id = $1 order by id", [id]);
      expect(events.rows[0]).toEqual({ kind: "status", message: "stage assess started" });
      expect(events.rows.at(-1)).toEqual({ kind: "status", message: "cancelled" });
    } finally {
      await worker.stop();
    }
  }, 120_000);

  it("prunes spans older than the retention period and keeps the recent ones", async () => {
    const store = new PgJobStore(db.pool);
    const id = randomUUID();
    await db.pool.query("insert into workflow.job_run (id, project_id, application_id, kind, name) values ($1, 'demo', 'web', 'agent', 'legacy-analyst')", [id]);
    const span = (name: string, startedAt: string) => ({
      runId: id,
      projectId: "demo",
      agent: "legacy-analyst@1.1.0",
      provider: "mock",
      model: "mock",
      attempt: 1,
      span: { id: name, name: "kintsugi.job", startedAt, durationMs: 5, status: "ok" as const, attributes: { turns: 1 } },
    });
    await store.addSpans([span("old", new Date(Date.now() - 40 * 86_400_000).toISOString()), span("recent", new Date().toISOString())]);
    expect(await store.pruneTelemetry(30)).toBeGreaterThanOrEqual(1);
    const left = await db.pool.query<{ span_id: string }>("select span_id from monitoring.telemetry_span where job_run_id = $1", [id]);
    expect(left.rows.map((row) => row.span_id)).toEqual(["recent"]);
  });
});
