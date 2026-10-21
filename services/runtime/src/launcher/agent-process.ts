// Agent jobs as child processes of the worker (ADR-0029): an AgentRuntime whose jobs each
// run in their own Node process (bin/agent-job.js), started like a script step — cwd = the
// job directory, a cleared environment, a wall-clock timeout and a process-tree kill — plus
// Node's permission model (reads: the runtime's own code and the job's workspace; writes:
// out and tmp; no child processes). The JobSpec and the provider's API key and inline
// secrets go to the child on stdin; provider environment credentials (cloud regions, keys
// read from variables) go into that child's environment only. Nothing is written to disk,
// and nothing is shared between concurrent jobs. JobEvents come back as JSON lines.

import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRuntime, JobEvent, JobFailureReason, JobHandle, JobSpec } from "@kintsugi/runtime-sdk";
import { EventStream } from "../event-stream.js";
import { PI_ENGINE_ID, RUNTIME_VERSION } from "../version.js";
import type { StoredProviderConfig } from "./model-runtime.js";
import { type ProcessResult, runProcess } from "./process.js";
import type { LoadedProvider } from "./provider-registry.js";
import { jobEnvironment, lastLine, redactText } from "./script.js";

/** What the launcher writes to the child's stdin (one JSON document). */
export interface AgentChildInput {
  mode: "pi" | "mock";
  spec: JobSpec;
  provider?: { config: StoredProviderConfig; apiKey?: string; secrets?: Record<string, string> };
}

export interface ChildAgentRuntimeOptions {
  /** "pi" calls the bound LLM provider; "mock" runs the deterministic backend (no LLM). */
  mode: "pi" | "mock";
  /** Resolves a provider record and its decrypted credentials, per job (pi mode). */
  loadProvider?: (providerId: string) => Promise<LoadedProvider>;
  /** Node executable; defaults to the worker's own. */
  node?: string;
  /** The child entry; defaults to bin/agent-job.js next to this module. */
  entry?: string;
  /** Seconds past the job's own timeout before the launcher kills the process tree. */
  graceSec?: number;
  /**
   * Seconds without any line from the child (events, or its liveness lines while the model thinks
   * or streams tool-call arguments) before the job counts as
   * stalled and its process tree is killed: a provider that drops a streaming response leaves the
   * child waiting with no connection. Defaults to 300; 0 turns the watchdog off.
   */
  idleTimeoutSec?: number;
  /** Disables Node's permission model for the child (diagnostics only). */
  permissionModel?: boolean;
  /** The worker's environment, for PATH (tests). */
  hostEnv?: NodeJS.ProcessEnv;
}

type JobEnd = Extract<JobEvent, { type: "job.completed" | "job.failed" }>;

const EVENT_TYPES = new Set<JobEvent["type"]>(["job.started", "message.delta", "progress", "tool.call", "tool.result", "output", "usage", "job.completed", "job.failed"]);

export const AGENT_CHILD_ENTRY = fileURLToPath(new URL("../bin/agent-job.js", import.meta.url));

const now = (): string => new Date().toISOString();

