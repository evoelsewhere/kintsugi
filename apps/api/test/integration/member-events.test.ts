import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, startTestAppWithDatabase, type TestApp } from "../support/app.js";
import { createTestDatabase, hasDatabase, type TestDatabase } from "../support/database.js";

const projectId = "member-event-shop";
const unitId = "web/core/invoice";
const firstEventId = "00000000-0000-4000-8000-000000000001";
const secondEventId = "00000000-0000-4000-8000-000000000002";
const expiredEventId = "00000000-0000-4000-8000-000000000003";

describe.skipIf(!hasDatabase)("Coding Agent Workflow task event stream (integration)", () => {
  let app: TestApp;
  let db: TestDatabase;
  let token: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = await startTestAppWithDatabase(db);
    const admin = await adminClient(app);
    await db.query("insert into core.role_permission (role_id, permission_code) values ('admin', 'member.read') on conflict do nothing");
    await db.query("insert into admin.project (id, name) values ($1, 'Member event test project')", [projectId]);
    const identity = await admin.get<{ id: string }>("/auth/me");
    await admin.request("PUT", `/admin/project-access/${projectId}/${identity.body.data!.id}`, { body: {} });
    const issued = await admin.request<{ token: string }>("POST", "/auth/member-tokens", {
      body: { name: "event stream test", projectIds: [projectId], expiresAt: new Date(Date.now() + 60_000).toISOString() },
    });
    expect(issued.status).toBe(201);
    token = issued.body.data!.token;

    for (const [transitionKey, eventId, sequence, kind, createdAt] of [
      ["event-transition-one", firstEventId, 1, "task.started", "now()"],
      ["event-transition-two", secondEventId, 2, "gate.effective", "now()"],
      ["event-transition-expired", expiredEventId, 3, "task.updated", "now() - interval '8 days'"],
    ] as const) {
      await db.query(
        "insert into workflow.member_transition (transition_key, project_id, unit_id, input_hash) values ($1, $2, $3, $4)",
        [transitionKey, projectId, unitId, "a".repeat(64)],
      );
      await db.query(
        `insert into workflow.member_event (id, project_id, sequence, transition_key, unit_id, kind, metadata, created_at)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, ${createdAt})`,
        [eventId, projectId, sequence, transitionKey, unitId, kind, JSON.stringify({ sequence })],
      );
    }
    await db.query("insert into workflow.member_event_cursor (project_id, last_sequence) values ($1, 3)", [projectId]);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  it("resumes from Last-Event-ID and emits bounded SDK events with the matching SSE id", async () => {
    const response = await fetch(`${app.baseUrl}/member/v1/task-events?${new URLSearchParams({
      projectId,
      unitId,
      afterEventId: secondEventId,
      limit: "1",
    })}`, {
      headers: { authorization: `Bearer ${token}`, "last-event-id": firstEventId },
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain(`id: ${secondEventId}\nevent: task-event\ndata: {"schemaVersion":"1","projectId":"${projectId}","unitId":"${unitId}","id":"${secondEventId}"`);
  });

  it("returns a normal 409 envelope before streaming when the replay cursor expired", async () => {
    const response = await fetch(`${app.baseUrl}/member/v1/task-events?${new URLSearchParams({ projectId, unitId })}`, {
      headers: { authorization: `Bearer ${token}`, "last-event-id": expiredEventId },
    });
    const body = await response.json() as { success: boolean; statusCode: number; message: string };

    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).not.toContain("text/event-stream");
    expect(body).toMatchObject({ success: false, statusCode: 409 });
    expect(body.message).toContain("cursor is no longer available");
  });
});
