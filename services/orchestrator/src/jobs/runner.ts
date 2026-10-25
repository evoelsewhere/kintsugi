// The job runner (ADR-0023, ADR-0027, ADR-0029, ADR-0055): runs one attempt of a job run end to end in the job's
// workspace and hands the result to the document repo writer. The workspace belongs to the job and outlives its
// attempts (packages/git/src/storage.ts has the layout):
//
//   as-is/<repo>, to-be/<repo>  read-only worktrees of the repositories at their pinned commits
//   docs/                       read-only: the declared documents of the document repo at its pinned commit
//   out/  work/                 the results; what the steps of a stage pass to each other
//   steps/<step>/{in,out,tmp}   one folder per step of a stage; a failed agent step keeps its out/ for the next attempt
//   .state/ledger.json          what each step ran with and wrote, so a later attempt skips what did not change
//   WORKSPACE.md, workspace.json  the guide for the agents and the manifest, written here
//
// After every step: out/restricted/ is stored as encrypted restricted records and removed,
// the JobOutput hook checks out/ (fail-closed), and the files are indexed as artifacts. A
// top-level run then enqueues a document write of its out/ (outputOfJob) with job, agent and
// actor trailers. Stage steps run as child runs in folders of the stage's workspace, sharing its checkouts.
//
// There is no OS sandbox: scripts and agent jobs run as child processes with the job workspace as their working
// directory, a cleared environment, limits and a process-tree kill; agent tools are confined by the kernel (read
// only under as-is/, to-be/, the step's in/ and the guide, write only under the step's out/). Only an agent job's
// own child gets its provider credentials (launcher/agent-process.ts); scripts never get any.

import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { findBuiltinFile } from "@kintsugi/agents";
import { DEFAULT_SANDBOX, legacySources, mcpServersNamedBy, sourceRole, sourceSpec, targetSources, THINKING_LEVELS, type PinnedSource, type Provenance, type SandboxSettings, type SourceRepo, type ThinkingLevel, MEMORY_CANDIDATES_FILE, MEMORY_WRITE_SCHEMA, type MemoryEvidence } from "@kintsugi/domain";
import { type CheckoutStorage, type JobPaths, runGit } from "@kintsugi/git";
import { type Interpreters, makeReadOnly, redactText, removeTree, runScript } from "@kintsugi/runtime/launcher";
import { RESULT_FILE, RESULT_TOOL, MEMORY_TOOL_NAMES } from "@kintsugi/runtime/tool-names";
import type { AgentRuntime, JobEvent, JobSpec, McpServerSpec, JobServices } from "@kintsugi/runtime-sdk";
import type { DocumentWriteRequest } from "../queues.js";
import { bindProjectMemory, type ProjectMemory, type MemoryContext } from "../project-memory/index.js";
import { defaultSandbox, limitsWith, type SandboxProvider } from "../sandbox.js";
import { renderGuide, type GuideSource } from "../workspace/guide.js";
import { digestOf, filesDigest, Ledger, type LedgerOutput } from "../workspace/ledger.js";
import { readManifest, writeAtomically, writeManifest, type WorkspaceManifest } from "../workspace/manifest.js";
import { dropCheckouts, mountFolder, mountPath, mountSources } from "../workspace/provision.js";
import type { AgentResolver } from "./agents.js";
import { materializeSkillFiles } from "./skill-files.js";
import { type LeafPlacement, type LeafResult, type LeafRun, StageFailure, StagePlanExecutor, type StepReuse } from "./executor.js";
import { copyTree, listFiles } from "./files.js";
import { runJobOutputHook } from "./hook.js";
import { exampleOf, keysOf, shapeProblem, unwrapResult } from "./result-shape.js";
import { writeMockOutputs } from "./mock-outputs.js";
import {
  type ArtifactEntry,
  type GateDecider,
  type JobEventKind,
  JobFailure,
  type JobRun,
  type JobStore,
  type NewJobRun,
  type SourceCheckouts,
  type SpanExporter,
  type SpanRecord,
  type StepLimits,
  isCancelled,
} from "./model.js";
import { type Placeholders, type StagePlan, type StageScope, fill } from "./plan.js";
import { STAGES } from "./stages.js";
import { type AgentCallOptions, type WorkflowBudgets, loadWorkflow, runWorkflow } from "./workflow.js";

/** Budgets of a stage run: agent jobs it may start in total (workflows included; absent = no limit), and at a time in a group. */
export interface StageBudgets {
  maxAgents?: number;
  concurrency: number;
}

export interface JobDefaults {
  script: StepLimits;
  agent: StepLimits;
  workflow: WorkflowBudgets;
  stage: StageBudgets;
}

export const DEFAULT_JOB_LIMITS: JobDefaults = {
  script: { timeoutSec: 600, maxOutputBytes: 50 * 1024 * 1024 },
  agent: { timeoutSec: 0, maxOutputBytes: 50 * 1024 * 1024 },
  workflow: { concurrency: 4, maxTokens: 0 },
  stage: { concurrency: 4 },
};

export interface JobRunnerDeps {
  store: JobStore;
  storage: CheckoutStorage;
  checkouts: SourceCheckouts;
  /** pi in production; the mock backend in tests and mock-mode development. */
  agents: AgentRuntime;
  agentDefinitions: AgentResolver;
  /** The MCP servers (with decrypted headers) an agent names in its tools; absent when the installation has no registry. */
  mcpServers?: (ids: readonly string[]) => Promise<McpServerSpec[]>;
  interpreters: Interpreters;
  projectMemory?: ProjectMemory;
  /** The budgets of stages and workflows (and the limits when no sandbox settings are given). */
  defaults?: JobDefaults;
  /** The sandbox settings (limits, read-only marking), read when a run starts; default: the built-in defaults. */
  sandbox?: SandboxProvider;
  /** Where stored spans are sent on to, when an administrator turned the export on (ADR-0074). */
  spanExporter?: SpanExporter;
  /** Hands a write to the document repo writer (queue `document-write`). */
  requestWrite(documentRepositoryId: string, request: DocumentWriteRequest): Promise<void>;
  /** Built-in scripts; defaults to the scripts/ folder of the built-in plugin that has the script. */
  scriptsDir?: string;
  workflowsDir?: string;
  hookFile?: string;
  /** Every registered runner must explicitly choose how stage decisions are persisted. */
  gates: GateDecider;
  /**
   * Fill in what a mock agent job would have written (expected files, structured results);
   * default: when the agent runtime is the mock backend.
   */
  mockOutputs?: boolean;
  log?: (message: string) => void;
}

/** The folders a unit of work (the run itself, or one step of a stage) works in. */
interface StepWorkspace {
  /** The top-level run whose live record gets this step's events. */
  rootId: string;
  stage?: string;
  /** The attempt of that run. */
  attempt: number;
  /** The job workspace: the working directory of every process of the run. */
  root: string;
  /** The folder of this unit: the workspace itself for the run, `steps/<step>/` for a step. */
  dir: string;
  /** WORKSPACE.md, once written. */
  guide?: string;
  asIs?: string;
  toBe?: string;
  in: string;
  out: string;
  tmp: string;
  /** Every repository the run reads, each at its commit (ADR-0052, ADR-0055). */
  sources?: PinnedSource[];
  /** The document-repo commit declared documents are read at (pinned for a whole job, ADR-0033). */
  documentsCommit?: string;
  /** Files an earlier try of this step left in its output folder (document-repo paths). */
  carried?: string[];
  /** The sandbox settings this run started with, and the limits they give (ADR-0055). */
  sandbox: SandboxSettings;
  defaults: JobDefaults;
}

const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** A manifest as `writeManifest` takes it (without the version and the time it stamps itself). */
function withoutStamp(manifest: WorkspaceManifest): Omit<WorkspaceManifest, "version" | "updatedAt"> {
  const { version: _version, updatedAt: _updatedAt, ...rest } = manifest;
  return rest;
}

/** Files of a checkout, as git lists them; undefined when it cannot be counted. */
async function countFiles(dir: string): Promise<number | undefined> {
  try {
    const { stdout } = await runGit(["-C", dir, "ls-files", "-z"]);
    return stdout === "" ? 0 : stdout.split("\0").length - 1;
  } catch {
    return undefined;
  }
}

/** The repositories a run reads: its list, else the one repository a run recorded before the list existed. */
function sourcesOf(run: JobRun): SourceRepo[] {
  if (run.sources !== undefined && run.sources.length > 0) return run.sources;
  return run.sourceRepositoryId === undefined ? [] : [{ repositoryId: run.sourceRepositoryId, ...(run.sourceCommit === undefined ? {} : { commit: run.sourceCommit }) }];
}
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** inputs.scope of a scoped run: catalog item ids (or units) and their files, the design set of a design run, the target repository and merge request of a review run; undefined when absent or malformed. */
export function scopeOf(inputs: Record<string, unknown>): StageScope | undefined {
  const scope = inputs["scope"];
  if (!isRecord(scope) || !Array.isArray(scope["items"])) return undefined;
  const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);
  const mr = scope["mr"];
  const request = isRecord(mr) && typeof mr["url"] === "string" && typeof mr["commit"] === "string" ? { url: mr["url"], commit: mr["commit"], ...(typeof mr["branch"] === "string" && mr["branch"] !== "" ? { branch: mr["branch"] } : {}) } : undefined;
  return {
    items: strings(scope["items"]),
    files: strings(scope["files"]),
    ...(typeof scope["set"] === "string" ? { set: scope["set"] } : {}),
    ...(typeof scope["target"] === "string" ? { target: scope["target"] } : {}),
    ...(request === undefined ? {} : { mr: request }),
  };
}

