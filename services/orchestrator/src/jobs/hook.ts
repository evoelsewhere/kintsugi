// The JobOutput hook (packages/agents/builtin/hooks/job_output.py, contract in JOB-OUTPUT.md):
// run as a script step over a job's output directory before anything is indexed, stored or
// committed. Fail-closed: anything but exit 0 blocks the output. The reason recorded is built
// from the report's redacted fields only (rule, path, line), never from file content. Diagram
// lint warnings (Mermaid) never block; they are kept on the step's summary for reviewers.

import { join } from "node:path";
import { BUILTIN_DIR } from "@kintsugi/agents";
import { type Interpreters, runScript } from "@kintsugi/runtime/launcher";

export const JOB_OUTPUT_HOOK = join(BUILTIN_DIR, "hooks", "job_output.py");

interface HookReport {
  exit_code?: number;
  checked?: { files?: number; bytes?: number };
  findings?: Array<{ category?: string; rule?: string; path?: string; line?: number }>;
  warnings?: Array<{ category?: string; rule?: string; path?: string; line?: number }>;
  errors?: Array<{ path?: string; code?: string }>;
}

export interface HookOutcome {
  ok: boolean;
  /** Redacted reason when blocked. */
  reason?: string;
  checked: { files: number; bytes: number };
  findings: number;
  /** Non-blocking diagram lint warnings: their number and the first few as `rule at path:line`. */
  warnings: { count: number; first: string[] };
}

const MAX_LISTED_WARNINGS = 20;

const EXIT_MEANING: Record<number, string> = {
  2: "credential-shaped values found",
  3: "malformed artifact found",
  4: "credential-shaped values and malformed artifacts found",
  5: "the output could not be scanned safely",
  64: "the hook was invoked incorrectly",
};

/** A short, safe path: the report's paths are relative already; bound and strip control characters. */
const safe = (value: unknown): string =>
  typeof value === "string" ? [...value].map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char)).join("").slice(0, 200) : "?";

function parseReport(stdout: string): HookReport | undefined {
  const line = stdout.trim().split(/\r?\n/).at(-1);
  if (line === undefined || line === "") return undefined;
  try {
    const value = JSON.parse(line) as unknown;
    return typeof value === "object" && value !== null ? (value as HookReport) : undefined;
  } catch {
    return undefined;
  }
}

export async function runJobOutputHook(options: {
  outDir: string;
  /** The job directory (process cwd) and a scratch directory. */
  cwd: string;
  tmp: string;
  interpreters: Interpreters;
  timeoutSec?: number;
  hookFile?: string;
}): Promise<HookOutcome> {
  const result = await runScript({
    file: options.hookFile ?? JOB_OUTPUT_HOOK,
    args: ["--output-dir", options.outDir],
    workspace: { cwd: options.cwd, readOnly: [options.outDir], writable: [options.tmp], tmp: options.tmp, out: options.tmp },
    limits: { timeoutSec: options.timeoutSec ?? 300, maxOutputBytes: 1024 * 1024 },
    interpreters: options.interpreters,
  });
  const report = parseReport(result.stdout);
  const checked = { files: report?.checked?.files ?? 0, bytes: report?.checked?.bytes ?? 0 };
  const findings = report?.findings ?? [];
  const reported = Array.isArray(report?.warnings) ? report.warnings : [];
  const warnings = {
    count: reported.length,
    first: reported.slice(0, MAX_LISTED_WARNINGS).map((warning) => `${safe(warning.rule)} at ${safe(warning.path)}:${typeof warning.line === "number" ? warning.line : "?"}`),
  };
  if (result.exitCode === 0 && result.stopped === undefined && report !== undefined) return { ok: true, checked, findings: 0, warnings };

  if (result.stopped !== undefined || report === undefined) {
    return { ok: false, reason: `JobOutput hook did not complete (${result.failure ?? "no report"})`, checked, findings: findings.length, warnings };
  }
  const listed = [
    ...findings.slice(0, 5).map((finding) => `${safe(finding.rule)} at ${safe(finding.path)}:${finding.line ?? "?"}`),
    ...(report.errors ?? []).slice(0, 3).map((error) => `${safe(error.code)} at ${safe(error.path)}`),
  ];
  const more = findings.length > 5 ? ` (+${findings.length - 5} more)` : "";
  const meaning = EXIT_MEANING[result.exitCode ?? -1] ?? `exit code ${result.exitCode}`;
  return { ok: false, reason: `JobOutput hook blocked the output: ${meaning}${listed.length === 0 ? "" : ` — ${listed.join("; ")}${more}`}`, checked, findings: findings.length, warnings };
}
