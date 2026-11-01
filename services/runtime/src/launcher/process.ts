// Child processes of the job workspace (ADR-0029): script steps, hooks and agent jobs. Each runs with an
// explicit command and arguments (no shell), a cleared environment, a wall-clock timeout, an
// output-size cap, and is killed with its whole process tree on timeout, size breach or abort.

import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from "node:child_process";
import { createInterface } from "node:readline";
import { treeSize } from "./workspace.js";

export interface RunProcessOptions {
  command: string;
  args: readonly string[];
  cwd: string;
  /** The complete environment; nothing is inherited from the worker. */
  env: Record<string, string>;
  timeoutMs: number;
  /** Bytes of stdout / stderr kept (each); the rest is dropped. */
  maxCaptureBytes?: number;
  /** Directory whose size is watched while the process runs, and its limit in bytes. */
  watch?: { dir: string; maxBytes: number; intervalMs?: number };
  signal?: AbortSignal;
  /** Written to the process's stdin, which is then closed (stdin is empty otherwise). */
  input?: string;
  /** Receives stdout line by line instead of capturing it (agent jobs stream JSON lines). */
  onLine?: (line: string) => void;
  /** Optional private IPC channel for caller-bound services; scripts do not receive one. */
  onMessage?: (message: unknown, reply: (message: object) => void) => void;
  /** The OS user the process runs as (POSIX only); unset = the worker's own user. See `jobUser`. */
  runAs?: JobUser;
}

/** A numeric POSIX user and group. */
export interface JobUser {
  uid: number;
  gid: number;
}

const ID = /^\d{1,10}$/;

/**
 * The OS user job processes run as (ADR-0093): `KINTSUGI_JOB_UID` and `KINTSUGI_JOB_GID` of the worker's environment.
 * Script steps, hooks and agent jobs then run as a user that cannot read the worker's environment (its
 * `/proc/<pid>/environ`) or its files. Unset (and always on Windows) = the worker's own user, which isolates nothing.
 * A half or malformed setting is an error: a worker must not silently fall back to running jobs as itself.
 */
export function jobUser(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): JobUser | undefined {
  const uid = env["KINTSUGI_JOB_UID"]?.trim() || undefined;
  const gid = env["KINTSUGI_JOB_GID"]?.trim() || undefined;
  if (uid === undefined && gid === undefined) return undefined;
  if (platform === "win32") throw new Error("KINTSUGI_JOB_UID and KINTSUGI_JOB_GID are not supported on Windows: unset them");
  if (uid === undefined || gid === undefined || !ID.test(uid) || !ID.test(gid)) throw new Error("KINTSUGI_JOB_UID and KINTSUGI_JOB_GID must both be set to numeric ids");
  const user = { uid: Number(uid), gid: Number(gid) };
  if (user.uid === 0) throw new Error("KINTSUGI_JOB_UID must not be 0: job processes never run as root");
  return user;
}

/** The warning a worker logs once when job processes share its user on a platform that could separate them, else undefined. */
export function jobIsolationWarning(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  if (platform === "win32" || jobUser(env, platform) !== undefined) return undefined;
  return "KINTSUGI_JOB_UID and KINTSUGI_JOB_GID are not set: job processes run as the worker's user and can read its environment (DATABASE_URL, KINTSUGI_SECRET_KEY). See ADR-0093.";
}

/** The spawn options of `runProcess` that depend on the options (exported for tests: a uid cannot be tried on every platform). */
export function spawnOptions(options: Pick<RunProcessOptions, "cwd" | "env" | "onMessage" | "runAs">): SpawnOptions {
  return {
    cwd: options.cwd,
    env: options.env,
    // stdin is always a pipe: it carries `input`, or is closed at once.
    stdio: options.onMessage === undefined ? ["pipe", "pipe", "pipe"] : ["pipe", "pipe", "pipe", "ipc"],
    shell: false,
    windowsHide: true,
    // Own process group on POSIX, so the whole tree can be killed.
    detached: process.platform !== "win32",
    ...(options.runAs === undefined ? {} : { uid: options.runAs.uid, gid: options.runAs.gid }),
  };
}

export type ProcessStop = "timeout" | "output-limit" | "aborted";

export interface ProcessResult {
  exitCode: number | null;
  /** Set when the launcher killed the process. */
  stopped?: ProcessStop;
  stdout: string;
  stderr: string;
  /** True when stdout or stderr exceeded the capture size. */
  truncated: boolean;
  durationMs: number;
  /**
   * Set when the process had ended but a process it started still held its output open after `DRAIN_GRACE_MS`: the
   * output was cut there, and that process may still be running (it escaped the tree kill).
   */
  outlived?: true;
}

const DEFAULT_CAPTURE = 64 * 1024;

/**
 * How long the output may stay open once the process has exited. A process it started inherits the pipes, and one
 * that left its tree (an orphan, a new session) is not reached by the kill, so waiting for the pipes to close alone
 * would hold the step, its timeout and its cancel for as long as that process lives (T3-001).
 */
