// Local, model-free integration smoke. Build the workspace before running.
// Requires KINTSUGI_TEST_DATABASE_URL on a loopback Postgres server; creates its own DB.
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiRequire = createRequire(join(repoRoot, "apps/api/package.json"));
const { Pool, Client } = apiRequire("pg");
const compiled = (path) => import(pathToFileURL(join(repoRoot, path)).href);

async function child(kind) {
  let close;
  if (kind === "api") {
    apiRequire("reflect-metadata");
    const { NestFactory } = apiRequire("@nestjs/core");
    const { StandardSchemaValidationPipe } = apiRequire("@nestjs/common");
    const { AppModule } = await compiled("apps/api/dist/app.module.js");
    const { ensureSchema, closePool } = await compiled("apps/api/dist/common/db/pool.js");
    const { HttpExceptionFilter } = await compiled("apps/api/dist/common/filters/http-exception.filter.js");
    const { ResponseInterceptor } = await compiled("apps/api/dist/common/interface/response.js");
    const app = await NestFactory.create(AppModule, { logger: false });
    await ensureSchema();
    app.setGlobalPrefix("api");
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalPipes(new StandardSchemaValidationPipe());
    await app.listen(0, "127.0.0.1");
    close = async () => { await app.close(); await closePool(); };
    process.send({ type: "ready", port: app.getHttpServer().address().port });
  } else {
    const { CheckoutStorage } = await compiled("packages/git/dist/index.js");
    const { startWorker } = await compiled("services/orchestrator/dist/worker.js");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    const worker = await startWorker({
      databaseUrl: process.env.DATABASE_URL, pool,
      storage: new CheckoutStorage(process.env.KINTSUGI_DATA_DIR),
      pollIntervalSeconds: 3600, pendingScanSeconds: 1, heartbeatSeconds: 1,
      outboxScanSeconds: 0.2, log: () => undefined,
    });
    process.on("message", (message) => {
      if (message.type === "sync") void worker.requestSync(message.repositoryId).catch(() => process.exit(1));
    });
    close = async () => { await worker.stop(); await pool.end(); };
    process.send({ type: "ready" });
  }
  process.on("message", async (message) => {
    if (message.type === "shutdown") { await close(); process.exit(0); }
  });
}

async function start(kind, env, processes) {
  const processHandle = fork(fileURLToPath(import.meta.url), [kind], {
    cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  processes.push(processHandle);
  let diagnostics = "";
  for (const stream of [processHandle.stdout, processHandle.stderr]) {
    stream.on("data", (chunk) => { diagnostics = (diagnostics + chunk).slice(-4000); });
  }
  return await new Promise((accept, reject) => {
    const timer = setTimeout(() => reject(new Error(`${kind} startup timed out`)), 45_000);
    processHandle.once("message", (message) => { clearTimeout(timer); accept({ processHandle, ...message }); });
    processHandle.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`${kind} exited before ready (${code}): ${diagnostics}`));
    });
    processHandle.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

async function eventually(check, label) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(200);
  }
  throw new Error(`${label} timed out`);
}

