// Runtime job runs (ADR-0027, ADR-0029): starting a stage records a queued run and enqueues it
// on the worker's `job-run` queue; the list and detail show what the worker records; restricted
// records are readable with restricted.read only. The worker itself is tested in
// services/orchestrator.

import { encryptSecret } from "@kintsugi/secrets";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { type Client, adminClient, memberClient, startTestApp, subRole, type TestApp } from "../support/app.js";

interface RunView {
  id: string;
  projectId: string;
  applicationId?: string;
  kind: string;
  name: string;
  status: string;
  sourceRepositoryId?: string;
  actor?: string;
  restrictedRecords: number;
  documentWrite?: { id: string; status: string; prUrl?: string };
  steps?: RunView[];
  artifacts?: Array<{ path: string; provenance: { origin: string } }>;
}

describe.skipIf(!hasDatabase)("runtime job runs (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let runId: string;

  beforeAll(async () => {
    app = await startTestApp();
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('github', 'github', 'GitHub', 'https://github.example.invalid', 'none')");
    for (const id of ["billing-docs", "billing-legacy"]) {
      await app.db.query("insert into admin.git_repository (id, server_id, url) values ($1, 'github', $2)", [id, `https://github.example.invalid/org/${id}.git`]);
    }
    expect((await admin.request("POST", "/admin/projects", { body: { id: "billing", name: "Billing", documentRepositoryId: "billing-docs" } })).status).toBe(201);
    for (const id of ["web", "batch"]) {
      expect((await admin.request("POST", "/admin/projects/billing/applications", { body: { id, name: id, disposition: "refactor" } })).status).toBe(201);
    }
    expect((await admin.request("POST", "/admin/projects/billing/applications/web/repositories", { body: { repositoryId: "billing-legacy", role: "legacy" } })).status).toBe(201);
  });
  afterAll(async () => {
    await app?.close();
  });

  it("starting a stage needs jobs.run; reading runs needs a session", async () => {
    const { client } = await memberClient(app, admin, "reader", ["user"]);
    expect((await client.request("POST", "/projects/billing/applications/web/stages/assess/run")).status).toBe(403);
    expect((await client.get("/projects/billing/job-runs")).status).toBe(200);
  });

  it("records the assess stage as queued and enqueues it on the job-run queue", async () => {
    const started = await admin.request<RunView>("POST", "/projects/billing/applications/web/stages/assess/run");
    expect(started.status).toBe(202);
    const run = started.body.data!;
    expect(run).toMatchObject({ projectId: "billing", applicationId: "web", kind: "stage", name: "assess", status: "queued", sourceRepositoryId: "billing-legacy", actor: "admin", restrictedRecords: 0 });
    runId = run.id;

    const jobs = await app.db.query<{ data: { jobRunId: string } }>("select data from pgboss.job where name = 'job-run'");
    expect(jobs.rows.map((row) => row.data)).toEqual([{ jobRunId: run.id }]);
  });

  it("refuses stages that cannot start", async () => {
    expect((await admin.request("POST", "/projects/billing/applications/web/stages/transform/run")).status).toBe(400);
    expect((await admin.request("POST", "/projects/billing/applications/missing/stages/assess/run")).status).toBe(404);
    expect((await admin.request("POST", "/projects/missing/applications/web/stages/assess/run")).status).toBe(404);
    const noLegacy = await admin.request("POST", "/projects/billing/applications/batch/stages/assess/run");
    expect(noLegacy.status).toBe(409);
    expect(noLegacy.body.message).toMatch(/no legacy repository/);

    // One run of a stage at a time per application.
    const again = await admin.request("POST", "/projects/billing/applications/web/stages/assess/run");
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/already queued or running/);

    // map, extract-rules and understand read the assessment: assess must have succeeded first.
    for (const stage of ["map", "extract-rules", "understand"]) {
      const early = await admin.request("POST", `/projects/billing/applications/web/stages/${stage}/run`);
      expect(early.status).toBe(409);
      expect(early.body.message).toBe(`Run assess for web first: ${stage} reads assessment/web/ASSESSMENT.md, which assess writes (merge its pull request before running ${stage})`);
    }
  });

  it("shows the worker's record: steps, artifacts, document write and restricted records", async () => {
    // What the worker writes when the stage has run.
    await app.db.query("insert into workflow.job_run (id, project_id, application_id, parent_id, kind, name, status, agent) values ('step-2', 'billing', 'web', $1, 'agent', 'legacy-analyst', 'succeeded', 'legacy-analyst@1.0.0')", [runId]);
    await app.db.query("insert into workflow.artifact (job_run_id, path, sha256, size, provenance) values ($1, 'assessment/web/ASSESSMENT.md', 'abc', 12, '{\"origin\":\"runtime-agent\"}')", [runId]);
    const secret = encryptSecret("| hu** | main.c:1 |");
    await app.db.query("insert into governance.restricted_record (job_run_id, path, ciphertext, iv, auth_tag, size) values ('step-2', 'SECRETS.local.md', $1, $2, $3, 19)", [secret.ciphertext, secret.iv, secret.authTag]);
    await app.db.query("insert into workflow.document_write (id, project_id, kind, message, status, pr_url) values ('w1', 'billing', 'job-output', 'Assess web', 'pr-opened', 'https://github.example.invalid/org/billing-docs/pull/7')");
    await app.db.query("update workflow.job_run set status = 'succeeded', document_write_id = 'w1' where id = $1", [runId]);

    const listed = await admin.get<{ items: RunView[]; total: number }>("/projects/billing/job-runs?applicationId=web");
    expect(listed.body.data).toMatchObject({ total: 1, items: [{ id: runId, status: "succeeded", documentWrite: { id: "w1", status: "pr-opened", prUrl: "https://github.example.invalid/org/billing-docs/pull/7" } }] });

    const detail = (await admin.get<RunView>(`/projects/billing/job-runs/${runId}`)).body.data!;
    expect(detail.steps?.map((step) => [step.name, step.status, step.restrictedRecords])).toEqual([["legacy-analyst", "succeeded", 1]]);
    expect(detail.artifacts).toEqual([{ path: "assessment/web/ASSESSMENT.md", sha256: "abc", size: 12, provenance: { origin: "runtime-agent" } }]);
    expect(JSON.stringify(detail)).not.toContain("hu**");
    expect((await admin.get("/projects/billing/job-runs/missing")).status).toBe(404);

    // With assess succeeded, understand still needs map; map can start; harden needs nothing first.
    const understand = await admin.request("POST", "/projects/billing/applications/web/stages/understand/run");
    expect(understand.status).toBe(409);
    expect(understand.body.message).toBe("Run map for web first: understand reads assessment/web/topology.json, which map writes (merge its pull request before running understand)");
    const map = await admin.request<RunView>("POST", "/projects/billing/applications/web/stages/map/run");
    expect(map.status).toBe(202);
    expect(map.body.data).toMatchObject({ kind: "stage", name: "map", status: "queued" });
    await app.db.query("update workflow.job_run set status = 'cancelled' where id = $1", [map.body.data!.id]);
  });

  it("restricted records need restricted.read", async () => {
    const { client } = await memberClient(app, admin, "runner", ["user"]);
    expect((await client.get(`/projects/billing/job-runs/${runId}/restricted`)).status).toBe(403);

    await subRole(admin, "auditor", ["restricted.read"]);
    const auditor = await memberClient(app, admin, "auditor-1", ["user", "auditor"]);
    const records = await auditor.client.get<Array<{ jobRunId: string; path: string; content: string }>>(`/projects/billing/job-runs/${runId}/restricted`);
    expect(records.status).toBe(200);
    expect(records.body.data).toMatchObject([{ jobRunId: "step-2", path: "SECRETS.local.md", content: "| hu** | main.c:1 |" }]);

    // Every read is audited (who, job run, path), never the content; the log needs audit.read.
    expect((await auditor.client.get("/governance/audit")).status).toBe(403);
    const audit = await admin.get<{ items: Array<{ actor: string; action: string; projectId: string; subject: string; detail: { path: string; username?: string } }>; total: number }>(
      "/governance/audit?action=restricted.read",
    );
    expect(audit.status).toBe(200);
    expect(audit.body.data?.items).toMatchObject([{ actor: auditor.id, action: "restricted.read", projectId: "billing", subject: "step-2", detail: { path: "SECRETS.local.md", username: "auditor-1" } }]);
    expect(audit.raw).not.toContain("hu**");
    await expect(app.db.query("delete from governance.audit_event")).rejects.toThrow(/append-only/);
  });

  it("cancels a queued run at once and asks the worker to stop a running one; needs jobs.run", async () => {
    const queued = (await admin.request<RunView>("POST", "/projects/billing/applications/web/stages/assess/run")).body.data!;
    const { client } = await memberClient(app, admin, "watcher", ["user"]);
    expect((await client.request("POST", `/projects/billing/job-runs/${queued.id}/cancel`)).status).toBe(403);

    const cancelled = await admin.request<RunView & { cancelRequestedAt?: string }>("POST", `/projects/billing/job-runs/${queued.id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toMatchObject({ id: queued.id, status: "cancelled" });
    const again = await admin.request("POST", `/projects/billing/job-runs/${queued.id}/cancel`);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ success: false, statusCode: 409 });

    const running = (await admin.request<RunView>("POST", "/projects/billing/applications/web/stages/assess/run")).body.data!;
    await app.db.query("update workflow.job_run set status = 'running' where id = $1", [running.id]);
    const requested = await admin.request<RunView & { cancelRequestedAt?: string }>("POST", `/projects/billing/job-runs/${running.id}/cancel`);
    expect(requested.status).toBe(200);
    expect(requested.body.data?.status).toBe("running");
    expect(requested.body.data?.cancelRequestedAt).toBeDefined();
    const row = await app.db.query<{ cancel_requested_by: string }>("select cancel_requested_by from workflow.job_run where id = $1", [running.id]);
    expect(row.rows[0]?.cancel_requested_by).toBe("admin");

    expect((await admin.request("POST", "/projects/billing/job-runs/step-2/cancel")).status).toBe(400);
    expect((await admin.request("POST", "/projects/billing/job-runs/missing/cancel")).status).toBe(404);
  });

  it("streams a run's live events as Server-Sent Events with the session cookie, and ends when the run has finished", async () => {
    await app.db.query(
      `insert into workflow.job_event (job_run_id, step_run_id, kind, message, data) values
         ($1, null, 'status', 'stage assess started', '{"status":"running"}'),
         ($1, 'step-2', 'tool', 'read src/main.c', '{"tool":"read","decision":"allowed"}'),
         ($1, null, 'status', 'succeeded', '{"status":"succeeded"}')`,
      [runId],
    );
    const { client } = await memberClient(app, admin, "follower", ["user"]);
    const read = async (headers: Record<string, string> = {}, query = ""): Promise<{ status: number; type: string | null; events: Array<{ id?: string; event: string; data: { id?: string; message?: string; status?: string } }> }> => {
      const response = await fetch(`${app.baseUrl}/projects/billing/job-runs/${runId}/events${query}`, { headers: { cookie: client.cookie!, accept: "text/event-stream", ...headers } });
      const text = await response.text();
      const events = text
        .split("\n\n")
        .map((block) => block.split("\n").filter((line) => line !== "" && !line.startsWith(":") && !line.startsWith("retry:")))
        .filter((lines) => lines.length > 0)
        .map((lines) => {
          const field = (name: string): string | undefined => lines.find((line) => line.startsWith(`${name}: `))?.slice(name.length + 2);
          return { ...(field("id") === undefined ? {} : { id: field("id") }), event: field("event")!, data: JSON.parse(field("data")!) as { id?: string; message?: string; status?: string } };
        });
      return { status: response.status, type: response.headers.get("content-type"), events };
    };

    const all = await read();
    expect(all.status).toBe(200);
    expect(all.type).toMatch(/^text\/event-stream/);
    expect(all.events.map((event) => [event.event, event.data.message ?? event.data.status])).toEqual([
      ["job-event", "stage assess started"],
      ["job-event", "read src/main.c"],
      ["job-event", "succeeded"],
      ["status", "succeeded"],
      ["end", "succeeded"],
    ]);
    expect(all.events[1]?.id).toBe(all.events[1]?.data.id);

    // Resume after the first event (EventSource sends Last-Event-ID on reconnect).
    const resumed = await read({ "last-event-id": all.events[0]!.id! });
    expect(resumed.events.filter((event) => event.event === "job-event").map((event) => event.data.message)).toEqual(["read src/main.c", "succeeded"]);

    // Errors before the stream opens keep the envelope; no session, no stream.
    const missing = await fetch(`${app.baseUrl}/projects/billing/job-runs/missing/events`, { headers: { cookie: client.cookie! } });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ success: false, statusCode: 404 });
    expect((await fetch(`${app.baseUrl}/projects/billing/job-runs/${runId}/events`)).status).toBe(401);
  });
});