export const DRAIN_GRACE_MS = 2000;

/** Kills a process and every process it started. */
export function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    // taskkill /T walks the child tree; /F forces termination.
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => undefined);
    return;
  }
  try {
    // The child leads its own process group (detached), so -pid reaches all of it.
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

class Capture {
  #chunks: Buffer[] = [];
  #size = 0;
  truncated = false;

  constructor(private readonly max: number) {}

  push(chunk: Buffer): void {
    if (this.#size >= this.max) {
      this.truncated = true;
      return;
    }
    const room = this.max - this.#size;
    if (chunk.length > room) this.truncated = true;
    const kept = chunk.subarray(0, room);
    this.#chunks.push(kept);
    this.#size += kept.length;
  }

  text(): string {
    return Buffer.concat(this.#chunks).toString("utf8");
  }
}

export function runProcess(options: RunProcessOptions): Promise<ProcessResult> {
  const started = Date.now();
  const max = options.maxCaptureBytes ?? DEFAULT_CAPTURE;
  return new Promise<ProcessResult>((resolve, reject) => {
    if (options.signal?.aborted) {
      resolve({ exitCode: null, stopped: "aborted", stdout: "", stderr: "", truncated: false, durationMs: 0 });
      return;
    }
    const child = spawn(options.command, [...options.args], spawnOptions(options)) as ChildProcessWithoutNullStreams; // The three standard streams are always pipes, including with IPC.
    const stdout = new Capture(max);
    if (options.onMessage !== undefined) {
      child.on("message", (message) => options.onMessage!(message, (response) => {
        if (child.connected) child.send(response, () => undefined);
      }));
    }
    const stderr = new Capture(max);
    if (options.onLine === undefined) {
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    } else {
      // Line by line; readline handles CRLF and a last line without a newline.
      const onLine = options.onLine;
      createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => {
        if (line.trim() !== "") onLine(line);
      });
    }
    // The process may exit before reading everything; a broken pipe is not an error here.
    child.stdin.on("error", () => undefined);
    if (options.input === undefined) child.stdin.end();
    else child.stdin.end(options.input, "utf8");
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    let stopped: ProcessStop | undefined;
    /** The exit code once the process itself has exited, while its output may still be open. */
    let exited: { code: number | null } | undefined;
    let drain: NodeJS.Timeout | undefined;
    let settled = false;
    const stop = (reason: ProcessStop): void => {
      if (stopped !== undefined || child.pid === undefined) return;
      stopped = reason;
      // Once the process has exited, only what it started holds the output: cut it now. Its pid may already belong
      // to another process, so it is not killed again (on POSIX its process group still is, see `cut`).
      if (exited !== undefined) cut();
      else killProcessTree(child.pid);
    };
    // timeoutMs <= 0 means no wall-clock limit.
    const timer = options.timeoutMs > 0 ? setTimeout(() => stop("timeout"), options.timeoutMs) : undefined;
    const onAbort = (): void => stop("aborted");
    options.signal?.addEventListener("abort", onAbort, { once: true });
    let checking = false;
    const watcher =
      options.watch === undefined
        ? undefined
        : setInterval(() => {
            if (checking) return;
            checking = true;
            void treeSize(options.watch!.dir)
              .then((size) => {
                if (size.bytes > options.watch!.maxBytes) stop("output-limit");
              })
              .catch(() => undefined)
              .finally(() => {
                checking = false;
              });
          }, options.watch.intervalMs ?? 1000);

    const finish = (): void => {
      settled = true;
      clearTimeout(timer);
      clearTimeout(drain);
      if (watcher !== undefined) clearInterval(watcher);
      options.signal?.removeEventListener("abort", onAbort);
    };
    const settle = (code: number | null, outlived: boolean): void => {
      if (settled) return;
      finish();
      resolve({
        exitCode: code,
        ...(stopped === undefined ? {} : { stopped }),
        stdout: stdout.text(),
        stderr: stderr.text(),
        truncated: stdout.truncated || stderr.truncated,
        durationMs: Date.now() - started,
        ...(outlived ? { outlived: true as const } : {}),
      });
    };
    /** Ends the run without waiting for the processes that still hold the output: what was read so far is kept. */
    function cut(): void {
      if (settled || exited === undefined) return;
      // On POSIX the process group outlives its leader, so what stayed in it is still reached; a process that made a
      // session of its own, or (on Windows) left the tree, is not.
      if (process.platform !== "win32" && child.pid !== undefined) killProcessTree(child.pid);
      child.stdout.destroy();
      child.stderr.destroy();
      settle(exited.code, true);
    }
    child.on("error", (error) => {
      if (settled) return;
      finish();
      reject(error);
    });
    child.on("exit", (code) => {
      exited = { code };
      drain = setTimeout(cut, DRAIN_GRACE_MS);
    });
    child.on("close", (code) => settle(code, false));
  });
}
