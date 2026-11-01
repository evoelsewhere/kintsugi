// The job-isolation probe (ADR-0093): run in the worker container on the operator's host
// (deploy/compose/probe-job-isolation.sh), it starts a script step and a shell child the way jobs start, as the job
// user, and checks that neither can read the worker's environment. The children report only whether the worker's
// /proc/<pid>/environ opened and the names of their own variables, never a value.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type JobUser, jobUser, runProcess } from "./process.js";
import { type Interpreters, jobEnvironment, runScript } from "./script.js";

/** The variable the probe is started with, in its initial environment; its value never leaves this process. */
export const PROBE_SECRET = "KINTSUGI_PROBE_SECRET";

/** The worker variables a job must never see. */
const WORKER_SECRETS = [PROBE_SECRET, "DATABASE_URL", "KINTSUGI_SECRET_KEY"];

export type ProbeStatus = "isolated" | "exposed" | "unsupported";

export interface ProbeResult {
  status: ProbeStatus;
  /** What was checked or why it could not be, one line each. */
  lines: string[];
}

/** What one child reported: whether the worker's environ opened, its own uid and the names of its variables. */
export interface ChildReport {
  label: string;
  workerEnviron: "readable" | "denied" | "unknown";
  uid: number | undefined;
  names: string[];
}

/**
 * Why this process cannot run the probe, or undefined when it can. The control run (P-037) starts its children as the
 * worker's own user, the way jobs run without isolation: it needs only Linux and the marker secret.
 */
export function probeUnsupported(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, uid: number | undefined, control = false): string | undefined {
  if (platform !== "linux") return "job isolation exists only on the Linux worker image";
  if (control) return (env[PROBE_SECRET] ?? "") === "" ? `${PROBE_SECRET} is not in the environment this process started with (run probe-job-isolation.sh)` : undefined;
  let user: JobUser | undefined;
  try {
    user = jobUser(env, platform);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  if (user === undefined) return "KINTSUGI_JOB_UID and KINTSUGI_JOB_GID are not set: jobs run as the worker's user (start the worker with docker-compose.isolated.yml)";
  if (uid !== 0) return "the worker is not root, so it cannot start a process as the job user (start it with docker-compose.isolated.yml)";
  if ((env[PROBE_SECRET] ?? "") === "") return `${PROBE_SECRET} is not in the environment this process started with (run probe-job-isolation.sh)`;
  return undefined;
}

/** Reads a child's report: `environ=<readable|denied>`, `uid=<n>`, then one variable name per line. */
export function parseReport(label: string, stdout: string): ChildReport {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
  const environ = lines.find((line) => line.startsWith("environ="))?.slice("environ=".length);
  const uid = lines.find((line) => line.startsWith("uid="))?.slice("uid=".length);
  return {
    label,
    workerEnviron: environ === "readable" || environ === "denied" ? environ : "unknown",
    uid: uid !== undefined && /^\d+$/.test(uid) ? Number(uid) : undefined,
    names: lines.filter((line) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(line)),
  };
}

/** Isolated only when every child ran as the job user, could not open the worker's environ and saw none of its secrets. */
export function judge(reports: readonly ChildReport[], user: JobUser): ProbeResult {
  const lines: string[] = [];
  let exposed = false;
  for (const report of reports) {
    const seen = WORKER_SECRETS.filter((name) => report.names.includes(name));
    const problems = [
      ...(report.uid === user.uid ? [] : [`ran as uid ${report.uid ?? "?"}, not the job user ${user.uid}`]),
      ...(report.workerEnviron === "denied" ? [] : [`the worker's /proc environ was ${report.workerEnviron === "readable" ? "readable" : "not checked"}`]),
      ...(seen.length === 0 ? [] : [`its own environment holds ${seen.join(", ")}`]),
    ];
    if (problems.length > 0) exposed = true;
    lines.push(`${report.label}: ${problems.length === 0 ? `uid ${report.uid}, the worker's environ denied, no worker secret in its environment` : problems.join("; ")}`);
  }
  return { status: exposed || reports.length === 0 ? "exposed" : "isolated", lines };
}

const PYTHON_CHILD = `import os, sys
try:
    open('/proc/%d/environ' % int(sys.argv[1]), 'rb').read()
    print('environ=readable')
except OSError:
    print('environ=denied')
print('uid=%d' % os.getuid())
for name in sorted(os.environ):
    print(name)
`;

const SHELL_CHILD = `if cat "/proc/$1/environ" >/dev/null 2>&1; then echo environ=readable; else echo environ=denied; fi
echo "uid=$(id -u)"
env | cut -d= -f1`;

/**
 * Runs the probe in this process (the worker container); never throws for a failed check. With `control`, the children
 * run as this process's own user, as jobs do without isolation, and the verdict must then be `exposed`: a probe that
 * cannot see exposure there proves nothing (P-037).
 */
export async function probeJobIsolation(options: { env?: NodeJS.ProcessEnv; interpreters: Interpreters; control?: boolean }): Promise<ProbeResult> {
  const env = options.env ?? process.env;
  const control = options.control === true;
  const unsupported = probeUnsupported(env, process.platform, process.getuid?.(), control);
  if (unsupported !== undefined) return { status: "unsupported", lines: [unsupported] };
  const user: JobUser = control ? { uid: process.getuid!(), gid: process.getgid!() } : jobUser(env)!;
  const runAs = control ? {} : { runAs: user };
  const root = await mkdtemp(join(tmpdir(), "kintsugi-isolation-probe-"));
  try {
    const dirs = { src: join(root, "src"), in: join(root, "in"), out: join(root, "out"), tmp: join(root, "tmp"), scripts: join(root, "scripts") };
    for (const dir of Object.values(dirs)) await mkdir(dir, { recursive: true });
    const script = join(dirs.scripts, "probe.py");
    await writeFile(script, PYTHON_CHILD);
    const step = await runScript({
      file: script,
      args: [String(process.pid)],
      workspace: { cwd: root, readOnly: [dirs.src, dirs.in], writable: [dirs.out, dirs.tmp], tmp: dirs.tmp, out: dirs.out },
      limits: { timeoutSec: 60, maxOutputBytes: 1024 * 1024 },
      interpreters: options.interpreters,
      ...runAs,
    });
    // What a kernel `shell` or `git` call is: a process started by the agent child, with the job environment.
    const shell = await runProcess({ command: "sh", args: ["-c", SHELL_CHILD, "probe", String(process.pid)], cwd: root, env: jobEnvironment(dirs.tmp), timeoutMs: 60_000, ...runAs });
    const reports = [parseReport("script step", step.stdout), parseReport("shell child", shell.stdout)];
    const result = judge(reports, user);
    if (step.failure !== undefined) result.lines.push(`script step: ${step.failure}`);
    return result;
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}
