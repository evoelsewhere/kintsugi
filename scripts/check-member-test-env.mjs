#!/usr/bin/env node
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";

export function parseTestDatabaseUrl(raw) {
  let url;
  try { url = new URL(raw ?? ""); } catch { throw new Error("Set KINTSUGI_TEST_DATABASE_URL to a valid disposable PostgreSQL URL"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname === "" || url.pathname === "/") {
    throw new Error("Set KINTSUGI_TEST_DATABASE_URL to a PostgreSQL URL with a database name");
  }
  return url;
}

export function requiredChildEnvironment(parent, databaseUrl) {
  return {
    ...parent,
    DATABASE_URL: databaseUrl,
    KINTSUGI_TEST_DATABASE_URL: databaseUrl,
    KINTSUGI_REQUIRED_INTEGRATION: "1",
  };
}

export function redactReportValue(value, databaseUrl) {
  if (typeof value === "string") {
    let redacted = value.split(databaseUrl).join("[redacted database URL]");
    return redacted.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[redacted database URL]");
  }
  if (Array.isArray(value)) return value.map((item) => redactReportValue(item, databaseUrl));
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactReportValue(item, databaseUrl)]));
  return value;
}

export function summarizeRequiredReport(report) {
  if (!report || typeof report !== "object" || !Array.isArray(report.testResults)) throw new Error("Vitest did not produce a valid JSON report");
  const total = Number(report.numTotalTests ?? 0);
  const passed = Number(report.numPassedTests ?? 0);
  const failed = Number(report.numFailedTests ?? 0);
  const pending = Number(report.numPendingTests ?? 0);
  const statuses = report.testResults.flatMap((suite) => Array.isArray(suite.assertionResults) ? suite.assertionResults.map((item) => item.status) : []);
  const skipped = statuses.filter((status) => ["skip", "pending", "todo"].includes(status)).length;
  if (total === 0 || passed === 0) throw new Error("Required suite executed zero passing tests");
  if (failed !== 0) throw new Error(`Required suite reported ${failed} failed test(s)`);
  if (pending !== 0 || skipped !== 0) throw new Error(`Required suite contains ${pending + skipped} skipped or pending test(s)`);
  return { total, passed, failed, skipped };
}

export async function checkDatabaseEndpoint(url, timeoutMs = 4000) {
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: url.hostname, port: Number(url.port || "5432") });
    const timeout = setTimeout(() => socket.destroy(new Error("timeout")), timeoutMs);
    socket.once("connect", () => { clearTimeout(timeout); socket.end(); resolve(); });
    socket.once("error", (error) => { clearTimeout(timeout); reject(error); });
  });
}

async function main() {
  const url = parseTestDatabaseUrl(process.env["KINTSUGI_TEST_DATABASE_URL"]);
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Node.js 22 or later is required");
  await checkDatabaseEndpoint(url);
  process.stdout.write("Coding Agent Workflow integration preflight passed: explicit PostgreSQL endpoint reachable.\n");
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Preflight failed"}\n`);
    process.exitCode = 1;
  });
}
