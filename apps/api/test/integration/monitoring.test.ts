// Cross-project reads for the portal's overview pages: the monitoring overview (counts, what
// needs attention, recent activity, the worker's queues), the repository sync view, job runs and
// document writes across projects, the restricted record list (metadata only, restricted.read)
// and the pipeline stages. Rows the worker would write are inserted directly.

import { encryptSecret } from "@kintsugi/secrets";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { Client, adminClient, memberClient, startTestApp, type TestApp } from "../support/app.js";

interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

interface Overview {
  generatedAt: string;
  counts: Record<string, number>;
  attention: Array<{
    kind: string;
    at: string;
    title: string;
    detail?: string;
    projectId?: string;
    applicationId?: string;
    jobRunId?: string;
    documentWriteId?: string;
    repositoryId?: string;
    gateId?: string;
  }>;
  activity: Array<{ kind: string; at: string; status: string; title: string; projectId: string; applicationId?: string; jobRunId?: string; documentWriteId?: string; actor?: string; prUrl?: string; branch?: string }>;
  worker: {
    up: boolean;
    workersUp: number;
    lastSeenAt?: string;
    queues: Array<{ name: string; queued: number; active: number; deferred: number }> | null;
    lastGitSyncAt?: string;
    oldestQueuedRunAt?: string;
  };
}

const SECRET = "| svc-user | hunter2 | config.ini:3 |";

const isNewestFirst = (items: Array<{ at: string }>): boolean => items.every((item, index) => index === 0 || items[index - 1]!.at >= item.at);

