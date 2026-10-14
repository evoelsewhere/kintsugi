// The job runner (ADR-0023, ADR-0027, ADR-0029): runs one job run end to end in its job
// workspace and hands the result to the document repo writer.
//
//   <data>/jobs/<id>/src  read-only worktree of the source repository at the job's commit
//   <data>/jobs/<id>/in   read-only inputs: earlier steps' outputs and declared documents
//   <data>/jobs/<id>/out  the only place results are written
//   <data>/jobs/<id>/tmp  scratch, deleted when the step ends
//
// After every step: out/restricted/ is stored as encrypted restricted records and removed,
// the JobOutput hook checks out/ (fail-closed), and the files are indexed as artifacts. A
// top-level run then enqueues a document write of its out/ (outputOfJob) with job, agent and
// actor trailers. Stage steps run as child runs sharing the stage's source checkout.
//
// There is no OS sandbox: scripts and agent jobs run as child processes in the job directory
// with a cleared environment, limits and a process-tree kill; agent tools are confined by the
// kernel (read only under src/in, write only under out). Only an agent job's own child gets
// its provider credentials (launcher/agent-process.ts); scripts never get any.

import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { findBuiltinFile } from "@kintsugi/agents";
import { THINKING_LEVELS, type Provenance, type ThinkingLevel } from "@kintsugi/domain";
import type { CheckoutStorage } from "@kintsugi/git";
import { type Interpreters, makeReadOnly, redactText, removeTree, runScript } from "@kintsugi/runtime/launcher";
import type { AgentRuntime, JobEvent, JobSpec } from "@kintsugi/runtime-sdk";
import type { DocumentWriteRequest } from "../queues.js";
import type { AgentResolver } from "./agents.js";
import { materializeSkillFiles } from "./skill-files.js";
import { type LeafPlacement, type LeafResult, type LeafRun, StageFailure, StagePlanExecutor, type StepRecord, stepKey } from "./executor.js";
import { copyTree, listFiles } from "./files.js";
import { runJobOutputHook } from "./hook.js";
import { writeMockOutputs } from "./mock-outputs.js";
import {
  type ArtifactEntry,
  DEFAULT_GATE_DECIDER,
  type GateDecider,
  type JobEventKind,
  JobFailure,
  type JobRun,
  type JobStore,
  type NewJobRun,
  type SourceCheckouts,
  type StepLimits,
  isCancelled,
} from "./model.js";
import { type Placeholders, type StageScope, fill } from "./plan.js";
import { STAGES } from "./stages.js";
import { type AgentCallOptions, type WorkflowBudgets, loadWorkflow, runWorkflow } from "./workflow.js";

/** Budgets of a stage run: agent jobs it may start in total (workflows included), and at a time in a group. */
export interface StageBudgets {
  maxAgents: number;
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
  agent: { timeoutSec: 1800, maxOutputBytes: 50 * 1024 * 1024, maxTurns: 80 },
  workflow: { maxAgents: 50, concurrency: 4, maxTokens: 0 },
  stage: { maxAgents: 200, concurrency: 4 },
};

export interface JobRunnerDeps {
  store: JobStore;
  storage: CheckoutStorage;
  checkouts: SourceCheckouts;
  /** pi in production; the mock backend in tests and mock-mode development. */
  agents: AgentRuntime;
  agentDefinitions: AgentResolver;
  interpreters: Interpreters;
  defaults?: JobDefaults;
  /** Hands a write to the document repo writer (queue `document-write`). */
  requestWrite(documentRepositoryId: string, request: DocumentWriteRequest): Promise<void>;
  /** Built-in scripts; defaults to the scripts/ folder of the built-in plugin that has the script. */
  scriptsDir?: string;
  workflowsDir?: string;
  hookFile?: string;
  /** Decides the gates of stage plans; default: the documented default, recorded as defaulted. */
  gates?: GateDecider;
  /**
   * Fill in what a mock agent job would have written (expected files, structured results);
   * default: when the agent runtime is the mock backend.
   */
  mockOutputs?: boolean;
  log?: (message: string) => void;
}

