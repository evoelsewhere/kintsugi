import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { attemptPublicProcessCleanup, createPublicProcessSpec, redactPublicProcessDiagnostics } from "./public-process.mjs";

const options = {
  repoRoot: "D:/kintsugi",
  cwd: "C:/Temp/kintsugi-smoke",
  databaseUrl: "postgresql://smoke:secret@127.0.0.1/kintsugi_test",
  dataDir: "C:/Temp/kintsugi-smoke/data",
  secretKey: "dGVzdC1zZWNyZXQ=",
  adminUser: "smoke-admin",
  adminPassword: "smoke-password",
  port: 43127,
};

test("launches the shipped API and worker entrypoints from an isolated environment", () => {
  const inherited = {
    PATH: "C:/Windows/System32;C:/Program Files/Git/cmd",
    SYSTEMROOT: "C:/Windows",
    TEMP: "C:/Temp",
    TMP: "C:/Temp",
    DATABASE_URL: "postgresql://ambient:ambient-secret@remote.invalid/other",
    KINTSUGI_TEST_DATABASE_URL: "postgresql://runner:runner-secret@127.0.0.1/kintsugi_test",
    GITHUB_TOKEN: "ambient-github-token",
    NODE_OPTIONS: "--require ambient-preload.js",
  };

  const api = createPublicProcessSpec("api", options, inherited, "win32");
  assert.equal(api.command, process.execPath);
  assert.deepEqual(api.args, [resolve(options.repoRoot, "apps/api/dist/main.js")]);
  assert.equal(api.cwd, options.cwd);
  assert.equal(api.env.PATH, inherited.PATH);
  assert.equal(api.env.SYSTEMROOT, inherited.SYSTEMROOT);
  assert.equal(api.env.DATABASE_URL, options.databaseUrl);
  assert.equal(api.env.PORT, String(options.port));
  assert.equal(api.env.KINTSUGI_BOOTSTRAP_ADMIN_USER, options.adminUser);
  assert.equal(api.env.KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD, options.adminPassword);

  const worker = createPublicProcessSpec("worker", options, inherited, "win32");
  assert.deepEqual(worker.args, [resolve(options.repoRoot, "services/orchestrator/dist/main.js")]);
  assert.equal(worker.env.DATABASE_URL, options.databaseUrl);
  assert.equal(worker.env.KINTSUGI_GIT_POLL_INTERVAL, "30");
  assert.equal(worker.env.KINTSUGI_RUNTIME_MODE, "mock");
  assert.equal(worker.env.KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD, undefined);

  for (const spec of [api, worker]) {
    assert.equal(spec.env.KINTSUGI_DATA_DIR, options.dataDir);
    assert.equal(spec.env.KINTSUGI_SECRET_KEY, options.secretKey);
    assert.equal(spec.env.KINTSUGI_TEST_DATABASE_URL, undefined);
    assert.equal(spec.env.GITHUB_TOKEN, undefined);
    assert.equal(spec.env.NODE_OPTIONS, undefined);
    assert.equal(spec.env.KINTSUGI_PUBLIC_URL, undefined);
  }
});

test("preserves the Git executable path without inheriting user configuration or credentials", () => {
  const inherited = {
    PATH: "/usr/local/bin:/usr/bin",
    HOME: "/home/smoke",
    GITHUB_TOKEN: "ambient-github-token",
    AWS_ACCESS_KEY_ID: "ambient-aws-key",
    GH_TOKEN: "ambient-gh-token",
  };
  const spec = createPublicProcessSpec("worker", options, inherited, "linux");
  assert.equal(spec.env.PATH, inherited.PATH);
  assert.equal(spec.env.HOME, undefined);
  assert.equal(spec.env.GITHUB_TOKEN, undefined);
  assert.equal(spec.env.AWS_ACCESS_KEY_ID, undefined);
  assert.equal(spec.env.GH_TOKEN, undefined);
});

test("rejects unknown processes and incomplete isolated startup settings", () => {
  assert.throws(() => createPublicProcessSpec("api-module", options), /unsupported public process/);
  assert.throws(() => createPublicProcessSpec("api", { ...options, databaseUrl: "" }), /database URL is required/);
  assert.throws(() => createPublicProcessSpec("worker", { ...options, cwd: "" }), /working directory is required/);
  assert.throws(() => createPublicProcessSpec("api", { ...options, port: undefined }), /valid API port is required/);
});

test("redacts exact diagnostic secrets and unknown PostgreSQL URLs", () => {
  const sessionCookie = "kintsugi_session=session.cookie+secret";
  const memberToken = "kmt_member.token[secret]+value";
  const secrets = [options.adminPassword, options.secretKey, sessionCookie, memberToken, "token.with[regex]+characters"];
  const raw = `password=${options.adminPassword} key=${options.secretKey} cookie=${sessionCookie} bearer=Bearer ${memberToken} token=${secrets[4]} db=${options.databaseUrl} fallback=postgresql://other:other-secret@127.0.0.1/kintsugi_test`;
  const safe = redactPublicProcessDiagnostics(raw, secrets);

  for (const secret of secrets) assert.equal(safe.includes(secret), false);
  assert.equal(safe.includes("smoke:secret"), false);
  assert.equal(safe.includes("other-secret"), false);
  assert.match(safe, /\[redacted secret\]/);
  assert.match(safe, /\[redacted database URL\]/);
});

test("cleanup continues after a failed resource and redacts its diagnostic", async () => {
  const attempted = [];
  const secret = "cleanup-secret.with[punctuation]+value";
  const errors = await attemptPublicProcessCleanup([
    { label: "first resource", cleanup: async () => { attempted.push("first"); throw new Error(`${secret} postgres://user:password@127.0.0.1/test`); } },
    { label: "second resource", cleanup: async () => { attempted.push("second"); } },
  ], [secret]);

  assert.deepEqual(attempted, ["first", "second"]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^first resource: \[redacted secret\] \[redacted database URL\]$/);
});
