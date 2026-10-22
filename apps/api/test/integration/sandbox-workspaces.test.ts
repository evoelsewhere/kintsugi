// The sandbox view of Monitoring (ADR-0058): the job workspaces on the data volume with the run behind each, and the
// admin's request to remove one. The API cannot write the volume: a removal is asked of the worker, and refused while the
// run is active or the write of its output is pending.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { type Client, adminClient, memberClient, startTestApp, type TestApp } from "../support/app.js";

const dataDir = mkdtempSync(join(tmpdir(), "kintsugi-sandbox-"));
const previousDataDir = process.env["KINTSUGI_DATA_DIR"];
process.env["KINTSUGI_DATA_DIR"] = dataDir;

interface WorkspaceRow {
  jobId: string;
  lifecycle?: string;
  attempt?: number;
  sources: string[];
  hasCheckouts: boolean;
  resultsBytes?: number;
  run?: { name: string; status: string; projectId: string; writeStatus?: string };
  removalAt?: string;
  blockedBy?: string;
}

/** A workspace folder as the worker leaves it: a manifest, an output file and a checkout. */
function workspace(id: string, manifest: Record<string, unknown> | undefined, outBytes: number): void {
  const root = join(dataDir, "jobs", id);
  mkdirSync(join(root, "out"), { recursive: true });
  mkdirSync(join(root, "as-is", "legacy"), { recursive: true });
  writeFileSync(join(root, "out", "result.md"), "x".repeat(outBytes));
  writeFileSync(join(root, "as-is", "legacy", "big.bin"), "y".repeat(5000));
  if (manifest !== undefined) writeFileSync(join(root, "workspace.json"), JSON.stringify({ version: 1, jobId: id, sources: [], updatedAt: new Date().toISOString(), ...manifest }));
}

describe.skipIf(!hasDatabase)("sandbox workspaces (integration)", () => {
  let app: TestApp;
  let admin: Client;

  beforeAll(async () => {
    app = await startTestApp();
    admin = await adminClient(app);
    await app.db.query("insert into admin.project (id, name) values ('demo', 'Demo')");
    await app.db.query("insert into admin.application (project_id, id, name) values ('demo', 'web', 'Web')");
    await app.db.query(
      `insert into workflow.document_write (id, project_id, kind, message, status) values ('w-queued', 'demo', 'job-output', 'Assess', 'queued'), ('w-done', 'demo', 'job-output', 'Assess', 'pr-opened')`,
    );
    await app.db.query(
      `insert into workflow.job_run (id, project_id, application_id, kind, name, status, attempt, document_write_id, finished_at) values
        ('run-failed', 'demo', 'web', 'stage', 'assess', 'failed', 2, null, now() - interval '1 hour'),
        ('run-running', 'demo', 'web', 'stage', 'understand', 'running', 1, null, null),
        ('run-pending-write', 'demo', 'web', 'stage', 'assess', 'succeeded', 1, 'w-queued', now() - interval '1 hour'),
        ('run-written', 'demo', 'web', 'stage', 'assess', 'succeeded', 1, 'w-done', now() - interval '1 hour')`,
    );
    workspace("run-failed", { attempt: 2, state: "parked", sources: [{ repositoryId: "legacy", commit: "a".repeat(40), role: "legacy" }] }, 120);
    workspace("run-running", { attempt: 1, state: "running" }, 10);
    workspace("run-pending-write", { attempt: 1, state: "published", checkoutsDroppedAt: new Date().toISOString() }, 10);
    workspace("run-written", { attempt: 1, state: "published" }, 10);
    workspace("orphan", undefined, 10);
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  it("lists the workspaces with their run, lifecycle, results size and when the sweep removes them", async () => {
    const list = await admin.get<{ retentionDays: number; workspaces: WorkspaceRow[] }>("/monitoring/sandbox/workspaces");
    expect(list.status).toBe(200);
    expect(list.body.data?.retentionDays).toBe(7);
    const byId = new Map(list.body.data?.workspaces.map((entry) => [entry.jobId, entry]));
    expect([...byId.keys()].sort()).toEqual(["orphan", "run-failed", "run-pending-write", "run-running", "run-written"]);

    const failed = byId.get("run-failed")!;
    expect(failed).toMatchObject({ lifecycle: "parked", attempt: 2, hasCheckouts: true, run: { name: "assess", status: "failed", projectId: "demo" } });
    expect(failed.sources).toEqual(["legacy:legacy@aaaaaaaa"]);
    // Only what cannot be made again is measured: the 5000-byte checkout is left out.
    expect(failed.resultsBytes).toBeGreaterThanOrEqual(120);
    expect(failed.resultsBytes).toBeLessThan(5000);
    expect(failed.blockedBy).toBeUndefined();
    expect(new Date(failed.removalAt ?? "").getTime()).toBeGreaterThan(Date.now() + 5 * 24 * 60 * 60 * 1000);

    expect(byId.get("run-running")).toMatchObject({ run: { status: "running" }, blockedBy: "its run is running" });
    expect(byId.get("run-running")?.removalAt).toBeUndefined();
    expect(byId.get("run-pending-write")).toMatchObject({ hasCheckouts: false, blockedBy: "the document write of its output has not run yet" });
    // A run whose write landed is due at the next sweep; a folder no run refers to is kept for the retention period.
    expect(new Date(byId.get("run-written")?.removalAt ?? "").getTime()).toBeLessThanOrEqual(Date.now());
    expect(byId.get("orphan")).toMatchObject({ hasCheckouts: true });
    expect(byId.get("orphan")?.run).toBeUndefined();
    expect(byId.get("orphan")?.blockedBy).toBeUndefined();
  });

  it("hands a removal to the worker, and refuses an active run, a pending write and an unknown workspace", async () => {
    const queued = await admin.request("DELETE", "/monitoring/sandbox/workspaces/run-failed");
    expect(queued.status).toBe(202);
    expect(queued.body.data).toEqual({ jobId: "run-failed", status: "queued" });
    // The API cannot write the volume: the folder stays until the worker deletes it.
    expect(((await admin.get<{ workspaces: WorkspaceRow[] }>("/monitoring/sandbox/workspaces")).body.data?.workspaces ?? []).some((entry) => entry.jobId === "run-failed")).toBe(true);

    expect((await admin.request("DELETE", "/monitoring/sandbox/workspaces/run-running")).status).toBe(409);
    expect((await admin.request("DELETE", "/monitoring/sandbox/workspaces/run-pending-write")).status).toBe(409);
    expect((await admin.request("DELETE", "/monitoring/sandbox/workspaces/never-there")).status).toBe(404);
    expect((await admin.request("DELETE", "/monitoring/sandbox/workspaces/..%2Fx")).status).toBe(404);
    expect((await app.db.query("select action, subject from governance.audit_event where action = 'sandbox.workspace-remove'")).rows).toEqual([{ action: "sandbox.workspace-remove", subject: "run-failed" }]);
  });

  it("lists for any signed-in user but removes only with sandbox.manage", async () => {
    const { client } = await memberClient(app, admin, "sandbox-reader", ["user"]);
    expect((await client.get("/monitoring/sandbox/workspaces")).status).toBe(200);
    expect((await client.request("DELETE", "/monitoring/sandbox/workspaces/orphan")).status).toBe(403);
  });
});