interface StepOutcome {
  summary: Record<string, unknown>;
  /** `<agent>@<version>` of the last agent that contributed. */
  agent?: string;
  /** Provenance of the files in out/, by path. */
  provenance: Map<string, Provenance>;
  /** Structured result (workflow agent calls, agent steps with a schema). */
  result?: unknown;
  /** A script's standard output (bounded, redacted). */
  stdout?: string;
  /** Agent jobs a workflow started. */
  agents?: number;
  /** What a stage wrote for the pull request description (ADR-0054), read before its work area is removed. */
  description?: string;
}

/** A failed script step, with the end of its error output (redacted) for a repair job. */
class ScriptFailure extends JobFailure {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message);
  }
}

/** Where a child run takes its inputs from and where its outputs go. */
interface ChildPlacement {
  inputs: readonly string[];
  out: string;
  work?: string;
  intermediate?: boolean | readonly string[];
  /** The step's key in the plan; names its folder in the workspace and lets it keep its output when it fails. */
  key?: string;
}

const BUILTIN_SCRIPT = /^[a-z][a-z0-9_-]{0,63}\.(py|js|mjs)$/;
const MAX_STDOUT = 20_000;
const MAX_DETAIL_LINES = 40;
/** Files of one declared document folder ("01-standards/", a half of an application) a step gets at most. */
const MAX_FOLDER_DOCUMENTS = 5000;
/** A relative document-repo path without traversal. */
const SAFE_OUTPUT_PATH = /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[A-Za-z0-9._/-]+$/;
const MAX_RESTRICTED_FILES = 100;
/** The most of a stage's description that goes into a pull request (ADR-0054). */
const MAX_DESCRIPTION_CHARS = 60_000;
const MAX_RESTRICTED_BYTES = 1024 * 1024;

/** Appended to an agent's task when the output checks flagged its files: what to fix, never the offending content. */
const outputFixNote = (findings: readonly string[]): string =>
  `\n\nThe output checks rejected the files you wrote (rule at path:line, paths relative to the output directory):\n${findings.map((finding) => `- ${finding}`).join("\n")}\n` +
  "Open each of those files with edit and fix the cited lines. " +
  "Change only what was flagged, check every other line of those files for the same problem, then stop.";

/** Appended to an agent's task when files it had to write are missing: the exact paths, and what it wrote instead (names only). */
const missingFilesNote = (missing: readonly string[], written: readonly string[]): string =>
  `\n\nThe step needs these files, and they are not in the output directory:\n${missing.map((path) => `- ${path}`).join("\n")}\n` +
  `What you wrote so far (paths relative to the output directory): ${written.length === 0 ? "nothing" : written.slice(0, 30).join(", ")}.\n` +
  "write and edit take paths relative to the output directory, not to the repository: give the full path above, never a bare file name. " +
  "Write each missing file at exactly that path (reuse what you already wrote), then stop.";

/** Appended to an agent's task when its structured result is missing or not JSON: where it goes, never what was in it. */
const resultFileNote = (problem: string, written: readonly string[], schema?: unknown): string => {
  const example = exampleOf(schema);
  return (
    `\n\nThe step needs your structured result and ${problem}. ` +
    `What you wrote so far (paths relative to the output directory): ${written.length === 0 ? "nothing" : written.slice(0, 30).join(", ")}.\n` +
    `Call the ${RESULT_TOOL} tool with the result as its arguments, then stop.` +
    (example === undefined ? "" : ` The arguments are one object with these top-level properties, not wrapped in another key and not a report; replace the placeholder values: ${example}`)
  );
};

/** Appended to an agent's task when an earlier try of the step left files in its output folder: names only, never content. */
const carriedNote = (paths: readonly string[]): string =>
  paths.length === 0
    ? ""
    : `\n\nAn earlier try of this step stopped before it finished. The files it wrote are already in your output directory (paths relative to it): ${paths.slice(0, 40).join(", ")}${paths.length > 40 ? ` and ${paths.length - 40} more` : ""}. ` +
      "They have not been checked, and you cannot read them. Write the files that are still missing; rewrite one only if you are not sure it was finished.";

const sha256 = (content: Buffer): string => createHash("sha256").update(content).digest("hex");

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A recordable reason: JobFailure messages are safe by construction; anything else is redacted. */
const reasonOf = (error: unknown): string => (error instanceof JobFailure ? error.message : redactText(message(error)).slice(0, 1000));

const isInside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

const MAX_EVENT_TEXT = 300;

/**
 * One line for an agent tool call: the tool and where it looked or wrote, relative to the job
 * workspace. Never the content (write carries file content and edit the replaced text; only the path is kept).
 */
export function summarizeToolCall(tool: string, input: unknown, roots: Record<string, string | undefined>): string {
  const args = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const shown = (value: unknown): string | undefined => {
    if (typeof value !== "string" || value.trim() === "") return undefined;
    for (const [label, root] of Object.entries(roots)) {
      if (root === undefined) continue;
      const full = resolve(root, value);
      if (isAbsolute(value) && full === resolve(root)) return label;
      if (isAbsolute(value) && isInside(root, full)) return `${label}/${relative(root, full).split(sep).join("/")}`;
    }
    return isAbsolute(value) ? "(outside the workspace)" : value;
  };
  const parts = [tool];
  const path = shown(args["path"]);
  if (path !== undefined) parts.push(path);
  if ((tool === "grep" || tool === "find") && typeof args["pattern"] === "string") parts.push(`"${args["pattern"].slice(0, 80)}"`);
  const firstLine = (text: string, ignoreComments: boolean): { line: string; more: boolean } | undefined => {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "" && !(ignoreComments && line.startsWith("//")));
    return lines[0] === undefined ? undefined : { line: lines[0].slice(0, 100), more: lines.length > 1 };
  };
  // What the command or script is after, redacted with the rest of the line. A codemode script only reads (the
  // kernel blocks anything else), shell and git are the model's own words about what it runs.
  if (tool === "codemode" && typeof args["code"] === "string") {
    const first = firstLine(args["code"], true);
    if (first !== undefined) parts.push(`${first.line}${first.more ? " …" : ""}`);
  } else if (tool === "shell" && typeof args["command"] === "string") {
    const first = firstLine(args["command"], false);
    if (first !== undefined) parts.push(`${first.line}${first.more ? " …" : ""}`);
  } else if (tool === "git" && Array.isArray(args["args"])) {
    parts.push(args["args"].filter((arg): arg is string => typeof arg === "string").join(" ").slice(0, 100));
  } else if (tool.startsWith("mcp__")) {
    // Scalar arguments only, as name=value, so a query is visible and a document body is not.
    const scalars = Object.entries(args)
      .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
      .slice(0, 3)
      .map(([name, value]) => `${name}=${String(value).slice(0, 40)}`);
    if (scalars.length > 0) parts.push(scalars.join(" "));
  }
  return redactText(parts.join(" ")).slice(0, MAX_EVENT_TEXT);
}

export class JobRunner {
  readonly #deps: JobRunnerDeps;
  readonly #defaults: JobDefaults;
  readonly #log: (message: string) => void;

  constructor(deps: JobRunnerDeps) {
    this.#deps = deps;
    this.#defaults = deps.defaults ?? DEFAULT_JOB_LIMITS;
    this.#log = deps.log ?? ((line) => console.log(`[jobs] ${line}`));
  }

