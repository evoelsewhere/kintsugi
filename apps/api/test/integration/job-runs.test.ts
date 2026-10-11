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
  });

  it("restricted records need restricted.read", async () => {
    const { client } = await memberClient(app, admin, "runner", ["user"]);
    expect((await client.get(`/projects/billing/job-runs/${runId}/restricted`)).status).toBe(403);

    await subRole(admin, "auditor", ["restricted.read"]);
    const auditor = await memberClient(app, admin, "auditor-1", ["user", "auditor"]);
    const records = await auditor.client.get<Array<{ jobRunId: string; path: string; content: string }>>(`/projects/billing/job-runs/${runId}/restricted`);
    expect(records.status).toBe(200);
    expect(records.body.data).toMatchObject([{ jobRunId: "step-2", path: "SECRETS.local.md", content: "| hu** | main.c:1 |" }]);
  });
});