async function smoke() {
  const raw = process.env.KINTSUGI_TEST_DATABASE_URL;
  assert(raw, "KINTSUGI_TEST_DATABASE_URL is required; no .env fallback");
  const server = new URL(raw);
  assert(["localhost", "127.0.0.1", "[::1]", "::1"].includes(server.hostname), "Smoke requires a loopback Postgres server");
  const name = `kintsugi_smoke_test_${randomBytes(6).toString("hex")}`;
  assert(/^kintsugi_smoke_test_[a-f0-9]{12}$/.test(name));
  server.pathname = "/postgres";
  const maintenance = new Client({ connectionString: server.toString() });
  const processes = [];
  let pool, remote, dataDir, created = false;
  let passed = false;
  let forcedStop = false;
  try {
    await maintenance.connect();
    await maintenance.query(`create database ${name}`);
    created = true;
    server.pathname = `/${name}`;
    pool = new Pool({ connectionString: server.toString(), max: 2 });
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-context-smoke-"));
    const password = randomBytes(20).toString("hex");
    const env = { ...process.env, DATABASE_URL: server.toString(), KINTSUGI_DATA_DIR: dataDir,
      KINTSUGI_SECRET_KEY: randomBytes(32).toString("base64"),
      KINTSUGI_BOOTSTRAP_ADMIN_USER: "smoke-admin", KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD: password };
    const api = await start("api", env, processes);
    const base = `http://127.0.0.1:${api.port}/api`;
    let cookie;
    async function request(method, path, body, token) {
      const headers = { "x-kintsugi-csrf": "1" };
      if (body !== undefined) headers["content-type"] = "application/json";
      if (token !== undefined) headers.authorization = `Bearer ${token}`;
      else if (cookie !== undefined) headers.cookie = cookie;
      const response = await fetch(base + path, { method, headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45_000) });
      const session = response.headers.getSetCookie().find((value) => value.startsWith("kintsugi_session="));
      if (session !== undefined) cookie = session.split(";")[0];
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : undefined };
    }
    assert.equal((await request("GET", "/health")).status, 200);
    assert.equal((await request("POST", "/auth/login", { username: "smoke-admin", password })).status, 200);
    const me = (await request("GET", "/auth/me")).body.data;
    const { startGitHttpServer } = await compiled("packages/git/dist/testing.js");
    remote = await startGitHttpServer();
    await remote.createRepository("docs");
    await remote.commit("docs", "applications/billing/units/core/invoice/unit.md", [
      "---", "id: billing/core/invoice", "application: billing", "module: core", "kind: module",
      "title: Smoke invoice", "phase: migrate", "status: pending", "assignee: smoke-admin",
      "requiredDeliverables:", "  - id: code", "    repositoryId: billing-api", "    path: src/invoice",
      "  - id: design", "    repositoryId: smoke-docs", "    path: applications/billing/units/core/invoice/design.md",
      "---", "Smoke unit.", "",
    ].join("\n"));
    await remote.commit("docs", "applications/billing/units/core/invoice/task.md", "# Task\n\n## Objective\nSmoke invoice processing.\n\n## Acceptance criteria\n- Preserve rounding.\n");
    const sourcePath = "applications/billing/units/core/invoice/as-is.md";
    const commitA = await remote.commit("docs", sourcePath, "# Evidence\nSmoke invoice evidence revision A.\n");
    await pool.query("insert into admin.git_server(id,kind,name,base_url,auth_type) values('local','plain-git','Smoke',$1,'none')", [remote.baseUrl]);
    await pool.query("insert into admin.git_repository(id,server_id,url,default_branch) values('smoke-docs','local',$1,'main')", [remote.baseUrl + "/docs.git"]);
    assert.equal((await request("POST", "/admin/projects", { id: "smoke", name: "Smoke", documentRepositoryId: "smoke-docs" })).status, 201);
    assert.equal((await request("POST", "/admin/projects/smoke/applications", { id: "billing", name: "Billing", disposition: "refactor" })).status, 201);
    assert.equal((await request("PUT", `/admin/project-access/smoke/${me.id}`, {})).status, 204);
    const issued = await request("POST", "/auth/member-tokens", { name: "Smoke", projectIds: ["smoke"], expiresAt: new Date(Date.now() + 300_000).toISOString() });
    assert.equal(issued.status, 201);
    const token = issued.body.data.token;
    const worker = await start("worker", env, processes);
    await eventually(async () => (await pool.query("select last_commit from admin.git_repository where id='smoke-docs'")).rows[0]?.last_commit === commitA, "worker Git sync");
    const selector = (path, query) => path + "?" + new URLSearchParams(query);
    assert.equal((await request("GET", "/member/v1/projects", undefined, token)).body.data.items.length, 1);
    const tasks = await request("GET", selector("/member/v1/tasks", { projectId: "smoke", mine: "true" }), undefined, token);
    assert.equal(tasks.status, 200);
    assert.equal(tasks.body.data.items[0].unitId, "billing/core/invoice");
    const query = { projectId: "smoke", unitId: "billing/core/invoice", activity: "design" };
    const briefResponse = await request("GET", selector("/member/v1/task-brief", query), undefined, token);
    assert.equal(briefResponse.status, 200);
    const brief = briefResponse.body.data;
    assert.deepEqual(brief.requiredDeliverableIds, ["code", "design"]);
    assert.equal(brief.documentRepoCommit, commitA);
    assert.equal(brief.readiness.byActivity.implementation.ready, false);
    const source = brief.sources.find((item) => item.role === "as-is-specification");
    assert(source, "AS-IS source must be registered");
    const documentQuery = { projectId: "smoke", unitId: query.unitId, snapshotId: brief.snapshotId, sourceId: source.sourceId };
    const doc = await request("GET", selector("/member/v1/documents", documentQuery), undefined, token);
    assert.equal(doc.status, 200);
    assert.match(doc.body.data.text, /revision A/);
    const search = await request("GET", selector("/member/v1/search", { ...documentQuery, query: "invoice" }), undefined, token);
    // Search has no source selector; strict schemas must reject unrelated selectors.
    assert.equal(search.status, 400);
    const searchQuery = { projectId: "smoke", unitId: query.unitId, snapshotId: brief.snapshotId, query: "invoice" };
    assert((await request("GET", selector("/member/v1/search", searchQuery), undefined, token)).body.data.items.length > 0);
    const commitB = await remote.commit("docs", sourcePath, "# Evidence\nSmoke invoice evidence revision B.\n");
    worker.processHandle.send({ type: "sync", repositoryId: "smoke-docs" });
    await eventually(async () => (await pool.query("select last_commit from admin.git_repository where id='smoke-docs'")).rows[0]?.last_commit === commitB, "worker Git advance");
    assert.match((await request("GET", selector("/member/v1/documents", documentQuery), undefined, token)).body.data.text, /revision A/);
    const oldBrief = await request("GET", selector("/member/v1/task-brief", { ...query, snapshotId: brief.snapshotId }), undefined, token);
    assert.equal(oldBrief.status, 200);
    assert.equal(oldBrief.body.data.freshness.isCurrent, false);
    const { CheckoutStorage, resolveCommit } = await compiled("packages/git/dist/index.js");
    const { snapshotPinRef } = await compiled("services/orchestrator/dist/git-sync/retention.js");
    assert.equal(await resolveCommit(new CheckoutStorage(dataDir).mirror("local", "smoke-docs"), snapshotPinRef(brief.snapshotId, "smoke-docs")), commitA);
    assert.equal((await request("GET", "/auth/me", undefined, token)).status, 403);
    assert.equal((await request("POST", "/admin/projects", { id: "forbidden", name: "Forbidden" }, token)).status, 403);
    assert.equal((await request("GET", selector("/member/v1/reviews/review-smoke", { projectId: "smoke" }), undefined, token)).status, 501);
    assert.equal((await request("DELETE", `/admin/project-access/smoke/${me.id}`)).status, 204);
    assert.equal((await request("GET", selector("/member/v1/documents", documentQuery), undefined, token)).status, 403);
    passed = true;
  } finally {
    for (const handle of processes.reverse()) {
      if (handle.exitCode !== null || handle.signalCode !== null) continue;
      handle.send({ type: "shutdown" });
      await Promise.race([new Promise((done) => handle.once("exit", done)), delay(5000)]);
      if (handle.exitCode === null) { forcedStop = true; handle.kill(); await new Promise((done) => handle.once("exit", done)); }
    }
    await remote?.close();
    await pool?.end();
    if (created) await maintenance.query(`drop database ${name} with (force)`);
    await maintenance.end();
    if (dataDir !== undefined) {
      const cleanupTarget = resolve(dataDir);
      assert.equal(dirname(cleanupTarget), resolve(tmpdir()), "Smoke cleanup must stay inside the temporary directory");
      assert(basename(cleanupTarget).startsWith("kintsugi-context-smoke-"));
      await rm(cleanupTarget, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
  assert.equal(forcedStop, false, "Smoke children must shut down gracefully without a forced kill");
  if (passed) console.log("PASS: compiled API + worker, migrations, Git sync A/B, scoped token, task/deliverables, pinned brief/document/search, stale freshness, legacy/write denial, unavailable review, live access revocation, graceful shutdown");
}

try {
  if (["api", "worker"].includes(process.argv[2])) await child(process.argv[2]);
  else await smoke();
} catch (error) {
  console.error(error instanceof Error ? error.stack : "Smoke failed");
  process.exitCode = 1;
}
