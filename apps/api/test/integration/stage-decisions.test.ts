import { createHash } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { Client, adminClient, memberClient, startTestApp, subRole, type TestApp } from "../support/app.js";
import { seedLegacyMemberToken } from "../support/legacy-member-token.js";

interface StageDecision {
  runId: string;
  stage: string;
  gate: string;
  decisionMode: "required-human" | "default";
  options: string[];
  choice?: string;
  actorId?: string;
  decidedAt?: string;
}

describe.skipIf(!hasDatabase)("procedural stage decisions (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let adminId: string;
  let decider: Client;
  let deciderId: string;
  let viewer: Client;
  let viewerId: string;

  beforeAll(async () => {
    app = await startTestApp();
    admin = await adminClient(app);
    adminId = (await app.db.query<{ id: string }>("select id from core.app_user where username = 'admin'")).rows[0]!.id;
    await subRole(admin, "stage-decision-only", ["workitems.manage"]);
    const decisionUser = await memberClient(app, admin, "stage-decider", ["user", "stage-decision-only"]);
    decider = decisionUser.client;
    deciderId = decisionUser.id;
    const viewerUser = await memberClient(app, admin, "stage-viewer", ["user"]);
    viewer = viewerUser.client;
    viewerId = viewerUser.id;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it("records the session actor, audit and event once; exact replay is safe and conflicting replay is rejected", async () => {
    const { projectId, runId } = await seedOpenDecision(app, "stage-decision-replay", deciderId, adminId);
    await app.db.query("insert into admin.project_access (project_id, user_id, granted_by) values ($1, $2, $3)", [projectId, adminId, adminId]);
    const me = await decider.get<{ id: string; permissions: string[] }>("/auth/me");
    expect(me.body.data?.permissions).toContain("workitems.manage");
    expect(me.body.data?.permissions).not.toContain("gates.decide");

    const first = await submit(decider, runId, "continue");
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({
      runId,
      stage: "rebuild",
      gate: "continue-check",
      decisionMode: "required-human",
      options: ["continue", "stop"],
      choice: "continue",
      actorId: deciderId,
    });

    const replay = await submit(decider, runId, "continue");
    expect(replay.status).toBe(200);
    expect(replay.body.data).toMatchObject({ choice: "continue", actorId: deciderId });

    expect((await submit(decider, runId, "stop")).status).toBe(409);
    expect((await submit(admin, runId, "continue")).status).toBe(409);

    const counts = await app.db.query<{ decisions: number; audits: number; transitions: number; events: number; outbox: number }>(
      `select
         (select count(*)::int from workflow.stage_decision where job_run_id = $1 and selected_choice is not null) as decisions,
         (select count(*)::int from governance.audit_event where subject = $1 and action = 'stage.decision.recorded') as audits,
         (select count(*)::int from workflow.member_transition where transition_key = $2) as transitions,
         (select count(*)::int from workflow.member_event where transition_key = $2) as events,
         (select count(*)::int from workflow.outbox where transition_key = $2) as outbox`,
      [runId, transitionKey(runId, "rebuild", "continue-check")],
    );
    expect(counts.rows[0]).toEqual({ decisions: 1, audits: 1, transitions: 1, events: 1, outbox: 0 });

    const audit = await app.db.query<{ actor: string; project_id: string; subject: string; detail: Record<string, unknown> }>(
      "select actor, project_id, subject, detail from governance.audit_event where subject = $1 and action = 'stage.decision.recorded'",
      [runId],
    );
    expect(audit.rows[0]).toMatchObject({ actor: deciderId, project_id: projectId, subject: runId, detail: { stage: "rebuild", gate: "continue-check", choice: "continue" } });
    const event = await app.db.query<{ project_id: string; kind: string; metadata: Record<string, unknown> }>(
      "select project_id, kind, metadata from workflow.member_event where transition_key = $1",
      [transitionKey(runId, "rebuild", "continue-check")],
    );
    expect(event.rows[0]).toMatchObject({ project_id: projectId, kind: "stage.decision.recorded", metadata: { runId, stage: "rebuild", gate: "continue-check", choice: "continue", actorId: deciderId } });

    const qualityGate = await admin.request<{ id: string }>("POST", "/governance/gates", {
      body: { projectId, gateKey: "G4", title: "Delivery review", subject: runId },
    });
    expect(qualityGate.status).toBe(201);
    expect((await decider.request("POST", `/governance/gates/${qualityGate.body.data!.id}/decision`, { body: { decision: "approve" } })).status).toBe(403);
    const unchangedGate = await app.db.query<{ status: string }>("select status from governance.gate where id = $1", [qualityGate.body.data!.id]);
    expect(unchangedGate.rows[0]?.status).toBe("pending");
  });

  it("returns not found for a missing/open-row identity and rejects choices outside its options", async () => {
    const { runId } = await seedOpenDecision(app, "stage-decision-validation", deciderId, adminId, false);
    expect((await submit(decider, runId, "continue")).status).toBe(404);

    await insertOpenDecision(app, runId, "rebuild", "continue-check");
    expect((await submit(decider, runId, "maybe")).status).toBe(400);
    const pending = await app.db.query<{ selected_choice: string | null }>("select selected_choice from workflow.stage_decision where job_run_id = $1", [runId]);
    expect(pending.rows[0]?.selected_choice).toBeNull();
  });

  it("derives the project from the run and requires both task permission and exact Project Access", async () => {
    const { runId } = await seedOpenDecision(app, "stage-decision-project-scope", adminId, adminId);
    await app.db.query("insert into admin.project (id, name) values ('stage-decision-granted', 'Granted project')");
    await app.db.query("insert into admin.project_access (project_id, user_id, granted_by) values ('stage-decision-granted', $1, $2)", [deciderId, adminId]);
    expect((await submit(decider, runId, "continue")).status).toBe(403);
    expect((await submit(decider, runId, "continue", { projectId: "stage-decision-granted" })).status).toBe(400);

    const permitted = await seedOpenDecision(app, "stage-decision-permission", viewerId, adminId);
    expect((await submit(viewer, permitted.runId, "continue")).status).toBe(403);
    const unchanged = await app.db.query<{ selected_choice: string | null }>("select selected_choice from workflow.stage_decision where job_run_id = $1", [permitted.runId]);
    expect(unchanged.rows[0]?.selected_choice).toBeNull();
  });

  it("holds the exact Project Access grant through decision commit so a concurrent revoke waits", async () => {
    const { projectId, runId } = await seedOpenDecision(app, "stage-decision-revoke-race", deciderId, adminId);
    const lockClient = new pg.Client({ connectionString: app.db.url });
    await lockClient.connect();
    let lockHeld = false;
    let functionCreated = false;
    let triggerCreated = false;
    let request: ReturnType<typeof submit> | undefined;
    let revoke: Promise<unknown> | undefined;
    try {
      await lockClient.query("select pg_advisory_lock(314159, 265358)");
      lockHeld = true;
      await app.db.query(`
        create function workflow.wait_for_stage_decision_event() returns trigger language plpgsql as $$
        begin
          if new.kind = 'stage.decision.recorded' then
            perform pg_advisory_xact_lock(314159, 265358);
          end if;
          return new;
        end;
        $$`);
      functionCreated = true;
      await app.db.query("create trigger wait_for_stage_decision_event before insert on workflow.member_event for each row execute function workflow.wait_for_stage_decision_event()");
      triggerCreated = true;

      request = submit(decider, runId, "continue");
      expect(await waitForDatabaseLock(app, "insert into workflow.member_event")).toBe(true);
      revoke = app.db.query("delete from admin.project_access where project_id = $1 and user_id = $2", [projectId, deciderId]);
      expect(await waitForDatabaseLock(app, "delete from admin.project_access")).toBe(true);

      await lockClient.query("select pg_advisory_unlock(314159, 265358)");
      lockHeld = false;
      expect((await request).status).toBe(200);
      await expect(revoke).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      if (lockHeld) await lockClient.query("select pg_advisory_unlock(314159, 265358)").catch(() => undefined);
      await request?.catch(() => undefined);
      await revoke?.catch(() => undefined);
      if (triggerCreated) await app.db.query("drop trigger wait_for_stage_decision_event on workflow.member_event");
      if (functionCreated) await app.db.query("drop function workflow.wait_for_stage_decision_event()");
      await lockClient.end();
    }
  });

  it("rejects read-only member bearer tokens on the session-authorized decision route", async () => {
    const { projectId, runId } = await seedOpenDecision(app, "stage-decision-bearer", adminId, adminId);
    const issued = await seedLegacyMemberToken(app, {
      userId: adminId,
      name: "stage decision read token",
      projectIds: [projectId],
    });
    const response = await new Client(app).request("POST", `/governance/stage-decisions/${runId}/rebuild/continue-check`, {
      body: { choice: "continue" },
      csrf: false,
      headers: { authorization: `Bearer ${issued.token}` },
    });
    expect(response.status).toBe(403);
  });

  it("rolls back the choice, audit and transition when durable event insertion fails", async () => {
    const { projectId, runId } = await seedOpenDecision(app, "stage-decision-rollback", deciderId, adminId);
    await app.db.query(`
      create function workflow.fail_stage_decision_event() returns trigger language plpgsql as $$
      begin
        if new.kind = 'stage.decision.recorded' and new.project_id = '${projectId}' then
          raise exception 'forced stage decision event failure';
        end if;
        return new;
      end;
      $$`);
    await app.db.query(`create trigger fail_stage_decision_event before insert on workflow.member_event for each row execute function workflow.fail_stage_decision_event()`);
    try {
      expect((await submit(decider, runId, "continue")).status).toBe(500);
      const counts = await app.db.query<{ selected_choice: string | null; audits: number; transitions: number; events: number }>(
        `select d.selected_choice,
           (select count(*)::int from governance.audit_event where subject = $1 and action = 'stage.decision.recorded') as audits,
           (select count(*)::int from workflow.member_transition where transition_key = $2) as transitions,
           (select count(*)::int from workflow.member_event where transition_key = $2) as events
         from workflow.stage_decision d where d.job_run_id = $1`,
        [runId, transitionKey(runId, "rebuild", "continue-check")],
      );
      expect(counts.rows[0]).toEqual({ selected_choice: null, audits: 0, transitions: 0, events: 0 });
    } finally {
      await app.db.query("drop trigger fail_stage_decision_event on workflow.member_event");
      await app.db.query("drop function workflow.fail_stage_decision_event()");
    }
  });
});

async function seedOpenDecision(
  app: TestApp,
  suffix: string,
  accessUserId: string,
  adminId: string,
  includeDecision = true,
): Promise<{ projectId: string; runId: string }> {
  const projectId = suffix;
  const runId = `${suffix}-run`;
  await app.db.query("insert into admin.project (id, name) values ($1, $1)", [projectId]);
  await app.db.query("insert into admin.project_access (project_id, user_id, granted_by) values ($1, $2, $3)", [projectId, accessUserId, adminId]);
  await app.db.query("insert into workflow.job_run (id, project_id, kind, name, status) values ($1, $2, 'stage', 'rebuild', 'running')", [runId, projectId]);
  if (includeDecision) await insertOpenDecision(app, runId, "rebuild", "continue-check");
  return { projectId, runId };
}

async function insertOpenDecision(app: TestApp, runId: string, stage: string, gate: string): Promise<void> {
  await app.db.query(
    "insert into workflow.stage_decision (job_run_id, stage_id, gate_id, decision_mode, allowed_options) values ($1, $2, $3, 'required-human', '[\"continue\",\"stop\"]'::jsonb)",
    [runId, stage, gate],
  );
}

function submit(client: Client, runId: string, choice: string, extra: Record<string, unknown> = {}) {
  return client.request<StageDecision>("POST", `/governance/stage-decisions/${runId}/rebuild/continue-check`, { body: { choice, ...extra } });
}

function transitionKey(runId: string, stage: string, gate: string): string {
  return "stage-decision:" + createHash("sha256").update(JSON.stringify([runId, stage, gate])).digest("hex");
}

async function waitForDatabaseLock(app: TestApp, queryPrefix: string): Promise<boolean> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const result = await app.db.query<{ waiting: boolean }>(
      "select exists (select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like $1) as waiting",
      [queryPrefix + "%"],
    );
    if (result.rows[0]?.waiting === true) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}
