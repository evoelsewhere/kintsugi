// Script steps in the job workspace (ADR-0027 decision 5, ADR-0029): a Python or Node script
// — shipped with Kintsugi or written by a model in an earlier job — run with explicit path
// arguments, a cleared environment and limits. The script's sha256 is recorded with the run.
// The runtime knows no script: the caller (the orchestrator) chooses the file and arguments.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { type JobUser, type ProcessResult, jobUser, runProcess } from "./process.js";
import { grantToUser, treesSize } from "./workspace.js";

export interface Interpreters {
  /** Python 3.12 executable (KINTSUGI_PYTHON); run as `python -I -B -X utf8`. */
  python: string;
  /** Node 22+ executable (KINTSUGI_NODE); run with Node's permission model. */
  node: string;
}

/** `python3` and the worker's own Node, unless configured. */
export function interpretersFromEnv(env: NodeJS.ProcessEnv = process.env): Interpreters {
  const python = (env["KINTSUGI_PYTHON"] ?? "").trim();
  const node = (env["KINTSUGI_NODE"] ?? "").trim();
  return { python: python === "" ? (process.platform === "win32" ? "python" : "python3") : python, node: node === "" ? process.execPath : node };
}

export interface ScriptWorkspace {
  /** Process working directory (the job directory). */
  cwd: string;
  /** Directories the script may read (source checkout, inputs). */
  readOnly: readonly string[];
  /** Directories the script may write (output, scratch). */
  writable: readonly string[];
  /** Scratch directory: HOME, TEMP and TMPDIR point here. */
  tmp: string;
  /** Output directory; with the scratch, watched against `maxOutputBytes`. */
  out: string;
}

export interface ScriptLimits {
  timeoutSec: number;
  maxOutputBytes: number;
}

export interface ScriptSpec {
  /** Absolute path of the script (.py or .js / .mjs). */
  file: string;
  args: readonly string[];
  workspace: ScriptWorkspace;
  limits: ScriptLimits;
  interpreters: Interpreters;
  signal?: AbortSignal;
  /** The user the script runs as; defaults to `jobUser()` of the worker's environment (ADR-0093). */
  runAs?: JobUser;
}

export interface ScriptResult extends ProcessResult {
  sha256: string;
  /** Short, redacted failure reason; undefined when the script succeeded (exit 0). */
  failure?: string;
}

/**
 * The environment of every child process in a job workspace: no variable of the worker is
 * passed except PATH (and SYSTEMROOT on Windows, without which interpreters cannot start).
 * No credentials, no Kintsugi tokens, no DATABASE_URL.
 */
export function jobEnvironment(tmp: string, host: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {
    PATH: host["PATH"] ?? host["Path"] ?? "/usr/bin:/bin",
    HOME: tmp,
    USERPROFILE: tmp,
    TMPDIR: tmp,
    TEMP: tmp,
    TMP: tmp,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONUTF8: "1",
    NO_COLOR: "1",
  };
  if (process.platform === "win32") {
    const systemRoot = host["SYSTEMROOT"] ?? host["SystemRoot"];
    if (systemRoot !== undefined) env["SYSTEMROOT"] = systemRoot;
  }
  return env;
}

const SECRETISH = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(password|passwd|pwd|secret|token|api[_-]?key|credential)s?\b\s*[:=]\s*\S+/gi,
  /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s]+@/gi,
];
const OPAQUE_SECRETISH = /[A-Za-z0-9+_=-]{32,}/g;