interface StepWorkspace {
  /** The top-level run whose live record gets this step's events. */
  rootId: string;
  root: string;
  src?: string;
  in: string;
  out: string;
  tmp: string;
  commit?: string;
  /** The document-repo commit declared documents are read at (pinned for a whole run, ADR-0033). */
  documentsCommit?: string;
}

/** What a resumed run takes over from the failed one (ADR-0033). */
interface ResumeState {
  from: string;
  completed: Set<string>;
  gateChoices: Map<string, string>;
}

const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** inputs.scope of a scoped run: catalog item ids and their files; undefined when absent or malformed. */
export function scopeOf(inputs: Record<string, unknown>): StageScope | undefined {
  const scope = inputs["scope"];
  if (!isRecord(scope) || !Array.isArray(scope["items"])) return undefined;
  const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);
  return { items: strings(scope["items"]), files: strings(scope["files"]) };
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
}

const BUILTIN_SCRIPT = /^[a-z][a-z0-9_-]{0,63}\.(py|js|mjs)$/;
const MAX_STDOUT = 20_000;
const MAX_DETAIL_LINES = 40;
/** Files of one declared document folder ("standards/", an application's items) a step gets at most. */
const MAX_FOLDER_DOCUMENTS = 5000;
/** A relative document-repo path without traversal. */
const SAFE_OUTPUT_PATH = /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[A-Za-z0-9._/-]+$/;
const MAX_RESTRICTED_FILES = 100;
const MAX_RESTRICTED_BYTES = 1024 * 1024;
const RESULT_FILE = "result.json";

