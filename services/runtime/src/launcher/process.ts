// Child processes of the job workspace (ADR-0029): script steps and hooks. Each runs with an
// explicit command and arguments (no shell), a cleared environment, a wall-clock timeout, an
// output-size cap, and is killed with its whole process tree on timeout, size breach or abort.

import { spawn } from "node:child_process";
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
}

const DEFAULT_CAPTURE = 64 * 1024;

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
    const child = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      // Own process group on POSIX, so the whole tree can be killed.
      detached: process.platform !== "win32",
    });
    const stdout = new Capture(max);
    const stderr = new Capture(max);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    let stopped: ProcessStop | undefined;
    const stop = (reason: ProcessStop): void => {
      if (stopped !== undefined || child.pid === undefined) return;
      stopped = reason;
      killProcessTree(child.pid);
    };
    const timer = setTimeout(() => stop("timeout"), options.timeoutMs);
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
      clearTimeout(timer);
      if (watcher !== undefined) clearInterval(watcher);
      options.signal?.removeEventListener("abort", onAbort);
    };
    child.on("error", (error) => {
      finish();
      reject(error);
    });
    child.on("close", (code) => {
      finish();
      resolve({
        exitCode: code,
        ...(stopped === undefined ? {} : { stopped }),
        stdout: stdout.text(),
        stderr: stderr.text(),
        truncated: stdout.truncated || stderr.truncated,
        durationMs: Date.now() - started,
      });
    });
  });
}