const CREDENTIAL_WORD = /password|passwd|pwd|secret|token|api[_-]?key|credential|identified\s+by/i;
const QUOTED = /(["'`])([^"'`\n]{0,400})\1/g;
const NAME_CHAR = /[A-Za-z0-9_.-]/;

/**
 * A line that names a credential, in any language (`01 WS-DB-PASSWORD PIC X(14) VALUE '…'`, `"password", "…"`,
 * `db.password = …`, `IDENTIFIED BY …`, a grep pattern holding a value the model read): every quoted literal goes but a
 * quoted name (`"password"`), then everything after the name that holds the word. A log line may lose more than its
 * secret; it must not keep the secret (T2-027).
 */
function redactCredentialLine(line: string): string {
  if (!CREDENTIAL_WORD.test(line)) return line;
  const unquoted = line.replace(QUOTED, (whole: string, _quote: string, inner: string) => (/^[A-Za-z0-9_.-]+$/.test(inner) && CREDENTIAL_WORD.test(inner) ? whole : "[redacted]"));
  const found = CREDENTIAL_WORD.exec(unquoted);
  if (found === null) return unquoted;
  let end = found.index + found[0].length;
  while (end < unquoted.length && NAME_CHAR.test(unquoted[end]!)) end += 1;
  if (unquoted[end] === '"' || unquoted[end] === "'") end += 1;
  return unquoted.slice(end).trim() === "" ? unquoted : `${unquoted.slice(0, end)} [redacted]`;
}

/**
 * Masks credential-shaped text: failure reasons may quote a script's stderr, and run events quote what a model read
 * and searched for. With `opaqueTokens: false` it is the narrower detector of what must not leave the installation (a
 * web query, a memory quote): only the shapes of SECRETISH.
 */
export function redactText(text: string, options: { opaqueTokens?: boolean } = {}): string {
  if (options.opaqueTokens === false) return SECRETISH.reduce((result, pattern) => result.replace(pattern, "[redacted]"), text);
  const lines = text.split("\n").map(redactCredentialLine).join("\n");
  return [...SECRETISH, OPAQUE_SECRETISH].reduce((result, pattern) => result.replace(pattern, "[redacted]"), lines);
}

/** The last non-empty line of a process stream, redacted and bounded. */
export function lastLine(text: string, max = 300): string {
  const line = text.trim().split(/\r?\n/).filter((entry) => entry.trim() !== "").at(-1) ?? "";
  return redactText(line).slice(0, max);
}

export async function sha256File(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function command(spec: ScriptSpec): { command: string; args: string[] } {
  const extension = extname(spec.file).toLowerCase();
  if (extension === ".py") {
    // -I: isolated (no PYTHON* variables, no user site, script directory not on sys.path);
    // -B: no .pyc files; -X utf8: UTF-8 I/O on every platform.
    return { command: spec.interpreters.python, args: ["-I", "-B", "-X", "utf8", spec.file, ...spec.args] };
  }
  if (extension === ".js" || extension === ".mjs") {
    // Node's permission model: file reads and writes limited to the workspace; no child
    // processes, workers, native addons or WASI.
    const reads = [spec.file, ...spec.workspace.readOnly, ...spec.workspace.writable].map((path) => `--allow-fs-read=${path}`);
    const writes = spec.workspace.writable.map((path) => `--allow-fs-write=${path}`);
    return { command: spec.interpreters.node, args: ["--permission", ...reads, ...writes, spec.file, ...spec.args] };
  }
  throw new Error(`unsupported script type "${extension}" (expected .py, .js or .mjs)`);
}

/** Runs one script step; never throws for a failing script, only for an unusable spec. */
export async function runScript(spec: ScriptSpec): Promise<ScriptResult> {
  const sha256 = await sha256File(spec.file);
  const { command: executable, args } = command(spec);
  const runAs = spec.runAs ?? jobUser();
  if (runAs !== undefined) await grantToUser(spec.workspace.writable, runAs);
  const result = await runProcess({
    command: executable,
    args,
    cwd: spec.workspace.cwd,
    env: jobEnvironment(spec.workspace.tmp),
    timeoutMs: spec.limits.timeoutSec * 1000,
    // Output and scratch together: HOME and TEMP point into the scratch, so a limit on `out` alone is no limit (T3-006).
    watch: { dirs: [spec.workspace.out, spec.workspace.tmp], maxBytes: spec.limits.maxOutputBytes },
    ...(spec.signal === undefined ? {} : { signal: spec.signal }),
    ...(runAs === undefined ? {} : { runAs }),
  }).catch((error: unknown) => {
    throw new Error(`could not start ${executable}: ${error instanceof Error ? error.message : String(error)}`);
  });
  // The watcher samples; a final measurement catches a burst written just before exit.
  if (result.stopped === undefined && (await treesSize([spec.workspace.out, spec.workspace.tmp])) > spec.limits.maxOutputBytes) result.stopped = "output-limit";
  return { ...result, sha256, ...failureOf(result, spec.limits) };
}

function failureOf(result: ProcessResult, limits: ScriptLimits): { failure?: string } {
  if (result.stopped === "timeout") return { failure: `timed out after ${limits.timeoutSec}s` };
  if (result.stopped === "output-limit") return { failure: `output and scratch exceeded the output limit of ${limits.maxOutputBytes} bytes` };
  if (result.stopped === "aborted") return { failure: "aborted" };
  if (result.exitCode === 0) return {};
  const detail = lastLine(result.stderr);
  return { failure: `exited with code ${result.exitCode}${detail === "" ? "" : `: ${detail}`}` };
}
