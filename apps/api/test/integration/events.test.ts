// Live updates (migration 026): the change stream tells a signed-in portal which topic changed, and a run's own
// stream wakes up when an event is written instead of looking on a timer. Needs a session; carries no data.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { SSE_DEFAULTS } from "#common/interface/sse.js";
import { type Client, adminClient, memberClient, startTestApp, type TestApp } from "../support/app.js";

/** Reads an SSE response until `done` is satisfied by the text so far, or fails after `timeoutMs`. */
async function readUntil(url: string, cookie: string, done: (text: string) => boolean, timeoutMs: number, onOpen?: () => Promise<void>): Promise<string> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const response = await fetch(url, { headers: { cookie, accept: "text/event-stream" }, signal: abort.signal });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let opened = false;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value);
      if (!opened) {
        opened = true;
        void onOpen?.();
      }
      if (done(text)) break;
    }
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
  return text;
}

describe.skipIf(!hasDatabase)("live updates (integration)", () => {
  let app: TestApp;
  let admin: Client;

  beforeAll(async () => {
    app = await startTestApp();
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('github', 'github', 'GitHub', 'https://github.example.invalid', 'none')");
    for (const id of ["billing-docs", "billing-legacy"]) {
      await app.db.query("insert into admin.git_repository (id, server_id, url) values ($1, 'github', $2)", [id, `https://github.example.invalid/org/${id}.git`]);
    }
    expect((await admin.request("POST", "/admin/projects", { body: { id: "billing", name: "Billing", documentRepositoryId: "billing-docs" } })).status).toBe(201);
    expect((await admin.request("POST", "/admin/projects/billing/applications", { body: { id: "web", name: "web" } })).status).toBe(201);
    expect((await admin.request("POST", "/admin/projects/billing/applications/web/repositories", { body: { repositoryId: "billing-legacy", role: "legacy" } })).status).toBe(201);
  });
  afterAll(async () => {
    await app?.close();
  });

  it("ends an open stream within a heartbeat when its member is disabled or signs out; a valid session keeps it", async () => {
    const heartbeat = SSE_DEFAULTS.heartbeatMs;
    SSE_DEFAULTS.heartbeatMs = 150;
    try {
      const kept = await readUntil(`${app.baseUrl}/events`, admin.cookie!, (text) => text.split(": keep-alive").length > 4, 5000);
      expect(kept).toContain("event: ready");

      const disabled = await memberClient(app, admin, "sse-disabled", ["user"]);
      const ended = await readUntil(`${app.baseUrl}/events`, disabled.client.cookie!, () => false, 5000, async () => {
        expect((await admin.request("PATCH", `/admin/users/${disabled.id}`, { body: { enabled: false } })).status).toBe(200);
      });
      expect(ended).toContain("event: ready");

      const leaving = await memberClient(app, admin, "sse-leaving", ["user"]);
      const cookie = leaving.client.cookie!;
      await readUntil(`${app.baseUrl}/events`, cookie, () => false, 5000, async () => {
        expect((await leaving.client.request("POST", "/auth/logout")).status).toBe(204);
      });
    } finally {
      SSE_DEFAULTS.heartbeatMs = heartbeat;
    }
  });

  it("needs a session", async () => {
    expect((await fetch(`${app.baseUrl}/events`)).status).toBe(401);
  });

  it("says which topic changed, with the project it belongs to and no row content", async () => {
    const text = await readUntil(
      `${app.baseUrl}/events`,
      admin.cookie!,
      (so) => so.includes("event: change") && so.includes("job-runs"),
      5000,
      async () => {
        await admin.request("POST", "/projects/billing/applications/web/stages/assess/run");
      },
    );
    expect(text).toContain("event: ready");
    const changes = text
      .split("\n\n")
      .filter((block) => block.includes("event: change"))
      .flatMap((block) => (JSON.parse(block.split("\n").find((line) => line.startsWith("data: "))!.slice(6)) as { changes: Array<{ topic: string; scope: string }> }).changes);
    expect(changes).toContainEqual({ topic: "job-runs", scope: "billing" });
    expect(changes.every((change) => !("message" in change))).toBe(true);
    // A log line is not a topic of this stream: a run's own stream carries those.
    expect(changes.some((change) => change.topic === "job-events")).toBe(false);
  });

  it("wakes a followed run when an event is written, without waiting for a timer", async () => {
    const run = (await admin.get<Array<{ id: string }>>("/projects/billing/job-runs")).body.data as unknown as { items: Array<{ id: string }> } | Array<{ id: string }>;
    const runId = (Array.isArray(run) ? run : run.items)[0]!.id;
    const started = Date.now();
    const text = await readUntil(
      `${app.baseUrl}/projects/billing/job-runs/${runId}/events`,
      admin.cookie!,
      (so) => so.includes("wake-me"),
      10_000,
      async () => {
        // The follower has read once and is waiting by now.
        await new Promise((resolve) => setTimeout(resolve, 500));
        await app.db.query("insert into workflow.job_event (job_run_id, kind, message) values ($1, 'log', 'wake-me')", [runId]);
      },
    );
    expect(text).toContain("wake-me");
    // The old loop looked once a second; a push arrives within a fraction of that.
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