/** The runtime package root (services/runtime). */
const PACKAGE_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** The `node_modules` directory a resolved package lives under (pnpm's store included). */
function nodeModulesOf(file: string): string | undefined {
  const marker = `${sep}node_modules${sep}`;
  const index = file.indexOf(marker);
  return index === -1 ? undefined : file.slice(0, index + marker.length - 1);
}

let codeRoots: Promise<string[]> | undefined;

/** Directories the child must read to load its code: this package, its workspace dependencies, node_modules. */
function childCodeRoots(): Promise<string[]> {
  codeRoots ??= (async () => {
    const roots = new Set<string>([PACKAGE_ROOT, realpathSync(PACKAGE_ROOT)]);
    const require = createRequire(import.meta.url);
    for (const name of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai", "@earendil-works/pi-codemode", "@earendil-works/pi-mcp", "@earendil-works/pi-telemetry", "typebox", "@kintsugi/runtime-sdk"]) {
      try {
        const file = realpathSync(require.resolve(name));
        const modules = nodeModulesOf(file);
        if (modules !== undefined) roots.add(modules);
      } catch {
        // ESM-only exports without a require condition: covered by the node_modules of the others.
      }
    }
    for (const local of [join(PACKAGE_ROOT, "node_modules")]) {
      roots.add(local);
      // Workspace packages are symbolic links out of node_modules; their real directories hold their code.
      for (const scope of await readdir(local).catch(() => [] as string[])) {
        if (!scope.startsWith("@")) continue;
        for (const name of await readdir(join(local, scope)).catch(() => [] as string[])) {
          try {
            roots.add(realpathSync(join(local, scope, name)));
          } catch {
            // dangling link
          }
        }
      }
    }
    return [...roots];
  })();
  return codeRoots;
}

function parseEvent(line: string): JobEvent | undefined {
  try {
    const value = JSON.parse(line) as { type?: unknown };
    return typeof value === "object" && value !== null && EVENT_TYPES.has(value.type as JobEvent["type"]) ? (value as JobEvent) : undefined;
  } catch {
    return undefined;
  }
}

class ChildAgentJob implements JobHandle {
  readonly events = new EventStream<JobEvent>();
  readonly done: Promise<JobEnd>;
  readonly #abort = new AbortController();
  #abortReason = "aborted";
  #stalledAfterSec: number | undefined;
  #idle: NodeJS.Timeout | undefined;
  #end: JobEnd | undefined;
  #resolveDone!: (event: JobEnd) => void;

  constructor(
    readonly jobId: string,
    private readonly idleTimeoutSec: number,
  ) {
    this.done = new Promise<JobEnd>((resolve) => {
      this.#resolveDone = resolve;
    });
    this.#touch();
  }

  /** Restarts the idle watchdog: any line from the child is a sign of life. */
  #touch(): void {
    if (this.idleTimeoutSec <= 0 || this.#end !== undefined) return;
    clearTimeout(this.#idle);
    this.#idle = setTimeout(() => {
      this.#stalledAfterSec = this.idleTimeoutSec;
      this.#abort.abort();
    }, this.idleTimeoutSec * 1000);
    this.#idle.unref();
  }

  get signal(): AbortSignal {
    return this.#abort.signal;
  }

  async abort(reason: string): Promise<void> {
    this.#abortReason = reason;
    this.#abort.abort();
  }

  onLine(line: string): void {
    this.#touch();
    const event = parseEvent(line);
    if (event === undefined || this.#end !== undefined) return;
    if (event.type === "job.completed" || event.type === "job.failed") {
      this.#finish(event);
      return;
    }
    this.events.push(event);
  }

  /** The process has exited: an end event it did not send is derived from how it stopped. */
  exited(result: ProcessResult | undefined, timeoutSec: number, error?: unknown): void {
    if (this.#end !== undefined) return;
    const fail = (reason: JobFailureReason, message: string): void =>
      this.#finish({ type: "job.failed", jobId: this.jobId, at: now(), reason, error: message });
    if (error !== undefined) fail("error", `could not start the agent process: ${redactText(error instanceof Error ? error.message : String(error))}`);
    else if (this.#stalledAfterSec !== undefined) fail("timeout", `stalled: no activity from the model for ${this.#stalledAfterSec}s (the provider stopped responding)`);
    else if (result?.stopped === "aborted") fail("aborted", this.#abortReason);
    else if (result?.stopped === "timeout") fail("timeout", `timed out after ${timeoutSec}s`);
    else {
      const detail = lastLine(result?.stderr ?? "");
      fail("error", `the agent process exited with code ${result?.exitCode ?? "?"} without a result${detail === "" ? "" : `: ${detail}`}`);
    }
  }

  #finish(event: JobEnd): void {
    if (this.#end !== undefined) return;
    clearTimeout(this.#idle);
    this.#end = event;
    this.events.push(event);
    this.events.close();
    this.#resolveDone(event);
  }
}

/** An AgentRuntime that runs every job in its own child process. */
export function createChildAgentRuntime(options: ChildAgentRuntimeOptions): AgentRuntime {
  const grace = options.graceSec ?? 30;
  const idleTimeoutSec = options.idleTimeoutSec ?? 300;
  return {
    engine: options.mode === "mock" ? `mock@${RUNTIME_VERSION}` : PI_ENGINE_ID,
    async startJob(spec: JobSpec): Promise<JobHandle> {
      const jobDir = dirname(spec.workspace.outDir);
      const tmp = join(jobDir, "tmp");
      await mkdir(tmp, { recursive: true });

      const input: AgentChildInput = { mode: options.mode, spec };
      let providerEnv: Record<string, string> = {};
      if (options.mode === "pi") {
        if (options.loadProvider === undefined) throw new Error("the pi agent runtime needs loadProvider");
        const { config, credentials } = await options.loadProvider(spec.model.provider);
        input.provider = {
          config,
          ...(credentials.apiKey === undefined ? {} : { apiKey: credentials.apiKey }),
          ...(credentials.secrets === undefined ? {} : { secrets: credentials.secrets }),
        };
        providerEnv = credentials.env ?? {};
      }

      const entry = options.entry ?? AGENT_CHILD_ENTRY;
      const permission =
        options.permissionModel === false
          ? []
          : [
              "--permission",
              ...[...(await childCodeRoots()), entry, jobDir, ...spec.workspace.readOnly].map((path) => `--allow-fs-read=${path}`),
              // The kernel's `shell` and `git` start processes and codemode runs scripts in a worker thread. The
              // OS account is the isolation boundary (ADR-0029); these flags only let the kernel use its own tools.
              "--allow-child-process",
              "--allow-worker",
              "--disable-warning=SecurityWarning",
              ...[spec.workspace.outDir, tmp].map((path) => `--allow-fs-write=${path}`),
            ];
      const job = new ChildAgentJob(randomUUID(), idleTimeoutSec);
      const timeoutSec = spec.limits.timeoutSec;
      void runProcess({
        command: options.node ?? process.execPath,
        args: [...permission, entry],
        cwd: jobDir,
        // The job environment plus this provider's variables — in this child only.
        env: { ...jobEnvironment(tmp, options.hostEnv), ...providerEnv },
        // timeoutSec 0 = no wall-clock limit; the idle watchdog still catches a stalled provider.
        timeoutMs: timeoutSec > 0 ? (timeoutSec + grace) * 1000 : 0,
        input: JSON.stringify(input),
        onLine: (line) => job.onLine(line),
        signal: job.signal,
      }).then(
        (result) => job.exited(result, timeoutSec),
        (error: unknown) => job.exited(undefined, timeoutSec, error),
      );
      return job;
    },
  };
}