/** Appended to an agent's task when the output checks flagged its files: what to fix, never the offending content. */
const outputFixNote = (findings: readonly string[]): string =>
  `\n\nThe output checks rejected the files you wrote (rule at path:line, paths relative to the output directory):\n${findings.map((finding) => `- ${finding}`).join("\n")}\n` +
  "Open each of those files with edit and fix the cited lines. A credential-shaped value (password, key, token, connection string, even in a quoted excerpt) must not appear in any output: " +
  "name the credential and cite its file:line, with at most a 2-4 character preview followed by ****, and no full value. " +
  "Change only what was flagged, check every other line of those files for the same problem, then stop.";

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
      if (full === resolve(root)) return label;
      if (isAbsolute(value) && isInside(root, full)) return `${label}/${relative(root, full).split(sep).join("/")}`;
    }
    return isAbsolute(value) ? "(outside the workspace)" : value;
  };
  const parts = [tool];
  const path = shown(args["path"]);
  if (path !== undefined) parts.push(path);
  if ((tool === "grep" || tool === "find") && typeof args["pattern"] === "string") parts.push(`"${args["pattern"].slice(0, 80)}"`);
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

  /** Runs a queued job run; a run in any other status is left alone. Never throws for a failing job. */
  async run(id: string, signal?: AbortSignal): Promise<JobRun | undefined> {
    const { store, storage, checkouts } = this.#deps;
    const run = await store.get(id);
    if (run === undefined || run.status !== "queued") return run;
    // A run cancelled while it waited in the queue is not started.
    if (!(await store.start(id))) return store.get(id);
    const paths = storage.job(id);
    const ws: StepWorkspace = { rootId: id, root: paths.root, in: paths.in, out: paths.out, tmp: paths.tmp };
    await this.#event(ws, undefined, "status", `${run.kind} ${run.name} started`, { status: "running" });
    let checkedOut = false;
    try {
      for (const dir of [paths.in, paths.out, paths.tmp]) await mkdir(dir, { recursive: true });
      if (run.sourceRepositoryId !== undefined) {
        const commit = run.sourceCommit ?? (await checkouts.resolve(run.sourceRepositoryId));
        if (run.sourceCommit === undefined) await store.update(id, { sourceCommit: commit });
        run.sourceCommit = commit;
        await checkouts.checkout(run.sourceRepositoryId, commit, paths.src);
        checkedOut = true;
        ws.src = paths.src;
        ws.commit = commit;
      }
      const pinned = run.inputs["documentsCommit"];
      if (typeof pinned === "string" && COMMIT.test(pinned)) ws.documentsCommit = pinned;
      const resume = typeof run.inputs["resumeOf"] === "string" ? await this.#resume(run, ws, run.inputs["resumeOf"]) : undefined;
      await this.#prepareInputs(run, ws);
      const outcome = await this.#step(run, ws, signal, resume);
      const summary = await this.#finish(run, ws, outcome);
      const write = await this.#publish(run, ws, outcome);
      await store.succeed(id, { ...summary, ...(write === undefined ? {} : { documentWriteId: write }) });
      await this.#event(ws, undefined, "status", `succeeded${write === undefined ? "" : ", output handed to the document repo writer"}`, { status: "succeeded" });
      this.#log(`${run.kind} ${run.name} (${id}) succeeded${write === undefined ? "" : `, document write ${write}`}`);
    } catch (error) {
      if (isCancelled(signal)) {
        await store.cancel(id).catch(() => undefined);
        await this.#event(ws, undefined, "status", "cancelled", { status: "cancelled" });
        this.#log(`${run.kind} ${run.name} (${id}) cancelled`);
      } else {
        const reason = reasonOf(error);
        // A failed stage keeps its steps and gate choices, so it can be resumed (ADR-0033).
        const summary = error instanceof StageFailure ? { ...error.outcome, ...(ws.documentsCommit === undefined ? {} : { documentsCommit: ws.documentsCommit }) } : undefined;
        await store.fail(id, reason, summary).catch(() => undefined);
        await this.#event(ws, undefined, "status", `failed: ${reason}`, { status: "failed" });
        this.#log(`${run.kind} ${run.name} (${id}) failed: ${reason}`);
      }
    } finally {
      await removeTree(paths.tmp).catch(() => undefined);
      await removeTree(paths.in).catch(() => undefined);
      if (checkedOut && run.sourceRepositoryId !== undefined) await checkouts.release(run.sourceRepositoryId, paths.src).catch(() => undefined);
    }
    return store.get(id);
  }

  /**
   * A resume of a failed stage run (inputs.resumeOf): takes over its kept out/ and work/, the
   * agent and workflow leaves that succeeded and the gate choices it recorded.
   */
  async #resume(run: JobRun, ws: StepWorkspace, fromId: string): Promise<ResumeState> {
    const from = await this.#deps.store.get(fromId);
    if (from === undefined || from.kind !== "stage" || from.name !== run.name || from.projectId !== run.projectId || from.applicationId !== run.applicationId) {
      throw new JobFailure(`Run ${fromId} cannot be resumed by this run (not a ${run.name} run of the same application)`);
    }
    if (from.status !== "failed") throw new JobFailure(`Run ${fromId} did not fail (${from.status}): only a failed run is resumed`);
    const old = this.#deps.storage.job(fromId);
    await copyTree(old.out, ws.out);
    await copyTree(join(old.root, "work"), join(ws.root, "work"));
    const summary = from.outputSummary ?? {};
    const steps = Array.isArray(summary["steps"]) ? (summary["steps"] as unknown[]).filter((step): step is StepRecord => isRecord(step) && typeof step["id"] === "string") : [];
    const completed = new Set(steps.filter((step) => step.status === "succeeded" && (step.kind === "agent" || step.kind === "workflow")).map((step) => stepKey(step)));
    const gates = Array.isArray(summary["gates"]) ? (summary["gates"] as unknown[]) : [];
    const gateChoices = new Map(gates.flatMap((gate) => (isRecord(gate) && typeof gate["id"] === "string" && typeof gate["choice"] === "string" ? [[gate["id"], gate["choice"]] as [string, string]] : [])));
    const pinned = summary["documentsCommit"];
    if (ws.documentsCommit === undefined && typeof pinned === "string" && COMMIT.test(pinned)) ws.documentsCommit = pinned;
    await this.#event(ws, undefined, "log", `resuming run ${fromId}: ${completed.size} agent or workflow step(s) are not run again`, { resumeOf: fromId, reused: completed.size });
    return { from: fromId, completed, gateChoices };
  }

  /** Appends to the top-level run's live record (best effort; texts are redacted). */
  async #event(ws: StepWorkspace, stepId: string | undefined, kind: JobEventKind, message: string, data?: Record<string, unknown>): Promise<void> {
    await this.#deps.store
      .addEvent({ runId: ws.rootId, ...(stepId === undefined ? {} : { stepId }), kind, message: redactText(message).slice(0, 1000), ...(data === undefined ? {} : { data }) })
      .catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // Steps
  // -------------------------------------------------------------------------

  #placeholders(run: JobRun, ws: StepWorkspace): Placeholders {
    return {
      in: ws.in,
      out: ws.out,
      tmp: ws.tmp,
      ...(ws.src === undefined ? {} : { src: ws.src }),
      ...(ws.commit === undefined ? {} : { commit: ws.commit }),
      ...(run.sourceRepositoryId === undefined ? {} : { repo: run.sourceRepositoryId }),
      ...(run.applicationId === undefined ? {} : { app: run.applicationId }),
    };
  }

  #limits(run: JobRun, kind: "script" | "agent"): StepLimits {
    return { ...this.#defaults[kind], ...run.limits };
  }

  /**
   * Declared document-repo files are copied into in/ from the default branch tip: inputs.documents,
   * and for a stage its plan's documents, prerequisites and optional inputs. Missing ones are skipped, except a
   * stage's prerequisites; an entry ending in "/" is a folder.
   */
  async #prepareInputs(run: JobRun, ws: StepWorkspace): Promise<void> {
    const plan = run.kind === "stage" ? STAGES[run.name] : undefined;
    const declared = run.inputs["documents"];
    const entries = [
      ...(Array.isArray(declared) ? declared.filter((entry): entry is string => typeof entry === "string") : []),
      ...(plan?.documents ?? []),
      ...(plan?.requires ?? []).map((entry) => entry.path),
      ...(plan?.optional ?? []).map((entry) => entry.path),
    ];
    if (entries.length > 0) {
      const repository = await this.#deps.store.documentRepository(run.projectId);
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
    await makeReadOnly(ws.in);
  }

  async #step(run: JobRun, ws: StepWorkspace, signal?: AbortSignal, resume?: ResumeState): Promise<StepOutcome> {
    switch (run.kind) {
      case "script":
        return this.#script(run, ws, signal);
      case "agent":
        return this.#agent(run, ws, signal);
      case "workflow":
        return this.#workflow(run, ws, signal);
      case "stage":
        return this.#stage(run, ws, signal, resume);
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

  /** Fails the step when a file it must write is missing. */
  async #checkExpected(run: JobRun, ws: StepWorkspace, what: string): Promise<void> {
    const missing: string[] = [];
    for (const path of this.#expects(run, ws)) {
      const stat = await lstat(join(ws.out, ...path.split("/"))).catch(() => undefined);
      if (stat?.isFile() !== true) missing.push(path);
    }
    if (missing.length > 0) throw new JobFailure(`${what} did not write ${missing.join(", ")}`);
  }

  async #script(run: JobRun, ws: StepWorkspace, signal?: AbortSignal): Promise<StepOutcome> {
    const file = this.#scriptFile(run, ws);
    const values = this.#placeholders(run, ws);
    const rawArgs = run.inputs["args"];
    if (rawArgs !== undefined && !(Array.isArray(rawArgs) && rawArgs.every((arg) => typeof arg === "string"))) throw new JobFailure("inputs.args must be a list of strings");
    const args = ((rawArgs ?? []) as string[]).map((arg) => fill(arg, values));
    const limits = this.#limits(run, "script");
    const result = await runScript({
      file,
      args,
      workspace: { cwd: ws.root, readOnly: [...(ws.src === undefined ? [] : [ws.src]), ws.in], writable: [ws.out, ws.tmp], tmp: ws.tmp, out: ws.out },
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
    const definition = await materializeSkillFiles(await this.#deps.agentDefinitions.definition(run.name), ws.in);
    const mock = this.#deps.agents.engine.startsWith("mock");
    const binding = (await this.#deps.store.modelBinding(run.name, run.projectId)) ?? (mock ? { provider: "mock", model: "mock" } : undefined);
    if (binding === undefined) throw new JobFailure(`No model is bound to agent "${run.name}" (Settings → LLM Providers)`);
    const task = run.inputs["task"];
    if (typeof task !== "string" || task.trim() === "") throw new JobFailure("inputs.task is missing");
    const limits = this.#limits(run, "agent");
    const agentId = `${definition.id}@${definition.version}`;
    const thinking = (THINKING_LEVELS as readonly string[]).includes(binding.thinking ?? "") ? (binding.thinking as ThinkingLevel) : undefined;
    await this.#deps.store.update(run.id, { agent: agentId });

    const schema = run.inputs["schema"];
    const schemaNote =
      typeof schema === "object" && schema !== null
        ? `\n\nReturn your result as JSON matching this schema, written with write to ${RESULT_FILE} (nothing else in that file):\n${JSON.stringify(schema)}`
        : "";
    const spec: JobSpec = {
      agent: definition,
      task: fill(task, this.#placeholders(run, ws)) + schemaNote,
      model: { provider: binding.provider, id: binding.model, ...(thinking === undefined ? {} : { thinking }) },
      // Reads are confined to the checkout and the inputs, writes to out/ (kernel path guard).
      workspace: { readOnly: [...(ws.src === undefined ? [] : [ws.src]), ws.in], outDir: ws.out },
      limits: {
        timeoutSec: limits.timeoutSec,
        ...(limits.maxTurns === undefined ? {} : { maxTurns: limits.maxTurns }),
        ...(limits.maxCostUsd === undefined ? {} : { maxCostUsd: limits.maxCostUsd }),
      },
      metadata: { jobRunId: run.id, projectId: run.projectId, ...(run.applicationId === undefined ? {} : { applicationId: run.applicationId }) },
    };
    const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0, toolCalls: 0, blocked: 0 };
    const stepId = run.id === ws.rootId ? undefined : run.id;
    const roots = { src: ws.src, in: ws.in, out: ws.out };
    const attempt = async (task: string = spec.task): Promise<Extract<JobEvent, { type: "job.completed" | "job.failed" }>> => {
      const handle = await this.#deps.agents.startJob({ ...spec, task });
      const onAbort = (): void => void handle.abort(isCancelled(signal) ? "cancelled" : "the worker is stopping");
      if (signal?.aborted === true) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
      try {
        for await (const event of handle.events) {
          this.#count(event, usage);
          if (event.type === "progress") {
            const kb = (chars: number): string => (chars < 1000 ? `${chars}` : `${(chars / 1000).toFixed(1)}k`);
            await this.#event(ws, stepId, "log", `model working: turn ${event.turn}, thinking ${kb(event.thinkingChars)} chars, tool arguments ${kb(event.toolArgsChars)}, text ${kb(event.textChars)}`, {
              turn: event.turn,
              thinkingChars: event.thinkingChars,
              toolArgsChars: event.toolArgsChars,
              textChars: event.textChars,
            });
          } else if (event.type === "tool.call") {
            const line = summarizeToolCall(event.tool, event.input, roots);
            const reason = event.reason === undefined ? "" : ` (${event.reason})`;
            await this.#event(ws, stepId, "tool", event.decision === "blocked" ? `blocked: ${line}${reason}` : line, { tool: event.tool, decision: event.decision });
          }
        }
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
      return handle.done;
    };
    let done = await attempt();
    // A provider that drops its response stalls the job (the launcher's idle watchdog): try once more.
    if (done.type === "job.failed" && done.reason === "timeout" && done.error.startsWith("stalled") && signal?.aborted !== true) {
      await this.#event(ws, stepId, "log", `agent ${run.name} stalled (${redactText(done.error).slice(0, 120)}); retrying once`);
      done = await attempt();
    }
    if (done.type === "job.failed") throw new JobFailure(`Agent ${run.name} failed (${done.reason}): ${redactText(done.error).slice(0, 300)}`);
    const writeMock = async (): Promise<void> => {
      if (!(this.#deps.mockOutputs ?? mock)) return;
      await writeMockOutputs({
        out: ws.out,
        ...(ws.src === undefined ? {} : { src: ws.src }),
        agent: run.name,
        app: run.applicationId ?? run.projectId,
        expects: this.#expects(run, ws),
        ...(run.inputs["resultFile"] === true && typeof schema === "object" && schema !== null ? { schema: schema as Record<string, unknown> } : {}),
        resultFile: RESULT_FILE,
      });
    };
    await writeMock();

    // The output checks (#finish) are fail-closed. An agent that slipped a credential or a malformed
    // artifact into its files gets the redacted findings (rule, path, line: never content) and one
    // chance to fix just those lines, in the out/ it already wrote.
    const flagged = await this.#flaggedOutput(ws);
    if (flagged !== undefined && signal?.aborted !== true) {
      await this.#event(ws, stepId, "log", `output checks flagged ${flagged.length} finding${flagged.length === 1 ? "" : "s"} in the files of ${run.name}: ${flagged.join("; ")}; asking it to fix them once`);
      done = await attempt(`${spec.task}${outputFixNote(flagged)}`);
      if (done.type === "job.failed") throw new JobFailure(`Agent ${run.name} failed (${done.reason}): ${redactText(done.error).slice(0, 300)}`);
      await writeMock();
    }

    let result: unknown;
    if (run.inputs["resultFile"] === true) {
      const file = join(ws.out, RESULT_FILE);
      const text = await readFile(file, "utf8").catch(() => undefined);
      await rm(file, { force: true });
      if (text === undefined) throw new JobFailure(`Agent ${run.name} wrote no ${RESULT_FILE}`);
      try {
        result = JSON.parse(text) as unknown;
      } catch {
        throw new JobFailure(`Agent ${run.name} wrote an invalid ${RESULT_FILE}`);
      }
      if (run.inputs["resultTo"] !== undefined) await this.#saveResult(run, ws, result);
    }
    await this.#checkExpected(run, ws, `Agent ${run.name}`);
    const provenance: Provenance = { origin: "runtime-agent", runtimeAgent: definition.id, model: `${binding.provider}/${binding.model}`, assetVersion: definition.version };
    const files = await listFiles(ws.out);
    return {
      summary: { agent: agentId, model: `${binding.provider}/${binding.model}`, usage, outcome: done.summary },
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

  #count(event: JobEvent, usage: { inputTokens: number; outputTokens: number; costUsd: number; toolCalls: number; blocked: number }): void {
    if (event.type === "usage") {
      usage.inputTokens += event.inputTokens;
      usage.outputTokens += event.outputTokens;
      usage.costUsd += event.costUsd ?? 0;
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
    const budgets = cap === undefined ? this.#defaults.workflow : { ...this.#defaults.workflow, maxAgents: Math.min(this.#defaults.workflow.maxAgents, cap) };
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
  async #stage(run: JobRun, ws: StepWorkspace, signal?: AbortSignal, resume?: ResumeState): Promise<StepOutcome> {
    const plan = STAGES[run.name];
    if (plan === undefined) throw new JobFailure(`Unknown stage "${run.name}"`);
    if (run.applicationId === undefined || run.sourceRepositoryId === undefined || ws.commit === undefined) throw new JobFailure(`Stage ${run.name} needs an application with a legacy repository`);
    const work = join(ws.root, "work");
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
        ...(child.outcome.stdout === undefined ? {} : { stdout: child.outcome.stdout }),
      };
    };
    try {
      const executor = new StagePlanExecutor({
        plan,
        run: { id: run.id, projectId: run.projectId, applicationId: run.applicationId },
        values: { app: run.applicationId, repo: run.sourceRepositoryId, commit: ws.commit },
        dirs: { root: ws.root, in: ws.in, work, out: ws.out },
        limits: this.#defaults.stage,
        gates: this.#deps.gates ?? DEFAULT_GATE_DECIDER,
        runLeaf,
        log: (line, data) => {
          this.#log(`stage ${run.name} (${run.id}): ${line}`);
          return this.#event(ws, undefined, "log", line, data);
        },
        ...(signal === undefined ? {} : { signal }),
        ...(scope === undefined ? {} : { scope }),
        ...(resume === undefined ? {} : { completed: resume.completed, gateChoices: resume.gateChoices }),
      });
      const outcome = await executor.run();
      // work/ goes only when the stage succeeds: a failed run keeps it beside out/ for a resume
      // (same retention, cleanup.ts).
      await removeTree(work).catch(() => undefined);
      return {
        summary: {
          ...outcome,
          ...(ws.documentsCommit === undefined ? {} : { documentsCommit: ws.documentsCommit }),
          ...(resume === undefined ? {} : { resumeOf: resume.from }),
        },
        ...(agent === undefined ? {} : { agent }),
        provenance,
      };
    } catch (error) {
      if (isCancelled(signal)) await removeTree(work).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Runs one step of a stage or workflow as a child run: its own in/out/tmp, the parent's
   * source checkout, the parent's inputs and outputs so far as its inputs (for a stage step: the
   * placement's directories). On success its out/ is merged into the parent's out/; for a stage
   * step, intermediate files go to the placement's work directory instead.
   */
  async #child(
    parent: JobRun,
    parentWs: StepWorkspace,
    spec: Pick<NewJobRun, "kind" | "name" | "inputs">,
    signal?: AbortSignal,
    placement: ChildPlacement = { inputs: [parentWs.in, parentWs.out], out: parentWs.out },
  ): Promise<{ id: string; ok: true; outcome: StepOutcome } | { id: string; ok: false; reason: string; detail?: string }> {
    const { store, storage } = this.#deps;
    const id = randomUUID();
    await store.create({
      id,
      projectId: parent.projectId,
      ...(parent.applicationId === undefined ? {} : { applicationId: parent.applicationId }),
      parentId: parent.id,
      kind: spec.kind,
      name: spec.name,
      ...(parent.sourceRepositoryId === undefined ? {} : { sourceRepositoryId: parent.sourceRepositoryId }),
      ...(parentWs.commit === undefined ? {} : { sourceCommit: parentWs.commit }),
      inputs: spec.inputs ?? {},
      limits: parent.limits,
      ...(parent.actor === undefined ? {} : { actor: parent.actor }),
    });
    await store.start(id);
    const run = (await store.get(id))!;
    const paths = storage.job(id);
    await this.#event(parentWs, id, "step.started", `${spec.kind} ${spec.name} started`, { kind: spec.kind, name: spec.name });
    const ws: StepWorkspace = { rootId: parentWs.rootId, root: paths.root, in: paths.in, out: paths.out, tmp: paths.tmp, ...(parentWs.src === undefined ? {} : { src: parentWs.src }), ...(parentWs.commit === undefined ? {} : { commit: parentWs.commit }), ...(parentWs.documentsCommit === undefined ? {} : { documentsCommit: parentWs.documentsCommit }) };
    try {
      if (signal?.aborted === true) throw new JobFailure("aborted");
      for (const dir of [paths.in, paths.out, paths.tmp]) await mkdir(dir, { recursive: true });
      for (const dir of placement.inputs) await copyTree(dir, ws.in);
      await this.#prepareInputs(run, ws);
      const outcome = await this.#step(run, ws, signal);
      const summary = await this.#finish(run, ws, outcome);
      await store.succeed(id, summary);
      await this.#merge(ws.out, placement);
      await this.#event(parentWs, id, "step.finished", `${spec.kind} ${spec.name} succeeded`, { kind: spec.kind, name: spec.name, status: "succeeded" });
      return { id, ok: true, outcome };
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
      await removeTree(paths.root).catch(() => undefined);
    }
  }

  /** A finished step's out/: published files to placement.out, intermediate ones to placement.work. */
  async #merge(out: string, placement: ChildPlacement): Promise<void> {
    const intermediate = placement.intermediate ?? false;
    if (placement.work === undefined || intermediate === false) return copyTree(out, placement.out);
    const isIntermediate = (path: string): boolean =>
      intermediate === true || intermediate.some((prefix) => path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`));
    await copyTree(out, placement.out, (path) => !isIntermediate(path));
    await copyTree(out, placement.work, isIntermediate);
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
    const hook = await this.#hook(ws);
    const items = hook.ok ? [] : hook.items.filter((item) => !item.path.startsWith("restricted/"));
    return items.length === 0 ? undefined : items.map((item) => item.text);
  }

  /** restricted/ → encrypted records; the JobOutput hook over out/; the artifact index. */
  async #finish(run: JobRun, ws: StepWorkspace, outcome: StepOutcome): Promise<Record<string, unknown>> {
    const restricted = await this.#storeRestricted(run, ws);
    const hook = await this.#hook(ws);
    if (!hook.ok) throw new JobFailure(hook.reason ?? "JobOutput hook blocked the output");
    const files = await listFiles(ws.out);
    const entries: ArtifactEntry[] = [];
    for (const file of files) {
      entries.push({ path: file.path, sha256: sha256(await readFile(file.full)), size: file.size, provenance: outcome.provenance.get(file.path) ?? { origin: "tool" } });
    }
    await this.#deps.store.addArtifacts(run.id, entries);
    return {
      ...outcome.summary,
      files: entries.length,
      bytes: entries.reduce((total, entry) => total + entry.size, 0),
      restrictedFiles: restricted,
      jobOutputHook: {
        checkedFiles: hook.checked.files,
        checkedBytes: hook.checked.bytes,
        ...(hook.warnings.count === 0 ? {} : { diagramWarnings: hook.warnings.count, diagramWarningsFirst: hook.warnings.first }),
      },
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

  /** A top-level run's out/ goes to the document repo through the writer; returns the write id. */
  async #publish(run: JobRun, ws: StepWorkspace, outcome: StepOutcome): Promise<string | undefined> {
    if (run.parentId !== undefined) return undefined;
    if ((await listFiles(ws.out)).length === 0) return undefined;
    const repository = await this.#deps.store.documentRepository(run.projectId);
    if (repository === undefined) throw new JobFailure(`Project ${run.projectId} has no document repository`);
    const plan = run.kind === "stage" ? STAGES[run.name] : undefined;
    const request: DocumentWriteRequest = {
      writeId: randomUUID(),
      projectId: run.projectId,
      kind: "job-output",
      message: plan !== undefined && run.applicationId !== undefined ? plan.message(run.applicationId, scopeOf(run.inputs)) : `Output of ${run.kind} ${run.name}`,
      outputOfJob: run.id,
      jobId: run.id,
      ...(plan?.reviewAll === true ? { reviewAll: true } : {}),
      ...(outcome.agent === undefined ? {} : { agent: outcome.agent }),
      ...(run.actor === undefined ? {} : { actor: run.actor }),
    };
    // Enqueue first: the writer creates the write row if it runs before the link is recorded.
    await this.#deps.requestWrite(repository, request);
    await this.#deps.store.recordDocumentWrite(run.id, request);
    return request.writeId;
  }
}
