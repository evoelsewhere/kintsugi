import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { redactReportValue, requiredChildEnvironment, summarizeRequiredReport } from "../../scripts/check-member-test-env.mjs";
import { commandForSuite, parseSuiteArgs, suitesFor } from "../../scripts/run-member-integration.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("mandatory runner fails before Vitest if the explicit disposable URL is absent", () => {
  const env = { ...process.env, DATABASE_URL: "postgresql://legacy:secret@localhost/from-env" };
  delete env.KINTSUGI_TEST_DATABASE_URL;
  env.KINTSUGI_REQUIRED_INTEGRATION = "1";
  const run = spawnSync(process.execPath, ["scripts/run-member-integration.mjs", "--suite", "api"], { cwd: root, env, encoding: "utf8" });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /KINTSUGI_TEST_DATABASE_URL/);
  assert.doesNotMatch(run.stdout + run.stderr, /vitest run/i);
  assert.doesNotMatch(run.stdout + run.stderr, /legacy:secret/);
});

test("suite selection and child env are fixed and credentials stay out of command arguments", () => {
  assert.equal(parseSuiteArgs(["--suite", "api"]), "api");
  assert.deepEqual(suitesFor("all"), ["api", "worker"]);
  const url = "postgresql://runner:secret@127.0.0.1/kintsugi_test";
  const env = requiredChildEnvironment({ DATABASE_URL: "postgresql://legacy:old@localhost/legacy" }, url);
  assert.equal(env.DATABASE_URL, url);
  assert.equal(env.KINTSUGI_TEST_DATABASE_URL, url);
  assert.equal(env.KINTSUGI_REQUIRED_INTEGRATION, "1");
  const command = commandForSuite("api", "C:/reports/api.json", "win32");
  assert.equal(command.command, "corepack.cmd");
  assert.ok(command.args.includes("test/integration/member-api.test.ts"));
  assert.ok(!command.args.some((arg) => arg.includes("secret") || arg.includes("postgresql://")));
  assert.throws(() => parseSuiteArgs(["--suite", "unknown"]), /Usage:/);
  assert.throws(() => commandForSuite("pilot", "report.json"), /separate release gate/);
});

test("required report rejects zero cases and any skipped test and redacts connection URLs", () => {
  const report = {
    numTotalTests: 2,
    numPassedTests: 2,
    numFailedTests: 0,
    numPendingTests: 0,
    testResults: [{ assertionResults: [{ status: "passed" }, { status: "passed" }] }],
    details: "postgresql://runner:secret@127.0.0.1/kintsugi_test",
  };
  assert.deepEqual(summarizeRequiredReport(report), { total: 2, passed: 2, failed: 0, skipped: 0 });
  assert.throws(() => summarizeRequiredReport({ ...report, numTotalTests: 0, numPassedTests: 0 }), /zero passing/);
  assert.throws(() => summarizeRequiredReport({ ...report, testResults: [{ assertionResults: [{ status: "passed" }, { status: "skip" }] }] }), /skipped or pending/);
  const safe = JSON.stringify(redactReportValue(report, "postgresql://runner:secret@127.0.0.1/kintsugi_test"));
  assert.doesNotMatch(safe, /runner:secret/);
  assert.match(safe, /redacted database URL/);
});