describe.skipIf(!hasDatabase)("monitoring and cross-project reads (integration)", () => {
  let app: TestApp;
  let admin: Client;

  beforeAll(async () => {
    app = await startTestApp();
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('github', 'github', 'GitHub', 'https://github.example.invalid', 'none')");
    const repositories: Array<[string, string, string | null]> = [
      ["alpha-docs", "ready", null],
      ["alpha-legacy", "ready", null],
      ["beta-docs", "ready", null],
      ["broken", "error", "authentication failed"],
      ["fresh", "pending", null],
    ];
    for (const [id, status, error] of repositories) {
      await app.db.query(
        `insert into admin.git_repository (id, server_id, url, sync_status, last_error, last_synced_at)
         values ($1, 'github', $2, $3, $4, case when $3 = 'ready' then now() - interval '5 minutes' else null end)`,
        [id, `https://github.example.invalid/org/${id}.git`, status, error],
      );
    }
    expect((await admin.request("POST", "/admin/projects", { body: { id: "alpha", name: "Alpha", documentRepositoryId: "alpha-docs" } })).status).toBe(201);
    expect((await admin.request("POST", "/admin/projects", { body: { id: "beta", name: "Beta", documentRepositoryId: "beta-docs" } })).status).toBe(201);
    expect((await admin.request("POST", "/admin/projects/alpha/applications", { body: { id: "web", name: "Web" } })).status).toBe(201);
    expect((await admin.request("POST", "/admin/projects/alpha/applications/web/repositories", { body: { repositoryId: "alpha-legacy", role: "legacy" } })).status).toBe(201);

    // What the worker records: runs (with a step), document writes and restricted records.
    await app.db.query(
      `insert into workflow.job_run (id, project_id, application_id, parent_id, kind, name, status, failure_reason, actor, started_at, finished_at, created_at) values
         ('r-failed', 'alpha', 'web', null, 'stage', 'assess', 'failed', 'agent timed out', 'admin', now() - interval '2 hours', now() - interval '1 hour', now() - interval '2 hours'),
         ('r-step', 'alpha', 'web', 'r-failed', 'agent', 'legacy-analyst', 'failed', 'timed out', null, now() - interval '2 hours', now() - interval '1 hour', now() - interval '2 hours'),
         ('r-succeeded', 'beta', null, null, 'stage', 'assess', 'succeeded', null, 'admin', now() - interval '40 minutes', now() - interval '30 minutes', now() - interval '40 minutes'),
         ('r-stuck', 'alpha', 'web', null, 'stage', 'assess', 'queued', null, 'admin', null, null, now() - interval '14 minutes 30 seconds'),
         ('r-running', 'alpha', 'web', null, 'stage', 'assess', 'running', null, 'admin', now() - interval '1 minute', null, now() - interval '2 minutes'),
         ('r-old', 'alpha', 'web', null, 'stage', 'assess', 'failed', 'old failure', 'admin', now() - interval '10 days', now() - interval '10 days', now() - interval '10 days')`,
    );
    await app.db.query(
      `insert into workflow.document_write (id, project_id, kind, status, message, error, branch, pr_url, actor, created_at, updated_at) values
         ('w-failed', 'alpha', 'job-output', 'failed', E'Assess web\\n\\nDetails of the run', 'push rejected', null, null, 'kintsugi-bot', now() - interval '50 minutes', now() - interval '5 minutes'),
         ('w-pr', 'beta', 'job-output', 'pr-opened', 'Assess beta', null, 'kintsugi/assess-beta', 'https://github.example.invalid/org/beta-docs/pull/3', 'kintsugi-bot', now() - interval '1 day', now() - interval '20 minutes'),
         ('w-queued', 'alpha', 'manifest', 'queued', 'Publish kintsugi.yaml', null, null, null, 'admin', now() - interval '1 minute', now() - interval '1 minute')`,
    );
    await app.db.query("update workflow.job_run set document_write_id = 'w-failed' where id = 'r-failed'");
    // Gates (one pending, one decided) and worker heartbeats (up, stale, stopped).
    await app.db.query(
      `insert into governance.gate (id, project_id, application_id, gate_key, title, status, requested_by, requested_at, decided_by, decided_at, note) values
         ('g-pending', 'alpha', 'web', 'stage:assess', 'Review the assessment', 'pending', 'kintsugi-worker', now() - interval '90 minutes', null, null, null),
         ('g-approved', 'beta', null, 'G0', 'Bootstrap', 'approved', 'admin', now() - interval '2 days', 'admin', now() - interval '1 day', 'ok')`,
    );
    await app.db.query(
      `insert into workflow.worker_heartbeat (worker_id, host, pid, version, started_at, last_seen_at, stopped_at, active_jobs, queues) values
         ('w-up', 'worker-1', 101, '1.0.0', now() - interval '1 hour', now() - interval '5 seconds', null, 2, '{git-sync,document-write,job-run}'),
         ('w-stale', 'worker-2', 102, '1.0.0', now() - interval '2 hours', now() - interval '10 minutes', null, 1, '{git-sync}'),
         ('w-stopped', 'worker-3', 103, '0.9.0', now() - interval '1 day', now() - interval '20 hours', now() - interval '20 hours', 0, '{git-sync}')`,
    );
    const secret = encryptSecret(SECRET);
    for (const [run, path, at] of [
      ["r-step", "SECRETS.local.md", "now() - interval '1 hour'"],
      ["r-succeeded", "credentials.md", "now() - interval '30 minutes'"],
    ] as const) {
      await app.db.query(`insert into governance.restricted_record (job_run_id, path, ciphertext, iv, auth_tag, size, created_at) values ($1, $2, $3, $4, $5, 34, ${at})`, [
        run,
        path,
        secret.ciphertext,
        secret.iv,
        secret.authTag,
      ]);
    }
  });
  afterAll(async () => {
    await app?.close();
  });

  it("every read needs a session", async () => {
    const anonymous = new Client(app);
    for (const path of ["/monitoring/overview", "/monitoring/portfolio", "/monitoring/workers", "/governance/gates", "/monitoring/repositories", "/job-runs", "/document-writes", "/governance/restricted-records", "/stages"]) {
      expect((await anonymous.get(path)).status, path).toBe(401);
    }
  });

  it("the overview counts top-level runs, writes and repositories", async () => {
    const { client } = await memberClient(app, admin, "viewer", ["user"]);
    const response = await client.get<Overview>("/monitoring/overview");
    expect(response.status).toBe(200);
    const overview = response.body.data!;
    expect(Date.parse(overview.generatedAt)).not.toBeNaN();
    expect(overview.counts).toEqual({
      projects: 2,
      applications: 1,
      activeRuns: 2,
      queuedRuns: 1,
      runningRuns: 1,
      failedRuns24h: 1,
      succeededRuns24h: 1,
      pendingWrites: 1,
      pullRequests7d: 1,
      failedWrites24h: 1,
      repositories: 5,
      repositoriesWithErrors: 1,
      repositoriesNotReady: 1,
      pendingGates: 1,
    });
  });

  it("the overview lists what needs attention and the recent activity, newest first", async () => {
    const overview = (await admin.get<Overview>("/monitoring/overview")).body.data!;
    expect(isNewestFirst(overview.attention)).toBe(true);
    // The repository error was recorded just now (updated_at); the others are minutes to an hour old.
    const kinds = overview.attention.map((item) => item.kind);
    expect(kinds[0]).toBe("repository-error");
    expect([...kinds].sort()).toEqual(["gate-pending", "repository-error", "run-failed", "run-stuck", "write-failed"]);
    expect(overview.attention).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "run-failed", title: "assess failed", detail: "agent timed out", projectId: "alpha", applicationId: "web", jobRunId: "r-failed" }),
        expect.objectContaining({ kind: "run-stuck", title: "assess queued for 14 min", detail: "The worker has not picked it up", projectId: "alpha", jobRunId: "r-stuck" }),
        expect.objectContaining({ kind: "write-failed", title: "Assess web", detail: "push rejected", projectId: "alpha", applicationId: "web", documentWriteId: "w-failed" }),
        expect.objectContaining({ kind: "repository-error", title: "broken", detail: "authentication failed", repositoryId: "broken" }),
        expect.objectContaining({ kind: "gate-pending", title: "stage:assess · Review the assessment", detail: "Requested by kintsugi-worker", projectId: "alpha", applicationId: "web", gateId: "g-pending" }),
      ]),
    );
    expect(overview.attention.some((item) => item.jobRunId === "r-old" || item.jobRunId === "r-step")).toBe(false);

    expect(isNewestFirst(overview.activity)).toBe(true);
    expect(overview.activity.filter((item) => item.kind === "run").map((item) => item.jobRunId)).toEqual(["r-running", "r-stuck", "r-succeeded", "r-failed", "r-old"]);
    expect(overview.activity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "run", jobRunId: "r-running", status: "running", title: "assess · web", projectId: "alpha", applicationId: "web", actor: "admin" }),
        expect.objectContaining({ kind: "run", jobRunId: "r-succeeded", status: "succeeded", title: "assess", projectId: "beta" }),
        expect.objectContaining({
          kind: "write",
          documentWriteId: "w-pr",
          status: "pr-opened",
          title: "Assess beta",
          projectId: "beta",
          prUrl: "https://github.example.invalid/org/beta-docs/pull/3",
          branch: "kintsugi/assess-beta",
          actor: "kintsugi-bot",
        }),
      ]),
    );

    expect(overview.worker.queues?.map((queue) => queue.name)).toEqual(["job-run", "document-write", "git-sync"]);
    expect(overview.worker.lastGitSyncAt).toBeDefined();
    expect(overview.worker.oldestQueuedRunAt).toBeDefined();
    expect(overview.worker).toMatchObject({ up: true, workersUp: 1 });
    expect(overview.worker.lastSeenAt).toBeDefined();
  });

  it("the portfolio overview places each application in the lifecycle and lists what a person must decide", async () => {
    const { client } = await memberClient(app, admin, "portfolio-viewer", ["user"]);
    const response = await client.get<{
      applications: Array<{ projectId: string; applicationId: string; phase: string; gate: { key: string; status: string } | null; assess: unknown; catalog: unknown; blocked?: string }>;
      decisions: Array<{ kind: string; title: string; projectId: string; gateId?: string; prUrl?: string }>;
      funnel: { total: number; counts: Record<string, number> };
      riskiest: unknown[];
    }>("/monitoring/portfolio");
    expect(response.status).toBe(200);
    const portfolio = response.body.data!;
    // alpha/web is runnable but has no successful assess: discover-assess, its G1 not asked for yet.
    expect(portfolio.applications).toEqual([expect.objectContaining({ projectId: "alpha", applicationId: "web", phase: "discover-assess", gate: { key: "G1", status: "not-requested" }, assess: null, catalog: null })]);
    // The pending gate comes before the pull request waiting for review.
    expect(portfolio.decisions.map((decision) => decision.kind)).toEqual(["gate", "pull-request"]);
    expect(portfolio.decisions[0]).toMatchObject({ projectId: "alpha", gateId: "g-pending" });
    expect(portfolio.decisions[1]).toMatchObject({ projectId: "beta", prUrl: "https://github.example.invalid/org/beta-docs/pull/3" });
    expect(portfolio.funnel).toEqual({ total: 0, counts: {} });
    expect(portfolio.riskiest).toEqual([]);
  });

  it("lists workers from their heartbeats with their state", async () => {
    const response = await admin.get<Array<{ workerId: string; host: string; pid: number; version: string; state: string; activeJobs: number; queues: string[]; secondsSinceSeen: number; stoppedAt?: string }>>(
      "/monitoring/workers",
    );
    expect(response.status).toBe(200);
    const workers = response.body.data!;
    expect(workers.map((worker) => [worker.workerId, worker.state])).toEqual([
      ["w-up", "up"],
      ["w-stale", "stale"],
      ["w-stopped", "stopped"],
    ]);
    expect(workers[0]).toMatchObject({ host: "worker-1", pid: 101, version: "1.0.0", activeJobs: 2, queues: ["git-sync", "document-write", "job-run"] });
    expect(workers[0]?.secondsSinceSeen).toBeLessThan(45);
    expect(workers[2]?.stoppedAt).toBeDefined();
  });

  it("reports no worker running once every heartbeat is old", async () => {
    await app.db.query("update workflow.worker_heartbeat set last_seen_at = now() - interval '1 minute' where worker_id = 'w-up'");
    try {
      const overview = (await admin.get<Overview>("/monitoring/overview")).body.data!;
      expect(overview.worker).toMatchObject({ up: false, workersUp: 0 });
      expect(overview.attention[0]).toMatchObject({ kind: "worker-down", title: "No worker is running" });
      expect(overview.attention[0]?.detail).toContain("worker-1");
    } finally {
      await app.db.query("update workflow.worker_heartbeat set last_seen_at = now() where worker_id = 'w-up'");
    }
  });

  it("the repository view shows sync state and project links, never credentials", async () => {
    const response = await admin.get<Array<{ id: string; serverId: string; syncStatus: string; lastError?: string; projects: Array<Record<string, string>> }>>("/monitoring/repositories");
    expect(response.status).toBe(200);
    const repositories = response.body.data!;
    expect(repositories.map((repository) => repository.id)).toEqual(["alpha-docs", "alpha-legacy", "beta-docs", "broken", "fresh"]);
    expect(repositories.find((repository) => repository.id === "alpha-docs")).toMatchObject({ serverId: "github", syncStatus: "ready", projects: [{ projectId: "alpha", role: "document" }] });
    expect(repositories.find((repository) => repository.id === "alpha-legacy")?.projects).toEqual([{ projectId: "alpha", role: "legacy", applicationId: "web" }]);
    expect(repositories.find((repository) => repository.id === "broken")).toMatchObject({ syncStatus: "error", lastError: "authentication failed", projects: [] });
    expect(response.raw).not.toMatch(/secret|ciphertext|password/i);
  });

  it("lists top-level job runs across projects with filters", async () => {
    const all = await admin.get<Page<{ id: string; projectId: string; status: string }>>("/job-runs");
    expect(all.status).toBe(200);
    expect(all.body.data?.items.map((run) => run.id)).toEqual(["r-running", "r-stuck", "r-succeeded", "r-failed", "r-old"]);
    expect(all.body.data?.total).toBe(5);

    const active = (await admin.get<Page<{ id: string }>>("/job-runs?status=queued,running")).body.data!;
    expect(active).toMatchObject({ total: 2, items: [{ id: "r-running" }, { id: "r-stuck" }] });
    expect((await admin.get<Page<{ id: string }>>("/job-runs?projectId=beta")).body.data?.items.map((run) => run.id)).toEqual(["r-succeeded"]);
    expect((await admin.get<Page<{ id: string }>>("/job-runs?status=failed&applicationId=web&limit=1")).body.data).toMatchObject({ total: 2, limit: 1, items: [{ id: "r-failed" }] });

    expect((await admin.get("/job-runs?status=queued,bogus")).status).toBe(400);
    expect((await admin.get("/job-runs?status=")).status).toBe(400);
  });

  it("lists document writes across projects with filters", async () => {
    const all = (await admin.get<Page<{ id: string }>>("/document-writes")).body.data!;
    expect(all).toMatchObject({ total: 3, items: [{ id: "w-queued" }, { id: "w-failed" }, { id: "w-pr" }] });
    const filtered = (await admin.get<Page<{ id: string }>>("/document-writes?status=failed,queued&projectId=alpha")).body.data!;
    expect(filtered.items.map((write) => write.id)).toEqual(["w-queued", "w-failed"]);
    expect((await admin.get<Page<{ id: string }>>("/document-writes?status=pr-opened")).body.data?.items.map((write) => write.id)).toEqual(["w-pr"]);
    expect((await admin.get("/document-writes?status=bogus")).status).toBe(400);
  });

  it("lists restricted records as metadata only, with restricted.read, without auditing", async () => {
    const { client } = await memberClient(app, admin, "no-restricted", ["user"]);
    expect((await client.get("/governance/restricted-records")).status).toBe(403);

    const response = await admin.get<Page<Record<string, unknown>>>("/governance/restricted-records");
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ total: 2 });
    expect(response.body.data?.items).toEqual([
      expect.objectContaining({ jobRunId: "r-succeeded", topLevelRunId: "r-succeeded", projectId: "beta", runName: "assess", path: "credentials.md", size: 34 }),
      expect.objectContaining({ jobRunId: "r-step", topLevelRunId: "r-failed", projectId: "alpha", applicationId: "web", runName: "assess", stepName: "legacy-analyst", path: "SECRETS.local.md", size: 34 }),
    ]);
    expect(response.body.data?.items[0]).not.toHaveProperty("stepName");
    expect(response.body.data?.items[0]).not.toHaveProperty("content");
    expect(response.raw).not.toContain("hunter2");
    expect(response.raw).not.toMatch(/ciphertext|auth_tag/);

    expect((await admin.get<Page<{ jobRunId: string }>>("/governance/restricted-records?jobRunId=r-failed")).body.data?.items.map((record) => record.jobRunId)).toEqual(["r-step"]);
    expect((await admin.get<Page<unknown>>("/governance/restricted-records?projectId=beta")).body.data?.total).toBe(1);

    const audited = await app.db.query<{ count: number }>("select count(*)::int as count from governance.audit_event where action = 'restricted.read'");
    expect(audited.rows[0]?.count).toBe(0);
  });

  it("lists the pipeline stages in order with who runs them", async () => {
    const { client } = await memberClient(app, admin, "stage-reader", ["user"]);
    const response = await client.get<Array<{ id: string; command: string; audience: string; agents: string[]; writes: string[]; gates: string[]; runnable: boolean }>>("/stages");
    expect(response.status).toBe(200);
    const stages = response.body.data!;
    expect(stages).toHaveLength(4);
    expect(stages.map((stage) => stage.id)).toEqual(["assess", "understand", "plan-understand", "design"]);
    expect(stages.find((stage) => stage.id === "design")).toMatchObject({ command: "modernize-design", audience: "runtime", runnable: true, agents: ["designer", "design-reviewer"] });
    expect(stages.filter((stage) => stage.audience === "runtime").map((stage) => stage.id)).toEqual(["assess", "understand", "plan-understand", "design"]);
    expect(stages.find((stage) => stage.id === "assess")).toMatchObject({ command: "modernize-assess", runnable: true, agents: ["legacy-analyst", "security-auditor"] });
    expect(stages.filter((stage) => stage.runnable).map((stage) => stage.id)).toEqual(["assess", "understand", "plan-understand", "design"]);
    expect(stages.find((stage) => stage.id === "plan-understand")).toMatchObject({ command: "modernize-plan-understand", runnable: true, agents: ["understand-planner"] });
    expect(stages.find((stage) => stage.id === "understand")).toMatchObject({ command: "modernize-understand", runnable: true, agents: ["legacy-analyst", "security-auditor", "business-rules-extractor"] });
  });
});
