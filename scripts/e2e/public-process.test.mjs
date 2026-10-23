import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  attemptPublicProcessCleanup,
  capturePublicProcessClientError,
  createPublicProcessSpec,
  redactPublicProcessDiagnostics,
  resolveSmokeDatabaseConfig,
} from "./public-process.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const apiRequire = createRequire(join(repoRoot, "apps/api/package.json"));
const pgRequire = createRequire(apiRequire.resolve("pg/package.json"));
const { Client } = apiRequire("pg");
const pgConnectionString = pgRequire("pg-connection-string");

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

test("resolves only a loopback PostgreSQL target using the installed pg parser", () => {
  const validUrl = "postgresql://smoke:secret@127.0.0.1:34756/postgres";
  const valid = resolveSmokeDatabaseConfig(validUrl, pgConnectionString.parseIntoClientConfig, "postgres");
  assert.equal(valid.host, "127.0.0.1");
  assert.equal(valid.port, 34756);
  assert.equal(valid.database, "postgres");

  const noPort = resolveSmokeDatabaseConfig("postgresql://smoke:secret@localhost/postgres", pgConnectionString.parseIntoClientConfig, "postgres");
  assert.equal(noPort.host, "localhost");
  assert.equal(noPort.port, 5432, "ambient PGPORT must not redirect a URL without an explicit port");

  const remoteHostOverride = "postgresql://smoke:secret@127.0.0.1:34756/postgres?host=remote.invalid";
  assert.equal(pgConnectionString.parse(remoteHostOverride).host, "remote.invalid", "the installed parser honors the query override");
  const hostAddressOverride = "postgresql://smoke:secret@127.0.0.1:34756/postgres?hostaddr=203.0.113.10";
  const parsedHostAddressOverride = pgConnectionString.parse(hostAddressOverride);
  assert.equal(parsedHostAddressOverride.host, "127.0.0.1");
  assert.equal(parsedHostAddressOverride.hostaddr, "203.0.113.10", "the installed parser preserves the host-address override");
  for (const url of [
    remoteHostOverride,
    hostAddressOverride,
    "postgresql://smoke:secret@127.0.0.1:34756/postgres?HOST=remote.invalid",
    "postgresql://smoke:secret@127.0.0.1:34756/postgres?HoStAdDr=203.0.113.10",
    "postgresql://smoke:secret@127.0.0.1:34756/postgres?PORT=34757",
    "postgresql://smoke:secret@127.0.0.1:34756/postgres?database=unrelated",
    "postgresql://smoke:secret@127.0.0.1:34756/postgres?DB=unrelated",
    "postgresql://smoke:secret@127.0.0.1:34756/postgres?service=remote",
    "postgresql://smoke:secret@remote.invalid:34756/postgres",
  ]) {
    assert.throws(() => resolveSmokeDatabaseConfig(url, pgConnectionString.parseIntoClientConfig, "kintsugi_smoke_test_0123456789ab"), /loopback|connection target override/i);
  }
});

test("rejects nested connection strings and pins a safe client config to the generated database", () => {
  const generatedDatabase = "kintsugi_smoke_test_0123456789ab";
  const nestedConnectionString = "postgresql://nested:secret@remote.invalid/unrelated";
  const nestedUrl = `postgresql://outer:secret@127.0.0.1:34756/postgres?connectionString=${encodeURIComponent(nestedConnectionString)}`;
  const parserConfig = pgConnectionString.parseIntoClientConfig(nestedUrl);
  assert.equal(parserConfig.connectionString, nestedConnectionString);

  const vulnerableClient = new Client(parserConfig);
  assert.equal(vulnerableClient.connectionParameters.host, "remote.invalid");
  assert.equal(vulnerableClient.connectionParameters.database, "unrelated");
  assert.throws(
    () => resolveSmokeDatabaseConfig(nestedUrl, pgConnectionString.parseIntoClientConfig, generatedDatabase),
    /connection target override/i,
  );
  const upperNestedUrl = `postgresql://outer:secret@127.0.0.1:34756/postgres?CONNECTIONSTRING=${encodeURIComponent(nestedConnectionString)}`;
  assert.throws(
    () => resolveSmokeDatabaseConfig(upperNestedUrl, pgConnectionString.parseIntoClientConfig, generatedDatabase),
    /connection target override/i,
  );

  const unknownOptionUrl = "postgresql://outer:secret@127.0.0.1:34756/ignored?application_name=untrusted";
  const parsed = pgConnectionString.parseIntoClientConfig(unknownOptionUrl);
  assert.equal(parsed.application_name, "untrusted");
  const safe = resolveSmokeDatabaseConfig(unknownOptionUrl, pgConnectionString.parseIntoClientConfig, generatedDatabase);
  assert.equal(Object.hasOwn(safe, "connectionString"), false);
  assert.equal(Object.hasOwn(safe, "application_name"), false);
  const effective = new Client(safe).connectionParameters;
  assert.equal(effective.host, "127.0.0.1");
  assert.equal(effective.port, 34756);
  assert.equal(effective.database, generatedDatabase);
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

test("captures an idle pg client error and still attempts later cleanup", async () => {
  const client = new Client({ connectionString: "postgresql://smoke:secret@127.0.0.1:34756/postgres" });
  const assertClientHealthy = capturePublicProcessClientError(client);
  const laterCleanup = [];
  const idleError = new Error("idle maintenance connection failed");

  client.emit("error", idleError);
  const errors = await attemptPublicProcessCleanup([
    { label: "check maintenance client", cleanup: async () => assertClientHealthy() },
    { label: "close maintenance client", cleanup: async () => client.end() },
    { label: "later cleanup", cleanup: async () => laterCleanup.push("attempted") },
  ]);

  assert.deepEqual(laterCleanup, ["attempted"]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^check maintenance client: idle maintenance connection failed$/);
});
