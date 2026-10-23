#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTestDatabaseUrl, requiredChildEnvironment, redactReportValue, summarizeRequiredReport } from "./check-member-test-env.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const apiFiles = [
  "test/integration/member-auth.test.ts",
  "test/integration/project-access.test.ts",
  "test/integration/member-tasks.test.ts",
  "test/integration/member-context.test.ts",
  "test/integration/member-api.test.ts",
  "test/integration/member-associations.test.ts",
  "test/integration/github-webhook.test.ts",
  "test/integration/member-events.test.ts",
  "test/integration/coding-agent-oauth.test.ts",
  "test/integration/installation-settings.test.ts",
  "test/integration/task-projection-concurrency.test.ts",
  "test/integration/member-upgrade.test.ts",
  "test/integration/gate-publication.test.ts",
  "test/integration/stage-decisions.test.ts",
];
const workerFiles = [
  "test/outbox.test.ts",
  "test/snapshot-retention.test.ts",
  "test/provider-sync.test.ts",
  "test/provider-sync-store.test.ts",
  "test/review-inputs.test.ts",
  "test/review-scheduling.test.ts",
  "test/review-store.test.ts",
  "test/gate-publication.test.ts",
  "test/gate-effective.test.ts",
  "test/stage-decisions.test.ts",
  "test/member-event-retention.test.ts",
  "test/continuation.test.ts",
  "test/continuation-replay.test.ts",
];

export function parseSuiteArgs(args) {
  if (args.length !== 2 || args[0] !== "--suite" || !["api", "worker", "pilot", "all"].includes(args[1])) {
    throw new Error("Usage: node scripts/run-member-integration.mjs --suite api|worker|pilot|all");
  }
  return args[1];
}

export function commandForSuite(suite, reportPath, platform = process.platform) {
  if (suite === "pilot") throw new Error("The real provider/client pilot is a separate release gate and is not implemented as an automated test suite yet");
  const packageName = suite === "api" ? "@kintsugi/api" : "@kintsugi/orchestrator";
  const files = suite === "api" ? apiFiles : workerFiles;
  const prefix = platform === "win32" ? { command: "corepack.cmd", args: ["pnpm"] } : { command: "corepack", args: ["pnpm"] };
  return {
    command: prefix.command,
    args: [...prefix.args, "--filter", packageName, "exec", "vitest", "run", ...files, "--reporter=json", `--outputFile=${reportPath}`],
    cwd: resolve(repoRoot, suite === "api" ? "apps/api" : "services/orchestrator"),
  };
}

export function suitesFor(selection) {
  if (selection === "pilot") return ["pilot"];
  if (selection === "all") return ["api", "worker"];
  return [selection];
}

function run(command, args, options) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { ...options, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout = (stdout + chunk).slice(-120_000); });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr = (stderr + chunk).slice(-120_000); });
    child.once("error", rejectRun);
    child.once("close", (code) => resolveRun({ code: code ?? 1, stdout, stderr }));
  });
}

function redactDiagnostic(value) {
  return value.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[redacted database URL]");
}

export function summarizeFailureReport(report) {
  const lines = [];
  const maxFailures = 8;
  let omitted = false;
  const addFailure = (value) => {
    if (lines.length >= maxFailures) {
      omitted = true;
      return;
    }
    const line = redactDiagnostic(value).replace(/\s+/g, " ").trim();
    lines.push(line.length > 700 ? `${line.slice(0, 697)}...` : line);
  };
  for (const suite of report.testResults ?? []) {
    const name = typeof suite.name === "string" ? suite.name : "Unnamed suite";
    for (const assertion of suite.assertionResults ?? []) {
      if (assertion.status !== "failed") continue;
      const title = assertion.fullName || assertion.title || "Unnamed test";
      const messages = Array.isArray(assertion.failureMessages) ? assertion.failureMessages.filter((message) => typeof message === "string").join("; ") : "";
      addFailure(`${name} > ${title}: ${messages || "Test failed without a failure message"}`);
    }
    if (suite.status === "failed" && typeof suite.message === "string" && suite.message.trim() !== "") {
      addFailure(`${name}: ${suite.message}`);
    }
  }
  if (omitted) lines.push("Additional failures omitted; see the redacted JSON report.");
  return lines.join("\n");
}

async function runSuite(suite, databaseUrl, reportDir, sequence) {
  const reportPath = join(reportDir, `${String(sequence).padStart(2, "0")}-${suite}.json`);
  const command = commandForSuite(suite, reportPath);
  const env = requiredChildEnvironment(process.env, databaseUrl);
  const result = await run(command.command, command.args, { cwd: command.cwd, env });
  let report;
  try {
    report = JSON.parse(await readFile(reportPath, "utf8"));
    report = redactReportValue(report, databaseUrl);
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  } catch {
    throw new Error(`${suite} suite did not produce a readable redacted JSON report (exit ${result.code})`);
  }
  const assertion = await run(process.execPath, [resolve(repoRoot, "scripts/assert-member-test-report.mjs"), reportPath, "--require-executed", "--forbid-required-skips"], { cwd: repoRoot, env: requiredChildEnvironment(process.env, databaseUrl) });
  if (result.code !== 0 || assertion.code !== 0) {
    const details = summarizeFailureReport(report) || redactDiagnostic(result.stderr).split(/\r?\n/).filter(Boolean).slice(-8).map((line) => line.slice(0, 700)).join("\n");
    throw new Error(`${suite} required suite failed (Vitest exit ${result.code}); report: ${reportPath}${details === "" ? "" : `\n${details}`}`);
  }
  const counts = summarizeRequiredReport(report);
  process.stdout.write(`${suite}: ${counts.passed}/${counts.total} passed; no required skips. Report: ${reportPath}\n`);
}

async function main() {
  const selection = parseSuiteArgs(process.argv.slice(2));
  if (selection === "pilot") throw new Error("The real GitHub/client/model pilot remains a release gate; the automated pilot runner is not available yet");
  const databaseUrl = process.env["KINTSUGI_TEST_DATABASE_URL"];
  parseTestDatabaseUrl(databaseUrl);
  const preflight = await run(process.execPath, [resolve(repoRoot, "scripts/check-member-test-env.mjs")], {
    cwd: repoRoot,
    env: requiredChildEnvironment(process.env, databaseUrl),
  });
  if (preflight.code !== 0) throw new Error("Coding Agent Workflow database preflight failed");
  process.stdout.write(preflight.stdout);
  const reportDir = resolve(repoRoot, ".tmp/coding-agent-workflow");
  await mkdir(reportDir, { recursive: true });
  for (const [index, suite] of suitesFor(selection).entries()) await runSuite(suite, databaseUrl, reportDir, index + 1);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Required integration suite failed"}\n`);
    process.exitCode = 1;
  });
}
