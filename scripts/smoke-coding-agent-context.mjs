// Local, model-free public-process smoke. Build the workspace before running.
// Requires KINTSUGI_TEST_DATABASE_URL on a loopback Postgres server; creates its own DB.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  attemptPublicProcessCleanup,
  capturePublicProcessClientError,
  createPublicProcessSpec,
  redactPublicProcessDiagnostics,
  resolveSmokeDatabaseConfig,
} from "./e2e/public-process.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiRequire = createRequire(join(repoRoot, "apps/api/package.json"));
const { Pool, Client } = apiRequire("pg");
const pgRequire = createRequire(apiRequire.resolve("pg/package.json"));
const { parseIntoClientConfig } = pgRequire("pg-connection-string");
const compiled = (path) => import(pathToFileURL(join(repoRoot, path)).href);
const diagnosticSecrets = [];

function safeError(error) {
  const value = error instanceof Error ? error.stack ?? error.message : String(error);
  return redactPublicProcessDiagnostics(value, diagnosticSecrets);
}

function isExited(processHandle) {
  return processHandle.exitCode !== null || processHandle.signalCode !== null;
}

function waitForExit(processHandle, timeoutMs) {
  if (isExited(processHandle)) return Promise.resolve(true);
  return new Promise((accept) => {
    let timer;
    const finish = (exited) => {
      clearTimeout(timer);
      processHandle.off("exit", onExit);
      accept(exited);
    };
    const onExit = () => finish(true);
    processHandle.once("exit", onExit);
    timer = setTimeout(() => finish(false), timeoutMs);
    if (isExited(processHandle)) finish(true);
  });
}

function start(kind, options, processes) {
  const spec = createPublicProcessSpec(kind, options);
  const processHandle = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const record = { kind, processHandle, diagnostics: "", startError: undefined };
  processes.push(record);
  for (const stream of [processHandle.stdout, processHandle.stderr]) {
    stream.setEncoding("utf8").on("data", (chunk) => { record.diagnostics = (record.diagnostics + chunk).slice(-8_000); });
  }
  processHandle.once("error", (error) => { record.startError = error; });
  return record;
}

function safeDiagnostics(record) {
  return redactPublicProcessDiagnostics(record.diagnostics, diagnosticSecrets);
}

function ensureRunning(record, label) {
  if (record.startError !== undefined) throw new Error(`${label} failed to start: ${safeError(record.startError)}`);
  if (isExited(record.processHandle)) {
    throw new Error(`${label} exited before ready (${record.processHandle.exitCode ?? record.processHandle.signalCode}): ${safeDiagnostics(record)}`);
  }
}

async function stop(record) {
  if (isExited(record.processHandle)) return { stopped: true, forced: false };

  let signalError;
  try {
    record.processHandle.kill("SIGTERM");
  } catch (error) {
    signalError = error;
  }
  if (await waitForExit(record.processHandle, 15_000)) return { stopped: true, forced: false };

  let forcedError;
  try {
    record.processHandle.kill("SIGKILL");
  } catch (error) {
    forcedError = error;
  }
  const stopped = await waitForExit(record.processHandle, 5_000);
  if (!stopped) {
    const details = [signalError, forcedError].filter(Boolean).map(safeError).join("; ");
    throw new Error(`could not stop ${record.kind} process${details ? `: ${details}` : ""}`);
  }
  return { stopped: true, forced: true };
}

async function reservePort() {
  const server = createServer();
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("could not allocate the API smoke port");
  const { port } = address;
  await new Promise((accept, reject) => server.close((error) => error ? reject(error) : accept()));
  return port;
}

async function eventually(check, label, records = []) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    for (const record of records) ensureRunning(record, label);
    await delay(200);
  }
  throw new Error(`${label} timed out`);
}