  /**
   * Runs a queued job run: the next attempt of the job (ADR-0055). A run in any other status is left alone. Never
   * throws for a failing job. What the attempt needs is provisioned (and kept when an earlier attempt made it);
   * when it ends, the checkouts go unless the job failed and can be retried.
   */
  async run(id: string, signal?: AbortSignal): Promise<JobRun | undefined> {
    const { store, storage, checkouts } = this.#deps;
    const run = await store.get(id);
    if (run === undefined || run.status !== "queued") return run;
    // A run cancelled while it waited in the queue is not started.
    if (!(await store.start(id))) return store.get(id);
    const paths = storage.job(id);
    const sandbox = await (this.#deps.sandbox ?? defaultSandbox)().catch(() => DEFAULT_SANDBOX);
    const ws: StepWorkspace = { ...(run.kind === "stage" ? { stage: run.name } : {}), rootId: id, attempt: run.attempt, root: paths.root, dir: paths.root, in: paths.docs, out: paths.out, tmp: paths.tmp, sandbox, defaults: limitsWith(this.#defaults, sandbox) };
    await this.#event(ws, undefined, "status", `${run.kind} ${run.name} started${run.attempt > 1 ? ` (attempt ${run.attempt})` : ""}`, { status: "running", attempt: run.attempt });
    let manifest: WorkspaceManifest | undefined;
    let ended: "succeeded" | "failed" | "cancelled" = "failed";
    try {
      const provisioned = await this.#provision(run, ws, paths);
      manifest = provisioned.manifest;
      const outcome = await this.#step(run, ws, signal, provisioned.ledger);
      const { summary } = await this.#finish(run, ws, outcome);
      const write = run.inputs["publishOutput"] === false ? undefined : await this.#publish(run, ws, outcome);
      await store.succeed(id, { ...summary, ...(write === undefined ? {} : { documentWriteId: write }) });
      ended = "succeeded";
      await this.#event(ws, undefined, "status", `succeeded${write === undefined ? "" : ", output handed to the document repo writer"}`, { status: "succeeded" });
      this.#log(`${run.kind} ${run.name} (${id}) succeeded${write === undefined ? "" : `, document write ${write}`}`);
    } catch (error) {
      if (isCancelled(signal)) {
        ended = "cancelled";
        await store.cancel(id).catch(() => undefined);
        await this.#event(ws, undefined, "status", "cancelled", { status: "cancelled" });
        this.#log(`${run.kind} ${run.name} (${id}) cancelled`);
      } else {
        const reason = reasonOf(error);
        // A failed stage keeps its steps, so a retry can skip them (the ledger has the details, ADR-0055).
        const summary = error instanceof StageFailure ? { ...error.outcome, ...(ws.documentsCommit === undefined ? {} : { documentsCommit: ws.documentsCommit }) } : undefined;
        await store.fail(id, reason, summary).catch(() => undefined);
        await this.#event(ws, undefined, "status", `failed: ${reason}`, { status: "failed" });
        this.#log(`${run.kind} ${run.name} (${id}) failed: ${reason}`);
        if (error instanceof ScriptFailure) this.#log(`${id.slice(0, 8)} script output:\n${error.detail}`);
        if (error instanceof Error && error.stack !== undefined) this.#log(`${id.slice(0, 8)} stack:\n${redactText(error.stack).slice(0, 4000)}`);
      }
    } finally {
      await removeTree(paths.tmp).catch(() => undefined);
      if (manifest !== undefined) {
        const settled = { ...manifest, state: ended === "succeeded" ? ("published" as const) : ("parked" as const) };
        // A job that failed keeps its checkouts for a retry (the sweep drops them later); any other end drops them now.
        if (ended === "failed") await writeManifest(paths.manifest, withoutStamp(settled)).catch(() => undefined);
        else await dropCheckouts(checkouts, paths, settled).catch(() => undefined);
      } else {
        await removeTree(paths.steps).catch(() => undefined);
      }
    }
    return store.get(id);
  }

  /**
   * Makes the workspace ready for this attempt: pins the sources, mounts the ones that are not mounted at their
   * commit, builds the documents, writes the guide and opens the ledger. Safe to repeat: a retry finds most of it done.
   */
  async #provision(run: JobRun, ws: StepWorkspace, paths: JobPaths): Promise<{ manifest: WorkspaceManifest; ledger: Ledger }> {
    const { store, checkouts } = this.#deps;
    let previous = await readManifest(paths.manifest);
    // A retry from scratch discards what the job kept, once.
    const fresh = run.inputs["fresh"] === true && previous?.freshApplied !== run.attempt;
    if (fresh) {
      for (const dir of [paths.out, paths.work, paths.state, paths.steps, paths.docs]) await removeTree(dir).catch(() => undefined);
      if (previous !== undefined) {
        const { documentsFor: _documentsFor, ...kept } = previous;
        previous = kept;
      }
    }
    for (const dir of [paths.out, paths.docs, paths.tmp, paths.state]) await mkdir(dir, { recursive: true });

    // Every repository at its pinned commit, else at its current one (recorded so a retry reads the same).
    const requested = sourcesOf(run);
    const sources: PinnedSource[] = [];
    const skipped: string[] = [];
    for (const source of requested) {
      try {
        sources.push({ repositoryId: source.repositoryId, commit: source.commit ?? (await checkouts.resolve(source.repositoryId)), role: sourceRole(source) });
      } catch (error) {
        // The legacy code is what a job is about and fails it; the to-be is a reference, and a target repository that is
        // empty, not synced yet or gone is left out, with a line in the log.
        if (sourceRole(source) === "legacy") throw error;
        skipped.push(source.repositoryId);
        await this.#event(ws, undefined, "log", `to-be repository ${source.repositoryId} is left out: ${reasonOf(error)}`);
      }
    }
    if (requested.some((source) => source.commit === undefined) || skipped.length > 0) await store.update(run.id, { sources });
    if (sources.length > 0) {
      run.sources = sources;
      run.sourceCommit = (legacySources(sources)[0] ?? sources[0])!.commit;
      ws.sources = sources;
    }
    const pinned = run.inputs["documentsCommit"];
    const documentsCommit = typeof pinned === "string" && COMMIT.test(pinned) ? pinned : previous?.documentsCommit;
    if (documentsCommit !== undefined) ws.documentsCommit = documentsCommit;

    const base = (): Omit<WorkspaceManifest, "version" | "updatedAt"> => ({
      jobId: run.id,
      attempt: run.attempt,
      state: "running",
      sources,
      ...(ws.documentsCommit === undefined ? {} : { documentsCommit: ws.documentsCommit }),
      ...(previous?.documentsFor === undefined ? {} : { documentsFor: previous.documentsFor }),
      ...(fresh ? { freshApplied: run.attempt } : previous?.freshApplied === undefined ? {} : { freshApplied: previous.freshApplied }),
    });
    // The manifest comes first: whatever happens while mounting, the workspace says what it was built for.
    let manifest = await writeManifest(paths.manifest, base());
    await mountSources(checkouts, paths, legacySources(sources), { readOnly: ws.sandbox.markReadOnly });
    for (const target of targetSources(sources)) {
      try {
        await mountSources(checkouts, paths, [target], { readOnly: ws.sandbox.markReadOnly });
      } catch (error) {
        sources.splice(sources.indexOf(target), 1);
        await this.#event(ws, undefined, "log", `to-be repository ${target.repositoryId} is left out: ${reasonOf(error)}`);
      }
    }
    if (sources.length !== manifest.sources.length) {
      await store.update(run.id, { sources });
      run.sources = sources;
      ws.sources = sources;
      manifest = await writeManifest(paths.manifest, base());
    }
    if (legacySources(sources).length > 0) ws.asIs = paths.asIs;
    if (targetSources(sources).length > 0) ws.toBe = paths.toBe;

    const built = !fresh && manifest.documentsFor !== undefined && manifest.documentsFor === ws.documentsCommit;
    const declared = await this.#prepareInputs(run, ws, { build: !built });
    if (declared && ws.documentsCommit !== undefined && manifest.documentsFor !== ws.documentsCommit) {
      previous = { ...(previous ?? manifest), documentsFor: ws.documentsCommit };
      manifest = await writeManifest(paths.manifest, base());
    }

    const ledger = await Ledger.open(paths.ledger);
    if (fresh) await ledger.reset();
    await this.#writeGuide(run, ws, paths, ledger);
    return { manifest, ledger };
  }

  /** WORKSPACE.md for this attempt: the layout, the repositories, and what earlier attempts left and read. */
  async #writeGuide(run: JobRun, ws: StepWorkspace, paths: JobPaths, ledger: Ledger): Promise<void> {
    const sources: GuideSource[] = [];
    for (const source of ws.sources ?? []) sources.push({ ...source, path: mountFolder(source), ...(await countFiles(mountPath(paths, source)).then((files) => (files === undefined ? {} : { files }))) });
    const entries = ledger.entries();
    await writeAtomically(
      paths.guide,
      renderGuide({
        jobId: run.id,
        attempt: run.attempt,
        job: `${run.kind} ${run.name}`,
        ...(run.applicationId === undefined ? {} : { applicationId: run.applicationId }),
        sources,
        ...(ws.documentsCommit === undefined ? {} : { documentsCommit: ws.documentsCommit }),
        history: {
          succeeded: entries.filter(([, entry]) => entry.status === "succeeded").length,
          failed: entries.flatMap(([key, entry]) => (entry.status === "failed" ? [{ key, reason: entry.reason ?? "failed" }] : [])),
        },
      }),
    );
    ws.guide = paths.guide;
  }

  /** Appends to the top-level run's live record (best effort; texts are redacted). */
  async #event(ws: StepWorkspace, stepId: string | undefined, kind: JobEventKind, message: string, data?: Record<string, unknown>): Promise<void> {
    // The same line goes to the console, so an exported log carries the whole run, not only its start and end.
    const scope = `${ws.rootId.slice(0, 8)}#${ws.attempt}${stepId === undefined ? "" : `/${stepId.slice(0, 8)}`}`;
    this.#log(`${scope} ${kind}: ${redactText(message).slice(0, 1000)}${data === undefined ? "" : ` ${redactText(JSON.stringify(data)).slice(0, 500)}`}`);
    await this.#deps.store
      .addEvent({ runId: ws.rootId, attempt: ws.attempt, ...(stepId === undefined ? {} : { stepId }), kind, message: redactText(message).slice(0, 1000), ...(data === undefined ? {} : { data }) })
      .catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // Steps
  // -------------------------------------------------------------------------

  /** A path in the workspace as the job's processes see it: relative to the workspace root, with `/` separators. */
  #relative(ws: StepWorkspace, path: string): string {
    return relative(ws.root, path).split(sep).join("/");
  }

