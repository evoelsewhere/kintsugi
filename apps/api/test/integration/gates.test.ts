// Persisted gates: request (gates.request), list with filters, decide once with a note
// (gates.decide), history of one gate key, audit entries for requests and decisions.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { Client, adminClient, memberClient, startTestApp, subRole, type TestApp } from "../support/app.js";

interface Gate {
  id: string;
  projectId: string;
  applicationId?: string;
  gateKey: string;
  title: string;
  status: string;
  subject?: string;
  requestedBy: string;
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
}

interface Page<T> {
  items: T[];
  total: number;
}

describe.skipIf(!hasDatabase)("gates (integration)", () => {
  let app: TestApp;
  let admin: Client;

  beforeAll(async () => {
    app = await startTestApp();
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('github', 'github', 'GitHub', 'https://github.example.invalid', 'none')");
    await app.db.query("insert into admin.git_repository (id, server_id, url, sync_status) values ('alpha-docs', 'github', 'https://github.example.invalid/org/alpha-docs.git', 'ready')");
    expect((await admin.request("POST", "/admin/projects", { body: { id: "alpha", name: "Alpha", documentRepositoryId: "alpha-docs" } })).status).toBe(201);
    expect((await admin.request("POST", "/admin/projects/alpha/applications", { body: { id: "web", name: "Web" } })).status).toBe(201);
  });
  afterAll(async () => {
    await app?.close();
  });

  it("requests a gate once, then decides it with a note", async () => {
    const created = await admin.request<Gate>("POST", "/governance/gates", { body: { projectId: "alpha", applicationId: "web", gateKey: "stage:assess", title: "Review the assessment", subject: "run-1" } });
    expect(created.status).toBe(201);
    const gate = created.body.data!;
    expect(gate).toMatchObject({ projectId: "alpha", applicationId: "web", gateKey: "stage:assess", status: "pending", subject: "run-1", requestedBy: "admin" });

    const again = await admin.request("POST", "/governance/gates", { body: { projectId: "alpha", applicationId: "web", gateKey: "stage:assess", title: "Again", subject: "run-1" } });
    expect(again.status).toBe(409);

    expect((await admin.request("POST", `/governance/gates/${gate.id}/decision`, { body: { decision: "reject" } })).status).toBe(400);
    const decided = await admin.request<Gate>("POST", `/governance/gates/${gate.id}/decision`, { body: { decision: "reject", note: "Missing the risk register" } });
    expect(decided.status).toBe(200);
    expect(decided.body.data).toMatchObject({ status: "rejected", decidedBy: "admin", note: "Missing the risk register" });
    expect((await admin.request("POST", `/governance/gates/${gate.id}/decision`, { body: { decision: "approve" } })).status).toBe(409);

    const retry = (await admin.request<Gate>("POST", "/governance/gates", { body: { projectId: "alpha", applicationId: "web", gateKey: "stage:assess", title: "Review again", subject: "run-1" } })).body.data!;
    const history = await admin.get<Gate[]>(`/governance/gates/${retry.id}/history`);
    expect(history.body.data?.map((entry) => [entry.id, entry.status])).toEqual([
      [retry.id, "pending"],
      [gate.id, "rejected"],
    ]);

    const audit = await admin.get<Page<{ action: string; subject: string; detail: Record<string, unknown> }>>("/governance/audit?action=gate.request,gate.decide");
    expect(audit.body.data?.items.map((entry) => [entry.action, entry.subject])).toEqual([
      ["gate.request", retry.id],
      ["gate.decide", gate.id],
      ["gate.request", gate.id],
    ]);
    expect(audit.body.data?.items[1]?.detail).toMatchObject({ status: "rejected", note: "Missing the risk register" });
  });

  it("validates requests", async () => {
    expect((await admin.request("POST", "/governance/gates", { body: { projectId: "nope", gateKey: "G1", title: "x" } })).status).toBe(404);
    expect((await admin.request("POST", "/governance/gates", { body: { projectId: "alpha", applicationId: "nope", gateKey: "G1", title: "x" } })).status).toBe(404);
    expect((await admin.request("POST", "/governance/gates", { body: { projectId: "alpha", gateKey: "G9", title: "x" } })).status).toBe(400);
    expect((await admin.request("POST", "/governance/gates", { body: { projectId: "alpha", gateKey: "G1", title: "" } })).status).toBe(400);
  });

  it("filters the list by project, application, key and status", async () => {
    await admin.request("POST", "/governance/gates", { body: { projectId: "alpha", gateKey: "G0", title: "Bootstrap" } });
    const pending = (await admin.get<Page<Gate>>("/governance/gates?status=pending")).body.data!;
    expect(pending.items.map((gate) => gate.gateKey).sort()).toEqual(["G0", "stage:assess"]);
    expect((await admin.get<Page<Gate>>("/governance/gates?gateKey=G0")).body.data?.total).toBe(1);
    expect((await admin.get<Page<Gate>>("/governance/gates?applicationId=web&status=rejected")).body.data?.total).toBe(1);
    expect((await admin.get<Page<Gate>>("/governance/gates?projectId=other")).body.data?.total).toBe(0);
    expect((await admin.get("/governance/gates?status=open")).status).toBe(400);
  });

  it("needs gates.request to ask and gates.decide to decide; reading needs a session", async () => {
    await subRole(admin, "gate-requester", ["gates.request"]);
    const { client } = await memberClient(app, admin, "requester", ["user", "gate-requester"]);
    const viewer = (await memberClient(app, admin, "gate-viewer", ["user"])).client;

    expect((await viewer.get("/governance/gates")).status).toBe(200);
    expect((await viewer.request("POST", "/governance/gates", { body: { projectId: "alpha", gateKey: "G2", title: "Architecture" } })).status).toBe(403);

    const gate = (await client.request<Gate>("POST", "/governance/gates", { body: { projectId: "alpha", gateKey: "G2", title: "Architecture" } })).body.data!;
    expect(gate.requestedBy).toBe("requester");
    expect((await client.request("POST", `/governance/gates/${gate.id}/decision`, { body: { decision: "approve" } })).status).toBe(403);
    expect((await admin.request<Gate>("POST", `/governance/gates/${gate.id}/decision`, { body: { decision: "waive", note: "Covered by the pilot review" } })).body.data?.status).toBe("waived");
  });
});
