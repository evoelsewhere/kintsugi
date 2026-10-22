import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { redactReportValue, requiredChildEnvironment, summarizeRequiredReport } from "../../scripts/check-member-test-env.mjs";
import { commandForSuite, parseSuiteArgs, suitesFor, summarizeFailureReport } from "../../scripts/run-member-integration.mjs";

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

test("required database suites include continuation, replay, projection concurrency and upgrade coverage", () => {
  const apiArgs = commandForSuite("api", "api.json").args;
  const workerArgs = commandForSuite("worker", "worker.json").args;
  for (const file of ["test/integration/task-projection-concurrency.test.ts", "test/integration/member-upgrade.test.ts"]) {
    assert.ok(apiArgs.includes(file), `${file} must run in the API suite`);
  }
  for (const file of ["test/continuation.test.ts", "test/continuation-replay.test.ts"]) {
    assert.ok(workerArgs.includes(file), `${file} must run in the worker suite`);
  }
});

test("required API suite exercises plugin-first OAuth and connection lifetime contracts", () => {
  const apiArgs = commandForSuite("api", "api.json").args;
  for (const file of ["test/integration/coding-agent-oauth.test.ts", "test/integration/installation-settings.test.ts"]) {
    assert.ok(apiArgs.includes(file), `${file} must run in the required API suite`);
  }
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


test("failure summary names failed assertions and suite errors without passing cases or database URLs", () => {
  const report = {
    testResults: [
      {
        name: "member-api.test.ts",
        status: "failed",
        message: "",
        assertionResults: [
          { status: "passed", fullName: "unrelated passing case", failureMessages: [] },
          { status: "failed", fullName: "member API rejects stale credentials", failureMessages: ["Expected 401, received 500\npostgresql://runner:secret@localhost/kintsugi_test"] },
        ],
      },
      { name: "project-access.test.ts", status: "failed", message: "beforeAll: connect postgres://other:private@localhost/another_test", assertionResults: [] },
      { name: "other.test.ts", status: "passed", message: "unrelated suite output", assertionResults: [] },
    ],
  };
  const summary = summarizeFailureReport(redactReportValue(report, "postgresql://runner:secret@localhost/kintsugi_test"));
  assert.match(summary, /member-api\.test\.ts.*member API rejects stale credentials.*Expected 401, received 500/);
  assert.match(summary, /project-access\.test\.ts.*beforeAll: connect/);
  assert.match(summary, /redacted database URL/);
  assert.doesNotMatch(summary, /runner:secret|other:private|postgres(?:ql)?:\/\/|unrelated/);
});

test("failure summary bounds failure count and line length and redacts before truncating", () => {
  const report = {
    testResults: [{
      name: "member-api.test.ts",
      status: "failed",
      assertionResults: Array.from({ length: 20 }, (_, index) => ({
        status: "failed",
        fullName: `case ${index}`,
        failureMessages: [`${"x".repeat(550)}postgresql://runner:${"s".repeat(1000)}@localhost/kintsugi_test`],
      })),
    }],
  };
  const summary = summarizeFailureReport(report);
  const lines = summary.split("\n");
  assert.ok(lines.length <= 9);
  assert.ok(lines.every((line) => line.length <= 700));
  assert.match(summary, /case 0/);
  assert.match(summary, /Additional failures omitted/);
  assert.doesNotMatch(summary, /case 19|postgres(?:ql)?:\/\/|runner:|s{20}/);
});