  #placeholders(run: JobRun, ws: StepWorkspace): Placeholders {
    const legacy = legacySources(ws.sources ?? []);
    return {
      in: this.#relative(ws, ws.in),
      out: this.#relative(ws, ws.out),
      tmp: this.#relative(ws, ws.tmp),
      ...(ws.asIs === undefined ? {} : { src: this.#relative(ws, ws.asIs) }),
      ...(ws.toBe === undefined ? {} : { tobe: this.#relative(ws, ws.toBe) }),
      ...(legacy.length === 0 ? {} : { sources: sourceSpec(legacy) }),
      ...(run.applicationId === undefined ? {} : { app: run.applicationId }),
    };
  }

  #limits(run: JobRun, ws: StepWorkspace, kind: "script" | "agent"): StepLimits {
    return { ...ws.defaults[kind], ...run.limits };
  }

  /**
   * Declared document-repo files are copied into in/ from the pinned commit (the default branch tip when the job
   * first reads one): inputs.documents, and for a stage its plan's documents, prerequisites and optional inputs.
   * Missing ones are skipped, except a stage's prerequisites; an entry ending in "/" is a folder. With `build`
   * false the copies are already there (an earlier attempt made them) and only the prerequisites are checked.
   * Returns whether any document is declared.
   */
  async #prepareInputs(run: JobRun, ws: StepWorkspace, options: { build?: boolean } = {}): Promise<boolean> {
    const build = options.build ?? true;
    const plan = run.kind === "stage" ? STAGES[run.name] : undefined;
    const declared = run.inputs["documents"];
    const entries = [
      ...(Array.isArray(declared) ? declared.filter((entry): entry is string => typeof entry === "string") : []),
      ...(plan?.documents ?? []),
      ...(plan?.requires ?? []).map((entry) => entry.path),
      ...(plan?.optional ?? []).map((entry) => entry.path),
    ];
    if (entries.length > 0) {
      const repository = build ? await this.#deps.store.documentRepository(run.projectId) : undefined;
      if (repository !== undefined) {
        const { checkouts } = this.#deps;
        // Every step of a run reads the same document-repo commit: pinned by the run, else the
        // default branch tip when the run first reads one.
        const commit = ws.documentsCommit ?? (await checkouts.resolve(repository));
        ws.documentsCommit = commit;
        const values = this.#placeholders(run, ws);
        for (const entry of new Set(entries.map((item) => fill(item, values)))) {
          const paths = entry.endsWith("/") ? ((await checkouts.listDocuments?.(repository, commit, entry)) ?? []).slice(0, MAX_FOLDER_DOCUMENTS) : [entry];
          for (const path of paths) {
            const content = await checkouts.readDocument(repository, commit, path);
            if (content === undefined) continue;
            const dest = join(ws.in, ...path.split("/"));
            await mkdir(dirname(dest), { recursive: true });
            await rm(dest, { force: true });
            await writeFile(dest, content, "utf8");
          }
        }
      }
      for (const prerequisite of plan?.requires ?? []) {
        const path = fill(prerequisite.path, this.#placeholders(run, ws));
        const present = await lstat(join(ws.in, ...path.split("/"))).then(
          () => true,
          () => false,
        );
        if (!present) {
          throw new JobFailure(
            `${path} is not on the default branch of the document repository: run the ${prerequisite.stage} stage first and merge its pull request, then run ${run.name} again`,
          );
        }
      }
    }
    if (build && ws.sandbox.markReadOnly) await makeReadOnly(ws.in);
    return entries.length > 0;
  }

  async #step(run: JobRun, ws: StepWorkspace, signal?: AbortSignal, ledger?: Ledger): Promise<StepOutcome> {
    switch (run.kind) {
      case "script":
        return this.#script(run, ws, signal);
      case "agent":
        return this.#agent(run, ws, signal);
      case "workflow":
        return this.#workflow(run, ws, signal);
      case "stage":
        return this.#stage(run, ws, signal, ledger);
    }
  }

  /** The script file: a built-in script by name, or a model-written one among the inputs (inputs.scriptFromInputs). */
  #scriptFile(run: JobRun, ws: StepWorkspace): string {
    const fromInputs = run.inputs["scriptFromInputs"];
    if (typeof fromInputs === "string") {
      const relativePath = fill(fromInputs, this.#placeholders(run, ws));
      const file = resolve(ws.in, ...relativePath.split("/"));
      if (!isInside(ws.in, file) || !BUILTIN_SCRIPT.test(file.split(sep).at(-1) ?? "")) throw new JobFailure(`Invalid input script "${relativePath}"`);
      return file;
    }
    if (!BUILTIN_SCRIPT.test(run.name)) throw new JobFailure(`Invalid script name "${run.name}"`);
    if (this.#deps.scriptsDir !== undefined) return join(this.#deps.scriptsDir, run.name);
    const file = findBuiltinFile("scripts", run.name);
    if (file === undefined) throw new JobFailure(`No built-in plugin has a script "${run.name}"`);
    return file;
  }

  /** A document-repo path of the step's inputs (expects, resultTo, stdoutTo), filled and checked. */
  #outputPath(run: JobRun, ws: StepWorkspace, value: unknown, field: string): string {
    const path = typeof value === "string" ? fill(value, this.#placeholders(run, ws)) : "";
    if (!SAFE_OUTPUT_PATH.test(path)) throw new JobFailure(`inputs.${field} is not a relative document-repo path`);
    return path;
  }

  #expects(run: JobRun, ws: StepWorkspace): string[] {
    const expects = run.inputs["expects"];
    return Array.isArray(expects) ? expects.map((entry) => this.#outputPath(run, ws, entry, "expects")) : [];
  }

  /** The expected files that are not in out/ (document-repo paths). */
  async #missingExpected(run: JobRun, ws: StepWorkspace): Promise<string[]> {
    const missing: string[] = [];
    for (const path of this.#expects(run, ws)) {
      const stat = await lstat(join(ws.out, ...path.split("/"))).catch(() => undefined);
      if (stat?.isFile() !== true) missing.push(path);
    }
    return missing;
  }

  /**
   * An agent that wrote an expected file under the right name but in the wrong folder (a bare
   * "assessment.md" for "10-applications/<app>/01-legacy/assessment.md") keeps its work: the stray file with
   * the missing file's name (the best path match when several) is moved into place. A file under another name is
   * never guessed (it may be notes): that is the repair attempt's job. Returns whether files are still missing.
   */
  async #recoverExpected(run: JobRun, ws: StepWorkspace, stepId: string | undefined): Promise<boolean> {
    const missing = await this.#missingExpected(run, ws);
    if (missing.length === 0) return false;
    const expected = new Set(this.#expects(run, ws));
    const stray = (await listFiles(ws.out)).filter((entry) => !expected.has(entry.path) && !entry.path.startsWith("restricted/") && basename(entry.path) !== RESULT_FILE);
    const moveInto = async (entry: (typeof stray)[number], path: string): Promise<void> => {
      const target = join(ws.out, ...path.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await rename(entry.full, target);
      stray.splice(stray.indexOf(entry), 1);
      await this.#event(ws, stepId, "log", `${run.name} wrote ${entry.path} instead of ${path}: moved into place`);
    };
    // Same name: the only one, or, among several (an index.md per folder), the one whose path ends most like the expected path.
    const sharedSuffix = (a: string, b: string): number => {
      const left = a.split("/").reverse();
      const right = b.split("/").reverse();
      let count = 0;
      while (count < left.length && count < right.length && left[count] === right[count]) count += 1;
      return count;
    };
    for (const path of missing) {
      const candidates = stray.filter((entry) => basename(entry.path) === basename(path));
      const ranked = candidates.map((entry) => ({ entry, score: sharedSuffix(entry.path, path) })).sort((a, b) => b.score - a.score);
      const [best, next] = ranked;
      if (best === undefined || (next !== undefined && next.score === best.score)) continue;
      await moveInto(best.entry, path);
    }
    return (await this.#missingExpected(run, ws)).length > 0;
  }

  /** Fails the step when a file it must write is missing. */
  async #checkExpected(run: JobRun, ws: StepWorkspace, what: string): Promise<void> {
    const missing = await this.#missingExpected(run, ws);
    if (missing.length > 0) throw new JobFailure(`${what} did not write ${missing.join(", ")}`);
  }

  async #script(run: JobRun, ws: StepWorkspace, signal?: AbortSignal): Promise<StepOutcome> {
    const file = this.#scriptFile(run, ws);
    const values = this.#placeholders(run, ws);
    const rawArgs = run.inputs["args"];
    if (rawArgs !== undefined && !(Array.isArray(rawArgs) && rawArgs.every((arg) => typeof arg === "string"))) throw new JobFailure("inputs.args must be a list of strings");
    const args = ((rawArgs ?? []) as string[]).map((arg) => fill(arg, values));
    const limits = this.#limits(run, ws, "script");
    const result = await runScript({
      file,
      args,
      workspace: { cwd: ws.root, readOnly: [...(ws.asIs === undefined ? [] : [ws.asIs]), ...(ws.toBe === undefined ? [] : [ws.toBe]), ws.in], writable: [ws.out, ws.tmp], tmp: ws.tmp, out: ws.out },
      limits: { timeoutSec: limits.timeoutSec, maxOutputBytes: limits.maxOutputBytes },
      interpreters: this.#deps.interpreters,
      ...(signal === undefined ? {} : { signal }),
    });
    await this.#deps.store.update(run.id, { scriptHash: result.sha256 });
    if (result.failure !== undefined) {
      const output = [result.stderr, result.stdout].map((text) => text.trim()).filter((text) => text !== "");
      const detail = redactText(output.join("\n").split(/\r?\n/).slice(-MAX_DETAIL_LINES).join("\n")).slice(-4000);
      throw new ScriptFailure(`Script ${run.name} ${result.failure}`, detail === "" ? result.failure : detail);
    }
    const stdout = redactText(result.stdout.slice(-MAX_STDOUT));
    if (run.inputs["stdoutTo"] !== undefined) {
      const target = join(ws.out, ...this.#outputPath(run, ws, run.inputs["stdoutTo"], "stdoutTo").split("/"));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, stdout, "utf8");
    }
    await this.#checkExpected(run, ws, `Script ${run.name}`);
    const provenance: Provenance = { origin: "tool", assetVersion: `${run.name}@sha256:${result.sha256}` };
    const files = await listFiles(ws.out);
    return {
      summary: { script: run.name, scriptHash: result.sha256, durationMs: result.durationMs },
      provenance: new Map(files.map((entry) => [entry.path, provenance])),
      stdout,
    };
  }

  async #agent(run: JobRun, ws: StepWorkspace, signal?: AbortSignal): Promise<StepOutcome> {
    const definition = await materializeSkillFiles(await this.#deps.agentDefinitions.definition(run.name), ws.in, { readOnly: ws.sandbox.markReadOnly });
    const expectedAgentVersion = run.inputs["expectedAgentVersion"];
    if (expectedAgentVersion !== undefined) {
      if (typeof expectedAgentVersion !== "string" || expectedAgentVersion.trim() === "") {
        throw new JobFailure("inputs.expectedAgentVersion must be a non-empty version string");
      }
      if (definition.version !== expectedAgentVersion) {
        throw new JobFailure("Agent " + run.name + " has version " + definition.version + ", expected agent version " + expectedAgentVersion);
      }
    }
    const mock = this.#deps.agents.engine.startsWith("mock");
    const binding = (await this.#deps.store.modelBinding(run.name, run.projectId)) ?? (mock ? { provider: "mock", model: "mock" } : undefined);
    if (binding === undefined) throw new JobFailure(`No model is bound to agent "${run.name}" (Settings → LLM Providers)`);
    const task = run.inputs["task"];
    if (typeof task !== "string" || task.trim() === "") throw new JobFailure("inputs.task is missing");
    const limits = this.#limits(run, ws, "agent");
    const agentId = `${definition.id}@${definition.version}`;
    // The MCP servers the agent names in its tools: resolved here, where the registry and its secrets are, and handed to the job's child.
    const mcpIds = mcpServersNamedBy(definition.tools);
    let mcp: JobSpec["mcp"];
    if (mcpIds.length > 0) {
      if (this.#deps.mcpServers === undefined) throw new JobFailure(`Agent ${run.name} names MCP servers (${mcpIds.join(", ")}) but this worker has no MCP registry`);
      try {
        mcp = { servers: await this.#deps.mcpServers(mcpIds) };
      } catch (error) {
        throw new JobFailure(`Agent ${run.name}: ${redactText(message(error)).slice(0, 300)}`);
      }
    }
    const thinking = (THINKING_LEVELS as readonly string[]).includes(binding.thinking ?? "") ? (binding.thinking as ThinkingLevel) : undefined;
    await this.#deps.store.update(run.id, { agent: agentId });

    const schema = run.inputs["schema"];
    const schemaNote =
      typeof schema === "object" && schema !== null
        ? `\n\nReport your result by calling the ${RESULT_TOOL} tool, once, when the work is done: its arguments are the result, and the tool refuses one that does not fit (read the reason and call it again). Do not write the result to a file.`
        : "";
    const memoryContext = this.#memoryContext(run, ws);
    const memoryTools = !definition.tools.includes("read") ? [] : MEMORY_TOOL_NAMES.filter((name) => !["memory_write","memory_forget","memory_restore","scratchpad"].includes(name) || definition.tools.includes("write"));
    const grantedMemoryTools = memoryContext?.reviewedOnly ? memoryTools.filter((name) => ["memory_search","memory_read","memory_status"].includes(name)) : memoryTools;
    const memoryEnabled = memoryContext !== undefined && grantedMemoryTools.length > 0 && (await this.#deps.projectMemory!.status(memoryContext,false)).enabled;
    const memoryUsage = { searches: 0, reads: 0, writes: 0, status: 0, forgets: 0, restores: 0, scratchpad: 0 };
    const services: JobServices = !memoryEnabled ? {} : { memory: this.#memoryService(ws, { ...memoryContext!, agent: agentId }) };
    const spec: JobSpec = {
      agent: !memoryEnabled ? definition : { ...definition, tools: [...definition.tools, ...grantedMemoryTools] },
      ...(memoryEnabled ? { memory: grantedMemoryTools.includes("memory_write") ? { writeSchema: MEMORY_WRITE_SCHEMA } : {} } : {}),
      task: fill(task, this.#placeholders(run, ws)) + schemaNote + carriedNote(ws.carried ?? []),
      model: { provider: binding.provider, id: binding.model, ...(thinking === undefined ? {} : { thinking }) },
      ...(typeof schema === "object" && schema !== null ? { resultSchema: schema as Record<string, unknown> } : {}),
      // Reads are confined to the checkouts, the inputs and the guide, writes to the output folder (kernel path guard).
      // The first entry is where a search without a path looks: the as-is code, else the inputs.
      workspace: {
        root: ws.root,
        readOnly: [...(ws.asIs === undefined ? [] : [ws.asIs]), ...(ws.toBe === undefined ? [] : [ws.toBe]), ws.in, ...(ws.guide === undefined ? [] : [ws.guide])],
        outDir: ws.out,
      },
      limits: {
        timeoutSec: limits.timeoutSec,
        idleTimeoutSec: ws.sandbox.agentIdleTimeoutSec,
        ...(limits.maxTurns === undefined ? {} : { maxTurns: limits.maxTurns }),
        ...(limits.maxCostUsd === undefined ? {} : { maxCostUsd: limits.maxCostUsd }),
      },
      ...(mcp === undefined ? {} : { mcp }),
      metadata: { jobRunId: run.id, projectId: run.projectId, ...(run.applicationId === undefined ? {} : { applicationId: run.applicationId }) },
    };
    const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0, toolCalls: 0, blocked: 0, cacheReadTokens: 0, cacheWriteTokens: 0, compactions: 0 };
    const stepId = run.id === ws.rootId ? undefined : run.id;
    const roots = { "as-is": ws.asIs, "to-be": ws.toBe, in: ws.in, out: ws.out };
    // The job's spans (ADR-0048) are stored in batches as they arrive; each run of the agent is an attempt.
    let attempts = 0;
    let spans: SpanRecord[] = [];
    const flushSpans = async (): Promise<void> => {
      const batch = spans;
      spans = [];
      await this.#deps.store.addSpans(batch);
      // Not awaited: a slow backend must not slow the job (ADR-0074).
      void this.#deps.spanExporter?.export(batch);
    };
    const attempt = async (task: string = spec.task): Promise<Extract<JobEvent, { type: "job.completed" | "job.failed" }>> => {
      attempts += 1;
      const handle = await this.#deps.agents.startJob({ ...spec, task }, services);
      // Why it is stopped: a person cancelled the run, a sibling of its group failed, or the worker is stopping.
      const stoppedFor = (): string => (isCancelled(signal) ? "cancelled" : signal?.reason instanceof Error && signal.reason.message.startsWith("another step of the group failed") ? "another step of its group failed" : "the worker is stopping");
      const onAbort = (): void => void handle.abort(stoppedFor());
      if (signal?.aborted === true) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
      try {
        for await (const event of handle.events) {
          this.#count(event, usage);
          if (event.type === "span") {
            spans.push({
              runId: ws.rootId,
              ...(stepId === undefined ? {} : { stepId }),
              projectId: run.projectId,
              ...(run.applicationId === undefined ? {} : { applicationId: run.applicationId }),
              agent: agentId,
              provider: binding.provider,
              model: binding.model,
              attempt: attempts,
              runAttempt: ws.attempt,
              span: event.span,
            });
            if (spans.length >= 100) await flushSpans();
          } else if (event.type === "progress") {
            const kb = (chars: number): string => (chars < 1000 ? `${chars}` : `${(chars / 1000).toFixed(1)}k`);
            await this.#event(ws, stepId, "log", `model working: turn ${event.turn}, thinking ${kb(event.thinkingChars)} chars, tool arguments ${kb(event.toolArgsChars)}, text ${kb(event.textChars)}`, {
              turn: event.turn,
              thinkingChars: event.thinkingChars,
              toolArgsChars: event.toolArgsChars,
              textChars: event.textChars,
            });
          } else if (event.type === "tool.call") {
            if (event.decision === "allowed") {
              if (event.tool === "memory_search") memoryUsage.searches += 1;
              if (event.tool === "memory_read") memoryUsage.reads += 1;
              if (event.tool === "memory_write") memoryUsage.writes += 1;
              if (event.tool === "memory_status") memoryUsage.status += 1;
              if (event.tool === "memory_forget") memoryUsage.forgets += 1;
              if (event.tool === "memory_restore") memoryUsage.restores += 1;
              if (event.tool === "scratchpad") memoryUsage.scratchpad += 1;
            }
            const line = summarizeToolCall(event.tool, event.input, roots);
            const reason = event.reason === undefined ? "" : ` (${event.reason})`;
            await this.#event(ws, stepId, "tool", event.decision === "blocked" ? `blocked: ${line}${reason}` : line, { tool: event.tool, decision: event.decision });
          }
        }
      } finally {
        signal?.removeEventListener("abort", onAbort);
        await flushSpans();
      }
      const end = await handle.done;
      // The full end of the attempt (the recorded failure reason is cut short).
      this.#log(`${ws.rootId.slice(0, 8)}${stepId === undefined ? "" : `/${stepId.slice(0, 8)}`} agent ${agentId} attempt ${attempts} ${end.type}${end.type === "job.failed" ? ` (${end.reason}): ${redactText(end.error).slice(0, 4000)}` : ""}; usage ${JSON.stringify(usage)}`);
      return end;
    };
    let done = await attempt();
    // A provider that drops its response stalls the job (the launcher's idle watchdog): try once more.
    if (run.inputs["disableStalledRetry"] !== true && done.type === "job.failed" && done.reason === "timeout" && done.error.startsWith("stalled") && signal?.aborted !== true) {
      await this.#event(ws, stepId, "log", `agent ${run.name} stalled (${redactText(done.error).slice(0, 120)}); retrying once`);
      done = await attempt();
    }
    if (done.type === "job.failed") throw new JobFailure(`Agent ${run.name} failed (${done.reason}): ${redactText(done.error).slice(0, 300)}`);
    const writeMock = async (): Promise<void> => {
      if (!(this.#deps.mockOutputs ?? mock)) return;
      await writeMockOutputs({
        out: ws.out,
        ...(ws.asIs === undefined ? {} : { src: ws.asIs }),
        agent: run.name,
        app: run.applicationId ?? run.projectId,
        expects: this.#expects(run, ws),
        ...(run.inputs["resultFile"] === true && typeof schema === "object" && schema !== null ? { schema: schema as Record<string, unknown> } : {}),
        resultFile: RESULT_FILE,
      });
    };
    await writeMock();

    // The output checks (#finish) are fail-closed. An agent that wrote a malformed artifact gets the
    // findings (rule, path, line: never content) and one chance to fix just those lines, in the out/
    // it already wrote.
    const flagged = await this.#flaggedOutput(ws);
    if (flagged !== undefined && signal?.aborted !== true) {
      await this.#event(ws, stepId, "log", `output checks flagged ${flagged.length} finding${flagged.length === 1 ? "" : "s"} in the files of ${run.name}: ${flagged.join("; ")}; asking it to fix them once`);
      done = await attempt(`${spec.task}${outputFixNote(flagged)}`);
      if (done.type === "job.failed") throw new JobFailure(`Agent ${run.name} failed (${done.reason}): ${redactText(done.error).slice(0, 300)}`);
      await writeMock();
    }

    let result: unknown;
    if (run.inputs["resultFile"] === true) {
      const take = async (): Promise<{ ok: true; value: unknown } | { ok: false; missing: boolean; problem: string }> => {
        // The workspace rule asks for full document-repository paths, so a model may put the result in a folder: the
        // root file comes first, then the shallowest folder. The first one that parses and fits the schema is the result.
        const found = (await listFiles(ws.out))
          .filter((entry) => basename(entry.path) === RESULT_FILE && !entry.path.startsWith("restricted/"))
          .sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path));
        let missing = true;
        let problem = `${RESULT_FILE} is not in the output directory`;
        let value: unknown;
        let ok = false;
        for (const entry of found) {
          const text = await readFile(entry.full, "utf8").catch(() => undefined);
          if (text === undefined) continue;
          missing = false;
          try {
            const parsed = unwrapResult(schema, JSON.parse(text) as unknown);
            const wrong = shapeProblem(schema, parsed);
            if (wrong === undefined) {
              value = parsed;
              ok = true;
              break;
            }
            problem = `${RESULT_FILE} does not match the schema (${wrong}; the file has: ${keysOf(parsed)})`;
          } catch {
            problem = `${RESULT_FILE} is not valid JSON`;
          }
        }
        // Taken or not, no copy stays in the output: it is a result, never a document.
        for (const entry of found) await rm(entry.full, { force: true });
        return ok ? { ok: true, value } : { ok: false, missing, problem };
      };
      let taken = await take();
      // One repair attempt, like the missing expected files below: a rerun of the whole job costs far more.
      if (!taken.ok && signal?.aborted !== true) {
        await this.#event(ws, stepId, "log", `agent ${run.name}: ${taken.problem}; asking it to write the result once`);
        const written = (await listFiles(ws.out)).map((entry) => entry.path);
        done = await attempt(`${spec.task}${resultFileNote(taken.problem, written, schema)}`);
        if (done.type === "job.failed") throw new JobFailure(`Agent ${run.name} failed (${done.reason}): ${redactText(done.error).slice(0, 300)}`);
        await writeMock();
        taken = await take();
      }
      if (!taken.ok) throw new JobFailure(`Agent ${run.name} wrote ${taken.missing ? "no" : "an invalid"} ${RESULT_FILE}${taken.missing ? "" : `: ${taken.problem}`}`);
      result = taken.value;
      if (run.inputs["resultTo"] !== undefined) await this.#saveResult(run, ws, result);
    }
    // Missing expected files: a file written under the right name in the wrong folder is moved into place;
    // what is still missing gets the agent one repair attempt (same output directory).
    if ((await this.#recoverExpected(run, ws, stepId)) && signal?.aborted !== true) {
      const missing = await this.#missingExpected(run, ws);
      await this.#event(ws, stepId, "log", `agent ${run.name} did not write ${missing.join(", ")}; asking it to write them once`);
      const written = (await listFiles(ws.out)).map((entry) => entry.path);
      done = await attempt(`${spec.task}${missingFilesNote(missing, written)}`);
      if (done.type === "job.failed") throw new JobFailure(`Agent ${run.name} failed (${done.reason}): ${redactText(done.error).slice(0, 300)}`);
      await writeMock();
      await this.#recoverExpected(run, ws, stepId);
      // The repair run repeats the task, so it may have written the result again: it is already taken, never a document.
      if (run.inputs["resultFile"] === true) {
        for (const entry of await listFiles(ws.out)) if (basename(entry.path) === RESULT_FILE) await rm(entry.full, { force: true });
      }
    }
    await this.#checkExpected(run, ws, `Agent ${run.name}`);
    const provenance: Provenance = { origin: "runtime-agent", runtimeAgent: definition.id, model: `${binding.provider}/${binding.model}`, assetVersion: definition.version };
    const files = await listFiles(ws.out);
    return {
      summary: { agent: agentId, model: `${binding.provider}/${binding.model}`, usage, outcome: done.summary, ...(memoryEnabled ? { memoryTools: memoryUsage } : {}) },
      agent: agentId,
      provenance: new Map(files.filter((entry) => !entry.path.startsWith("restricted/")).map((entry) => [entry.path, provenance])),
      ...(result === undefined ? {} : { result }),
    };
  }

  /** Saves a structured result as JSON at inputs.resultTo in out/. */
  async #saveResult(run: JobRun, ws: StepWorkspace, result: unknown): Promise<void> {
    const target = join(ws.out, ...this.#outputPath(run, ws, run.inputs["resultTo"], "resultTo").split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(result ?? null, null, 2)}\n`, "utf8");
  }

  #count(
    event: JobEvent,
    usage: { inputTokens: number; outputTokens: number; costUsd: number; toolCalls: number; blocked: number; cacheReadTokens: number; cacheWriteTokens: number; compactions: number },
  ): void {
    if (event.type === "usage") {
      usage.inputTokens += event.inputTokens;
      usage.outputTokens += event.outputTokens;
      usage.costUsd += event.costUsd ?? 0;
      usage.cacheReadTokens += event.cacheReadTokens ?? 0;
      usage.cacheWriteTokens += event.cacheWriteTokens ?? 0;
      usage.compactions += event.compactions ?? 0;
    } else if (event.type === "tool.call") {
      usage.toolCalls += 1;
      if (event.decision === "blocked") usage.blocked += 1;
    }
  }

  async #workflow(run: JobRun, ws: StepWorkspace, signal?: AbortSignal): Promise<StepOutcome> {
    const source = await loadWorkflow(run.name, this.#deps.workflowsDir).catch((error: unknown) => {
      throw new JobFailure(`Unknown workflow "${run.name}": ${redactText(message(error)).slice(0, 200)}`);
    });
    const provenance = new Map<string, Provenance>();
    let agent: string | undefined;
    const runAgent = async (prompt: string, options: AgentCallOptions): Promise<{ result?: unknown; tokens: number }> => {
      if (typeof options.agentType !== "string") throw new Error("agent() needs options.agentType");
      const inputs = { task: prompt, ...(options.schema === undefined ? {} : { schema: options.schema, resultFile: true }), ...(options.label === undefined ? {} : { label: options.label }) };
      const child = await this.#child(run, ws, { kind: "agent", name: options.agentType, inputs }, signal);
      if (!child.ok && signal?.aborted === true) throw new JobFailure("aborted");
      if (!child.ok) return { tokens: 0 };
      for (const [path, value] of child.outcome.provenance) provenance.set(path, value);
      agent = child.outcome.agent ?? agent;
      const usage = child.outcome.summary["usage"] as { inputTokens?: number; outputTokens?: number } | undefined;
      return { result: child.outcome.result ?? child.outcome.summary["outcome"] ?? true, tokens: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0) };
    };
    // A stage hands its workflow what is left of the stage's agent budget (inputs.budget.maxAgents).
    const budget = run.inputs["budget"] as { maxAgents?: unknown } | undefined;
    const cap = typeof budget?.maxAgents === "number" && Number.isFinite(budget.maxAgents) ? Math.max(0, Math.floor(budget.maxAgents)) : undefined;
    const budgets = cap === undefined ? ws.defaults.workflow : { ...ws.defaults.workflow, maxAgents: cap };
    const outcome = await runWorkflow({
      source,
      args: run.inputs["args"] ?? {},
      budgets,
      runAgent,
      log: (line) => {
        this.#log(`workflow ${run.name} (${run.id}): ${line}`);
        void this.#event(ws, run.id === ws.rootId ? undefined : run.id, "log", line);
      },
    }).catch((error: unknown) => {
      throw new JobFailure(`Workflow ${run.name} failed: ${redactText(message(error)).slice(0, 500)}`);
    });
    if (run.inputs["resultTo"] !== undefined) {
      await this.#saveResult(run, ws, outcome.result);
      provenance.set(this.#outputPath(run, ws, run.inputs["resultTo"], "resultTo"), { origin: "tool", assetVersion: `workflow:${run.name}` });
    }
    await this.#checkExpected(run, ws, `Workflow ${run.name}`);
    const result = JSON.stringify(outcome.result ?? null);
    return {
      summary: { workflow: run.name, agents: outcome.agents, failedAgents: outcome.failedAgents, tokens: outcome.tokens, result: result.length > 20_000 ? "(too large to keep)" : (JSON.parse(result) as unknown) },
      ...(agent === undefined ? {} : { agent }),
      provenance,
      agents: outcome.agents,
    };
  }

  /** A stage: its plan (stages.ts) run by the generic executor, every leaf step a child run. */
  async #stage(run: JobRun, ws: StepWorkspace, signal?: AbortSignal, ledger?: Ledger): Promise<StepOutcome> {
    const plan = STAGES[run.name];
    if (plan === undefined) throw new JobFailure(`Unknown stage "${run.name}"`);
    const legacy = legacySources(ws.sources ?? []);
    if (run.applicationId === undefined || legacy.length === 0) throw new JobFailure(`Stage ${run.name} needs an application with a legacy repository`);
    const paths = this.#deps.storage.job(ws.rootId);
    const work = paths.work;
    await mkdir(work, { recursive: true });
    const scope = scopeOf(run.inputs);
    const provenance = new Map<string, Provenance>();
    let agent: string | undefined;
    const runLeaf = async (spec: LeafRun, placement: LeafPlacement, groupAbort?: AbortSignal): Promise<LeafResult> => {
      const effective = groupAbort === undefined ? signal : signal === undefined ? groupAbort : AbortSignal.any([signal, groupAbort]);
      const child = await this.#child(run, ws, spec, effective, placement);
      if (!child.ok) return child.detail === undefined ? { id: child.id, ok: false, reason: child.reason } : { id: child.id, ok: false, reason: child.reason, detail: child.detail };
      for (const [path, value] of child.outcome.provenance) provenance.set(path, value);
      agent = child.outcome.agent ?? agent;
      return {
        id: child.id,
        ok: true,
        summary: child.outcome.summary,
        agents: child.outcome.agents ?? 0,
        outputs: child.outputs,
        digest: child.digest,
        ...(child.outcome.stdout === undefined ? {} : { stdout: child.outcome.stdout }),
      };
    };
    const reuse: StepReuse | undefined =
      ledger === undefined
        ? undefined
        : {
            fingerprint: (spec, upstream) => this.#fingerprint(ws, spec, upstream, run),
            settled: async (key, fingerprint) => {
              const entry = ledger.get(key);
              if (entry === undefined || entry.status !== "succeeded" || entry.fingerprint !== fingerprint) return undefined;
              // What it wrote must still be there: a group that failed before its outputs were merged left nothing.
              for (const output of entry.outputs) {
                const stat = await lstat(join(output.zone === "out" ? ws.out : work, ...output.path.split("/"))).catch(() => undefined);
                if (stat?.isFile() !== true) return undefined;
              }
              return { digest: entry.digest };
            },
            record: (key, entry) => ledger.record(key, { ...entry, attempt: ws.attempt, finishedAt: new Date().toISOString() }),
          };
    try {
      const executor = new StagePlanExecutor({
        plan,
        run: { id: run.id, projectId: run.projectId, applicationId: run.applicationId },
        values: { app: run.applicationId, sources: sourceSpec(legacy) },
        // Group members stage their outputs under steps/, beside the folders of the steps.
        dirs: { root: paths.steps, in: ws.in, work, out: ws.out },
        limits: ws.defaults.stage,
        gates: this.#deps.gates,
        runLeaf,
        log: (line, data) => {
          this.#log(`stage ${run.name} (${run.id}): ${line}`);
          return this.#event(ws, undefined, "log", line, data);
        },
        ...(signal === undefined ? {} : { signal }),
        ...(scope === undefined ? {} : { scope }),
        ...(typeof run.inputs["resumeOf"] === "string" ? { resumeOf: run.inputs["resumeOf"] } : {}),
        ...(reuse === undefined || ledger === undefined ? {} : { reuse, gateChoices: ledger.gates(), onGate: (id: string, choice: string) => ledger.recordGate(id, choice) }),
      });
      const outcome = await executor.run();
      const description = await this.#description(plan, run.applicationId, work);
      // work/ goes only when the stage succeeds: a failed job keeps it beside out/ for its next attempt
      // (same retention, cleanup.ts).
      await removeTree(work).catch(() => undefined);
      return {
        summary: {
          ...outcome,
          attempt: ws.attempt,
          ...(ws.documentsCommit === undefined ? {} : { documentsCommit: ws.documentsCommit }),
        },
        ...(agent === undefined ? {} : { agent }),
        ...(description === undefined ? {} : { description }),
        provenance,
      };
    } catch (error) {
      if (isCancelled(signal)) await removeTree(work).catch(() => undefined);
      throw error;
    }
  }

  /**
   * What a step would run with (ledger.ts): its definition by content, its task as the stage filled it, the pinned
   * sources and documents, and the chain of what came before it. A script is not reused, so its definition is not read.
   */
  async #fingerprint(ws: StepWorkspace, spec: LeafRun, upstream: string, root: JobRun): Promise<string> {
    const { budget: _budget, ...inputs } = spec.inputs;
    let definition = "script";
    let memoryCapable = false;
    try {
      if (spec.kind === "agent") {
        const agent = await this.#deps.agentDefinitions.definition(spec.name);
        definition = digestOf(agent);
        memoryCapable = agent.tools.includes("read");
      }
      else if (spec.kind === "workflow") {
        definition = digestOf(await loadWorkflow(spec.name, this.#deps.workflowsDir));
        memoryCapable = true; // A reused workflow could otherwise skip its live-memory agent children.
      }
    } catch {
      definition = "unavailable";
    }
    const pins = { sources: (ws.sources ?? []).map((source) => [sourceRole(source), source.repositoryId, source.commit]), documents: ws.documentsCommit ?? null };
    const context = this.#memoryContext({ ...root, kind: spec.kind === "workflow" ? "agent" : spec.kind, name: spec.name }, ws);
    const liveMemory = memoryCapable && context !== undefined && (await this.#deps.projectMemory!.status(context,false)).enabled;
    // Live lookups are mutable inputs: re-execute participating steps on retry instead of pretending they are cached inputs.
    return digestOf({ kind: spec.kind, name: spec.name, definition, inputs, pins, upstream, ...(liveMemory ? { liveMemory: ["memory-v2", ws.attempt] } : {}) });
  }

  /**
   * Runs one step of a stage or workflow as a child run, in its own folder of the job workspace (`steps/<step>/`):
   * its inputs are a view of the stage's documents, work and output so far (the placement's directories) and the
   * parent's checkouts; its output folder is its own. On success its out/ is merged into the parent's out/; for a
   * stage step, intermediate files go to the placement's work directory instead. An agent step that fails keeps its
   * out/, and the next try of the step, in this attempt or the next, is told what is in it.
   */
  async #child(
    parent: JobRun,
    parentWs: StepWorkspace,
    spec: Pick<NewJobRun, "kind" | "name" | "inputs">,
    signal?: AbortSignal,
    placement: ChildPlacement = { inputs: [parentWs.in, parentWs.out], out: parentWs.out },
  ): Promise<
    | { id: string; ok: true; outcome: StepOutcome; outputs: LedgerOutput[]; digest: string }
    | { id: string; ok: false; reason: string; detail?: string }
  > {
    const { store, storage } = this.#deps;
    const id = randomUUID();
    const first = parentWs.sources === undefined ? undefined : (legacySources(parentWs.sources)[0] ?? parentWs.sources[0]);
    await store.create({
      id,
      projectId: parent.projectId,
      ...(parent.applicationId === undefined ? {} : { applicationId: parent.applicationId }),
      parentId: parent.id,
      kind: spec.kind,
      name: spec.name,
      ...(parent.sourceRepositoryId === undefined ? {} : { sourceRepositoryId: parent.sourceRepositoryId }),
      ...(parentWs.sources === undefined || first === undefined ? {} : { sourceCommit: first.commit, sources: parentWs.sources }),
      inputs: spec.inputs ?? {},
      limits: parent.limits,
      ...(parent.actor === undefined ? {} : { actor: parent.actor }),
    });
    await store.start(id);
    const run = (await store.get(id))!;
    const folder = storage.job(parentWs.rootId).step(placement.key ?? id);
    // A stage step keeps its out/ when it fails, if it is an agent: the next try continues from what is there.
    const keeps = placement.key !== undefined && spec.kind === "agent";
    await this.#event(parentWs, id, "step.started", `${spec.kind} ${spec.name} started`, { kind: spec.kind, name: spec.name });
    const ws: StepWorkspace = { ...parentWs, dir: folder.root, in: folder.in, out: folder.out, tmp: folder.tmp };
    delete ws.carried;
    let failed = true;
    try {
      if (signal?.aborted === true) throw new JobFailure("aborted");
      if (!keeps) await removeTree(folder.root).catch(() => undefined);
      for (const dir of [folder.in, folder.tmp]) await removeTree(dir).catch(() => undefined);
      for (const dir of [folder.in, folder.out, folder.tmp]) await mkdir(dir, { recursive: true });
      if (keeps) {
        const left = (await listFiles(folder.out)).map((entry) => entry.path).filter((path) => !path.startsWith("restricted/"));
        if (left.length > 0) ws.carried = left;
      }
      for (const dir of placement.inputs) await copyTree(dir, ws.in);
      await this.#prepareInputs(run, ws);
      const outcome = await this.#step(run, ws, signal);
      const { summary, entries } = await this.#finish(run, ws, outcome);
      await store.succeed(id, summary);
      await this.#merge(ws.out, placement);
      failed = false;
      await this.#event(parentWs, id, "step.finished", `${spec.kind} ${spec.name} succeeded`, { kind: spec.kind, name: spec.name, status: "succeeded" });
      const outputs = entries.filter((entry) => !entry.path.startsWith("restricted/")).map((entry): LedgerOutput => ({ path: entry.path, zone: this.#isIntermediate(entry.path, placement) ? "work" : "out" }));
      return { id, ok: true, outcome, outputs, digest: filesDigest(entries) };
    } catch (error) {
      if (isCancelled(signal)) {
        await store.cancel(id).catch(() => undefined);
        await this.#event(parentWs, id, "step.finished", `${spec.kind} ${spec.name} cancelled`, { kind: spec.kind, name: spec.name, status: "cancelled" });
        return { id, ok: false, reason: "cancelled" };
      }
      const reason = reasonOf(error);
      await store.fail(id, reason).catch(() => undefined);
      await this.#event(parentWs, id, "step.finished", `${spec.kind} ${spec.name} failed: ${reason}`, { kind: spec.kind, name: spec.name, status: "failed" });
      return { id, ok: false, reason, ...(error instanceof ScriptFailure ? { detail: error.detail } : {}) };
    } finally {
      if (failed && keeps) {
        for (const dir of [folder.in, folder.tmp]) await removeTree(dir).catch(() => undefined);
      } else {
        await removeTree(folder.root).catch(() => undefined);
      }
    }
  }

  /** Whether a file of a stage step is for the steps after it only (work/), not published (out/). */
  #isIntermediate(path: string, placement: ChildPlacement): boolean {
    const intermediate = placement.intermediate ?? false;
    if (placement.work === undefined || intermediate === false) return false;
    return intermediate === true || intermediate.some((prefix) => path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`));
  }

  /** A finished step's out/: published files to placement.out, intermediate ones to placement.work. */
  async #merge(out: string, placement: ChildPlacement): Promise<void> {
    if (placement.work === undefined || (placement.intermediate ?? false) === false) return copyTree(out, placement.out);
    await copyTree(out, placement.out, (path) => !this.#isIntermediate(path, placement));
    await copyTree(out, placement.work, (path) => this.#isIntermediate(path, placement));
  }

  // -------------------------------------------------------------------------
  // After a step
  // -------------------------------------------------------------------------

  #hook(ws: StepWorkspace): ReturnType<typeof runJobOutputHook> {
    return runJobOutputHook({
      outDir: ws.out,
      cwd: ws.root,
      tmp: ws.tmp,
      interpreters: this.#deps.interpreters,
      ...(this.#deps.hookFile === undefined ? {} : { hookFile: this.#deps.hookFile }),
    });
  }

  /**
   * The JobOutput hook's redacted findings (`rule at path:line`) over an agent's out/ so far, or
   * undefined when it is clean or the hook could not report. restricted/ is left to #finish, which
   * stores it before the check.
   */
  async #flaggedOutput(ws: StepWorkspace): Promise<string[] | undefined> {
    await this.#discardMemoryScratch(ws);
    const hook = await this.#hook(ws);
    const items = hook.ok ? [] : hook.items.filter((item) => !item.path.startsWith("restricted/"));
    return items.length === 0 ? undefined : items.map((item) => item.text);
  }

  /** Discard the pre-tool pilot's scratch artifact so a retained output can never publish it. */
  async #discardMemoryScratch(ws: StepWorkspace): Promise<void> {
    await rm(join(ws.out, MEMORY_CANDIDATES_FILE), { recursive: true, force: true });
  }

  #memoryContext(run: Pick<JobRun, "id" | "kind" | "name" | "projectId" | "applicationId">, ws: StepWorkspace): MemoryContext | undefined {
    if (this.#deps.projectMemory === undefined || run.applicationId === undefined || run.kind !== "agent") return undefined;
    return { projectId: run.projectId, applicationId: run.applicationId, runId: ws.rootId, stepId: run.id,
      stage: ws.stage ?? "agent", agent: run.name, reviewedOnly: ws.stage === "review" || /reviewer/.test(run.name), sources: ws.sources ?? [] };
  }

  #memoryService(ws: StepWorkspace, context: MemoryContext): NonNullable<JobServices["memory"]> {
    return bindProjectMemory({
      store: this.#deps.projectMemory!, context,
      sensitive: (text) => redactText(text, { opaqueTokens: false }) !== text,
      verifyEvidence: (evidence) => this.#verifyMemoryEvidence(ws, evidence),
    });
  }

  async #verifyMemoryEvidence(ws: StepWorkspace, evidence: MemoryEvidence): Promise<(MemoryEvidence & { commit: string }) | undefined> {
    const source = ws.sources?.find((item) => item.repositoryId === evidence.repositoryId);
    if (source === undefined || (evidence.quote !== undefined && redactText(evidence.quote, { opaqueTokens: false }) !== evidence.quote)) return undefined;
    const root = join(ws.root, mountFolder(source));
    const file = join(root, evidence.path);
    const actual = await realpath(file).catch(() => undefined);
    const base = await realpath(root).catch(() => undefined);
    if (actual === undefined || base === undefined || !isInside(base, actual)) return undefined;
    const stat = await lstat(file).catch(() => undefined);
    if (stat?.isFile() !== true || stat.isSymbolicLink()) return undefined;
    if (evidence.quote !== undefined && (stat.size > 512_000 || !(await readFile(file,"utf8")).includes(evidence.quote))) return undefined;
    return { ...evidence, commit: source.commit };
  }

  /** restricted/ → encrypted records; the JobOutput hook over out/; the artifact index. */
  async #finish(run: JobRun, ws: StepWorkspace, outcome: StepOutcome): Promise<{ summary: Record<string, unknown>; entries: ArtifactEntry[] }> {
    await this.#discardMemoryScratch(ws);
    const restricted = await this.#storeRestricted(run, ws);
    const hook = await this.#hook(ws);
    if (!hook.ok) {
      // A step that fails keeps what it wrote for its next try (ADR-0055): what passed the checks, never what failed them.
      for (const item of hook.items) if (!item.path.startsWith("restricted/")) await rm(join(ws.out, ...item.path.split("/")), { force: true }).catch(() => undefined);
      throw new JobFailure(hook.reason ?? "JobOutput hook blocked the output");
    }
    const files = await listFiles(ws.out);
    const entries: ArtifactEntry[] = [];
    for (const file of files) {
      entries.push({ path: file.path, sha256: sha256(await readFile(file.full)), size: file.size, provenance: outcome.provenance.get(file.path) ?? { origin: "tool" } });
    }
    await this.#deps.store.addArtifacts(run.id, entries);
    return {
      summary: {
        ...outcome.summary,

        files: entries.length,
        bytes: entries.reduce((total, entry) => total + entry.size, 0),
        restrictedFiles: restricted,
        jobOutputHook: {
          checkedFiles: hook.checked.files,
          checkedBytes: hook.checked.bytes,
          ...(hook.warnings.count === 0 ? {} : { diagramWarnings: hook.warnings.count, diagramWarningsFirst: hook.warnings.first }),
        },
      },
      entries,
    };
  }

  /** Moves out/restricted/ into governance.restricted_record; nothing of it stays on disk or in a summary. */
  async #storeRestricted(run: JobRun, ws: StepWorkspace): Promise<number> {
    const dir = join(ws.out, "restricted");
    const stat = await lstat(dir).catch(() => undefined);
    if (stat === undefined) return 0;
    if (!stat.isDirectory()) {
      await rm(dir, { force: true });
      throw new JobFailure('Output "restricted" must be a directory');
    }
    try {
      const files = await listFiles(dir);
      if (files.length > MAX_RESTRICTED_FILES) throw new JobFailure(`Too many restricted files (limit ${MAX_RESTRICTED_FILES})`);
      for (const file of files) {
        if (file.size > MAX_RESTRICTED_BYTES) throw new JobFailure(`Restricted file "${file.path}" is larger than ${MAX_RESTRICTED_BYTES} bytes`);
        await this.#deps.store.addRestricted(run.id, file.path, await readFile(file.full));
      }
      return files.length;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** The pull-request description a stage wrote in its work area (ADR-0054): bounded and redacted; undefined when it wrote none. */
  async #description(plan: StagePlan, app: string, work: string): Promise<string | undefined> {
    const path = plan.description?.(app);
    if (path === undefined) return undefined;
    const text = await readFile(join(work, ...path.split("/")), "utf8").catch(() => undefined);
    if (text === undefined || text.trim() === "") return undefined;
    return redactText(text.length > MAX_DESCRIPTION_CHARS ? `${text.slice(0, MAX_DESCRIPTION_CHARS)}\n\n... (cut)` : text);
  }

  /** A top-level run's out/ goes to the document repo through the writer; returns the write id. */
  async #publish(run: JobRun, ws: StepWorkspace, outcome: StepOutcome): Promise<string | undefined> {
    if (run.parentId !== undefined) return undefined;
    if ((await listFiles(ws.out)).length === 0) return undefined;
    const repository = await this.#deps.store.documentRepository(run.projectId);
    if (repository === undefined) throw new JobFailure(`Project ${run.projectId} has no document repository`);
    const plan = run.kind === "stage" ? STAGES[run.name] : undefined;
    const description = outcome.description;
    const request: DocumentWriteRequest = {
      writeId: randomUUID(),
      projectId: run.projectId,
      kind: "job-output",
      message: plan !== undefined && run.applicationId !== undefined ? plan.message(run.applicationId, scopeOf(run.inputs)) : `Output of ${run.kind} ${run.name}`,
      outputOfJob: run.id,
      jobId: run.id,
      ...(plan?.reviewAll === true ? { reviewAll: true } : {}),
      ...(description === undefined ? {} : { description }),
      ...(outcome.agent === undefined ? {} : { agent: outcome.agent }),
      ...(run.actor === undefined ? {} : { actor: run.actor }),
    };
    // Enqueue first: the writer creates the write row if it runs before the link is recorded.
    await this.#deps.requestWrite(repository, request);
    await this.#deps.store.recordDocumentWrite(run.id, request);
    return request.writeId;
  }
}