async function smoke() {
  const raw = process.env.KINTSUGI_TEST_DATABASE_URL;
  assert(raw, "KINTSUGI_TEST_DATABASE_URL is required; no .env fallback");
  const server = new URL(raw);
  resolveSmokeDatabaseConfig(raw, parseIntoClientConfig, "postgres");
  const name = `kintsugi_smoke_test_${randomBytes(6).toString("hex")}`;
  assert(/^kintsugi_smoke_test_[a-f0-9]{12}$/.test(name));
  server.pathname = "/postgres";
  const maintenance = new Client(resolveSmokeDatabaseConfig(server.toString(), parseIntoClientConfig, "postgres"));
  const assertMaintenanceHealthy = capturePublicProcessClientError(maintenance);
  const processes = [];
  const cleanupErrors = [];
  let pool, poolError, remote, dataDir, created = false;
  let smokeError;
  let passed = false;
  let forcedStop = false;
  let processOptions;
  let apiProcess;
  let workerProcess;

  try {
    await maintenance.connect();
    await maintenance.query(`create database ${name}`);
    created = true;
    server.pathname = `/${name}`;
    const databaseUrl = server.toString();
    pool = new Pool({ ...resolveSmokeDatabaseConfig(databaseUrl, parseIntoClientConfig, name), max: 2 });
    pool.on("error", (error) => { poolError ??= error; });
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-context-smoke-"));
    const password = randomBytes(20).toString("hex");
    const secretKey = randomBytes(32).toString("base64");
    diagnosticSecrets.push(password, secretKey);
    processOptions = {
      repoRoot,
      cwd: dataDir,
      databaseUrl,
      dataDir,
      secretKey,
      adminUser: "smoke-admin",
      adminPassword: password,
      port: await reservePort(),
    };
    const base = `http://127.0.0.1:${processOptions.port}/api`;

    async function startApiProcess() {
      apiProcess = start("api", processOptions, processes);
      await eventually(async () => {
        try {
          const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1_000) });
          return response.status === 200;
        } catch {
          return false;
        }
      }, "API public process", [apiProcess]);
    }

    await startApiProcess();
    let cookie;
    async function request(method, path, body, token) {
      const headers = { "x-kintsugi-csrf": "1" };
      if (body !== undefined) headers["content-type"] = "application/json";
      if (token !== undefined) headers.authorization = `Bearer ${token}`;
      else if (cookie !== undefined) headers.cookie = cookie;
      const response = await fetch(base + path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(45_000),
      });
      const session = response.headers.getSetCookie().find((value) => value.startsWith("kintsugi_session="));
      if (session !== undefined) {
        cookie = session.split(";")[0];
        diagnosticSecrets.push(cookie);
      }
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
    diagnosticSecrets.push(token);

    workerProcess = start("worker", processOptions, processes);
    assert(workerProcess.processHandle.pid !== undefined);
    await eventually(async () => {
      const heartbeat = await pool.query("select 1 from workflow.worker_heartbeat where pid = $1 and stopped_at is null", [workerProcess.processHandle.pid]);
      return heartbeat.rows.length > 0;
    }, "worker public process startup", [workerProcess]);
    await eventually(async () => (await pool.query("select last_commit from admin.git_repository where id='smoke-docs'")).rows[0]?.last_commit === commitA,
      "worker Git sync A", [workerProcess]);

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
    assert.equal(search.status, 400, "search must reject a source selector it does not support");
    const searchQuery = { projectId: "smoke", unitId: query.unitId, snapshotId: brief.snapshotId, query: "invoice" };
    assert((await request("GET", selector("/member/v1/search", searchQuery), undefined, token)).body.data.items.length > 0);

    const commitB = await remote.commit("docs", sourcePath, "# Evidence\nSmoke invoice evidence revision B.\n");
    await eventually(async () => (await pool.query("select last_commit from admin.git_repository where id='smoke-docs'")).rows[0]?.last_commit === commitB,
      "worker Git sync B", [workerProcess]);
    const apiStop = await stop(apiProcess);
    forcedStop ||= apiStop.forced;
    assert.equal(apiStop.stopped, true, "API process must stop before the restart check");
    cookie = undefined;
    await startApiProcess();
    assert.equal((await request("POST", "/auth/login", { username: "smoke-admin", password })).status, 200);
    assert.equal((await request("GET", "/auth/me")).status, 200);
    assert.match((await request("GET", selector("/member/v1/documents", documentQuery), undefined, token)).body.data.text, /revision A/);
    const oldBrief = await request("GET", selector("/member/v1/task-brief", { ...query, snapshotId: brief.snapshotId }), undefined, token);
    assert.equal(oldBrief.status, 200);
    assert.equal(oldBrief.body.data.freshness.isCurrent, false);
    const { CheckoutStorage, resolveCommit } = await compiled("packages/git/dist/index.js");
    const { snapshotPinRef } = await compiled("services/orchestrator/dist/git-sync/retention.js");
    assert.equal(await resolveCommit(new CheckoutStorage(dataDir).mirror("local", "smoke-docs"), snapshotPinRef(brief.snapshotId, "smoke-docs")), commitA);
    assert.equal((await request("GET", "/auth/me", undefined, token)).status, 403);
    assert.equal((await request("POST", "/admin/projects", { id: "forbidden", name: "Forbidden" }, token)).status, 403);
    const unknownReview = await request("GET", selector("/member/v1/reviews/review-smoke", { projectId: "smoke" }), undefined, token);
    assert.equal(unknownReview.status, 404);
    assert.equal(unknownReview.body.success, false);
    assert.equal((await request("DELETE", `/admin/project-access/smoke/${me.id}`)).status, 204);
    assert.equal((await request("GET", selector("/member/v1/documents", documentQuery), undefined, token)).status, 403);
    passed = true;
  } catch (error) {
    smokeError = error;
  }

  const cleanupSteps = [...processes].reverse().map((record) => ({
    label: `stop ${record.kind} process`,
    cleanup: async () => {
      const result = await stop(record);
      forcedStop ||= result.forced;
      if (!result.stopped) throw new Error(`${record.kind} process did not stop`);
    },
  }));
  cleanupSteps.push(
    { label: "close synthetic Git server", cleanup: async () => remote?.close() },
    { label: "close smoke database pool", cleanup: async () => pool?.end() },
    { label: "check smoke database pool", cleanup: async () => { if (poolError !== undefined) throw poolError; } },
  );
  if (created) cleanupSteps.push({ label: "drop generated test database", cleanup: async () => maintenance.query(`drop database ${name} with (force)`) });
  cleanupSteps.push({ label: "close maintenance database client", cleanup: async () => maintenance.end() });
  cleanupSteps.push({ label: "check smoke maintenance database client", cleanup: async () => assertMaintenanceHealthy() });
  if (dataDir !== undefined) {
    cleanupSteps.push({ label: "remove temporary data directory", cleanup: async () => {
      const cleanupTarget = resolve(dataDir);
      assert.equal(dirname(cleanupTarget), resolve(tmpdir()), "Smoke cleanup must stay inside the temporary directory");
      assert(basename(cleanupTarget).startsWith("kintsugi-context-smoke-"));
      await rm(cleanupTarget, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } });
  }
  cleanupErrors.push(...await attemptPublicProcessCleanup(cleanupSteps, diagnosticSecrets));
  if (forcedStop) cleanupErrors.push("one or more smoke child processes required a forced shutdown");

  const failures = [];
  if (smokeError !== undefined) failures.push(`Smoke failed: ${safeError(smokeError)}`);
  failures.push(...cleanupErrors);
  if (failures.length > 0) throw new Error(failures.join("\n"));
  if (passed) console.log("PASS: deployed API + worker entrypoints, migrations, Git sync A/B, API restart, scoped token, task/deliverables, pinned brief/document/search, stale freshness, legacy/write denial, unknown review lookup, live access revocation, process shutdown");
}

try {
  await smoke();
} catch (error) {
  console.error(redactPublicProcessDiagnostics(error instanceof Error ? error.stack ?? error.message : "Smoke failed", diagnosticSecrets));
  process.exitCode = 1;
}
