#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { summarizeRequiredReport } from "./check-member-test-env.mjs";

async function main() {
  const [reportPath, ...flags] = process.argv.slice(2);
  if (!reportPath || !flags.includes("--require-executed") || !flags.includes("--forbid-required-skips")) {
    throw new Error("Usage: node scripts/assert-member-test-report.mjs <report.json> --require-executed --forbid-required-skips");
  }
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const counts = summarizeRequiredReport(report);
  process.stdout.write(`${counts.passed}/${counts.total} tests passed; 0 skipped.\n`);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Test report check failed"}\n`);
    process.exitCode = 1;
  });
}
