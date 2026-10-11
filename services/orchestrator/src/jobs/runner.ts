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
// There is no OS sandbox: scripts run with a cleared environment and explicit paths, agent
// jobs run in-process with the kernel's path confinement (read only under src/in, write only
// under out). The worker never puts credentials into a script's environment.

import { createHash, randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { BUILTIN_DIR } from "@kintsugi/agents";
import { THINKING_LEVELS, type Provenance, type ThinkingLevel } from "@kintsugi/domain";
import type { CheckoutStorage } from "@kintsugi/git";
import { type Interpreters, makeReadOnly, redactText, removeTree, runScript } from "@kintsugi/runtime/launcher";
import type { AgentRuntime, JobEvent, JobSpec } from "@kintsugi/runtime-sdk";
import type { DocumentWriteRequest } from "../queues.js";
import type { AgentResolver } from "./agents.js";
import { runJobOutputHook } from "./hook.js";
import { type ArtifactEntry, JobFailure, type JobRun, type JobStore, type NewJobRun, type SourceCheckouts, type StepLimits } from "./model.js";
import { STAGES, type Placeholders, fill } from "./stages.js";
import { type AgentCallOptions, type WorkflowBudgets, loadWorkflow, runWorkflow } from "./workflow.js";

export interface JobDefaults {
  script: StepLimits;
  agent: StepLimits;
  workflow: WorkflowBudgets;
}

export const DEFAULT_JOB_LIMITS: JobDefaults = {
  script: { timeoutSec: 600, maxOutputBytes: 50 * 1024 * 1024 },
  agent: { timeoutSec: 1800, maxOutputBytes: 50 * 1024 * 1024, maxTurns: 80 },
  workflow: { maxAgents: 50, concurrency: 4, maxTokens: 0 },
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
  /** Built-in scripts; defaults to packages/agents/builtin/scripts. */
  scriptsDir?: string;
  workflowsDir?: string;
  hookFile?: string;
  log?: (message: string) => void;
}

interface StepWorkspace {
  root: string;
  src?: string;
  in: string;
  out: string;
  tmp: string;
  commit?: string;
}

interface StepOutcome {
  summary: Record<string, unknown>;
  /** `<agent>@<version>` of the last agent that contributed. */
  agent?: string;
  /** Provenance of the files in out/, by path. */
  provenance: Map<string, Provenance>;
  /** Structured result (workflow agent calls). */
  result?: unknown;
}

const BUILTIN_SCRIPT = /^[a-z][a-z0-9_-]{0,63}\.(py|js|mjs)$/;
const MAX_RESTRICTED_FILES = 100;
const MAX_RESTRICTED_BYTES = 1024 * 1024;
const RESULT_FILE = "result.json";

interface FileEntry {
  path: string;
  full: string;
  size: number;
}

/** Regular files under `root`, relative POSIX paths; symbolic links and special files are refused. */
async function listFiles(root: string): Promise<FileEntry[]> {
  const files: FileEntry[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [] as string[];
      throw error;
    });
    for (const name of entries.sort()) {
      const full = join(dir, name);
      const path = prefix === "" ? name : `${prefix}/${name}`;
      const stat = await lstat(full);
      if (stat.isSymbolicLink()) throw new JobFailure(`Output "${path}" is a symbolic link`);
      if (stat.isDirectory()) await walk(full, path);
      else if (stat.isFile()) files.push({ path, full, size: stat.size });
      else throw new JobFailure(`Output "${path}" is not a regular file`);
    }
  };
  await walk(root, "");
  return files;
}

async function copyTree(from: string, to: string): Promise<void> {
  for (const file of await listFiles(from)) {
    const dest = join(to, ...file.path.split("/"));
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(file.full, dest);
  }
}

const sha256 = (content: Buffer): string => createHash("sha256").update(content).digest("hex");

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A recordable reason: JobFailure messages are safe by construction; anything else is redacted. */
const reasonOf = (error: unknown): string => (error instanceof JobFailure ? error.message : redactText(message(error)).slice(0, 1000));

const isInside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

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
    await store.start(id);
    const paths = storage.job(id);
    const ws: StepWorkspace = { root: paths.root, in: paths.in, out: paths.out, tmp: paths.tmp };
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
      await this.#prepareInputs(run, ws);
      const outcome = await this.#step(run, ws, signal);
      const summary = await this.#finish(run, ws, outcome);
      const write = await this.#publish(run, ws, outcome);
      await store.succeed(id, { ...summary, ...(write === undefined ? {} : { documentWriteId: write }) });
      this.#log(`${run.kind} ${run.name} (${id}) succeeded${write === undefined ? "" : `, document write ${write}`}`);
    } catch (error) {
      const reason = reasonOf(error);
      await store.fail(id, reason).catch(() => undefined);
      this.#log(`${run.kind} ${run.name} (${id}) failed: ${reason}`);
    } finally {
      await removeTree(paths.tmp).catch(() => undefined);
      await removeTree(paths.in).catch(() => undefined);
      if (checkedOut && run.sourceRepositoryId !== undefined) await checkouts.release(run.sourceRepositoryId, paths.src).catch(() => undefined);
    }
    return store.get(id);
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

  /** Declared document-repo files (inputs.documents) are copied into in/; missing ones are skipped. */
  async #prepareInputs(run: JobRun, ws: StepWorkspace): Promise<void> {
    const documents = run.inputs["documents"];
    if (Array.isArray(documents) && documents.length > 0) {
      const repository = await this.#deps.store.documentRepository(run.projectId);
      if (repository !== undefined) {
        const commit = await this.#deps.checkouts.resolve(repository);
        for (const entry of documents) {
          if (typeof entry !== "string") continue;
          const path = fill(entry, this.#placeholders(run, ws));
          const content = await this.#deps.checkouts.readDocument(repository, commit, path);
          if (content === undefined) continue;
          const dest = join(ws.in, ...path.split("/"));
          await mkdir(dirname(dest), { recursive: true });
          await writeFile(dest, content, "utf8");
        }
      }
    }
    await makeReadOnly(ws.in);
  }

  async #step(run: JobRun, ws: StepWorkspace, signal?: AbortSignal): Promise<StepOutcome> {
    switch (run.kind) {
      case "script":
        return this.#script(run, ws, signal);
      case "agent":
        return this.#agent(run, ws, signal);
      case "workflow":
        return this.#workflow(run, ws, signal);
      case "stage":
        return this.#stage(run, ws, signal);
    }
  }

  /** The script file: a built-in script by name, or a model-written one among the inputs (inputs.scriptFromInputs). */
  #scriptFile(run: JobRun, ws: StepWorkspace): string {
    const fromInputs = run.inputs["scriptFromInputs"];
    if (typeof fromInputs === "string") {
      const file = resolve(ws.in, ...fromInputs.split("/"));
      if (!isInside(ws.in, file) || !BUILTIN_SCRIPT.test(file.split(sep).at(-1) ?? "")) throw new JobFailure(`Invalid input script "${fromInputs}"`);
      return file;
    }
    if (!BUILTIN_SCRIPT.test(run.name)) throw new JobFailure(`Invalid script name "${run.name}"`);
    return join(this.#deps.scriptsDir ?? join(BUILTIN_DIR, "scripts"), run.name);
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
    if (result.failure !== undefined) throw new JobFailure(`Script ${run.name} ${result.failure}`);
    const provenance: Provenance = { origin: "tool", assetVersion: `${run.name}@sha256:${result.sha256}` };
    const files = await listFiles(ws.out);
    return {
      summary: { script: run.name, scriptHash: result.sha256, durationMs: result.durationMs },
      provenance: new Map(files.map((entry) => [entry.path, provenance])),
    };
  }

  async #agent(run: JobRun, ws: StepWorkspace, signal?: AbortSignal): Promise<StepOutcome> {
    const definition = await this.#deps.agentDefinitions.definition(run.name);
    const mock = this.#deps.agents.engine.startsWith("mock");
    const binding = (await this.#deps.store.modelBinding(run.name, run.projectId)) ?? (mock ? { provider: "mock", model: "mock" } : undefined);
    if (binding === undefined) throw new JobFailure(`No model is bound to agent "${run.name}" (Settings → LLM Providers)`);
    const task = run.inputs["task"];
    if (typeof task !== "string" || task.trim() === "") throw new JobFailure("inputs.task is missing");
    const limits = this.#limits(run, "agent");
    const agentId = `${definition.id}@${definition.version}`;
    const thinking = (THINKING_LEVELS as readonly string[]).includes(binding.thinking ?? "") ? (binding.thinking as ThinkingLevel) : undefined;
    await this.#deps.store.update(run.id, { agent: agentId });

    const spec: JobSpec = {
      agent: definition,
      task: fill(task, this.#placeholders(run, ws)),
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
    const handle = await this.#deps.agents.startJob(spec);
    const onAbort = (): void => void handle.abort("the worker is stopping");
    signal?.addEventListener("abort", onAbort, { once: true });
    const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0, toolCalls: 0, blocked: 0 };
    try {
      for await (const event of handle.events) this.#count(event, usage);
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
    const done = await handle.done;
    if (done.type === "job.failed") throw new JobFailure(`Agent ${run.name} failed (${done.reason}): ${redactText(done.error).slice(0, 300)}`);

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
    }
    const provenance: Provenance = { origin: "runtime-agent", runtimeAgent: definition.id, model: `${binding.provider}/${binding.model}`, assetVersion: definition.version };
    const files = await listFiles(ws.out);
    return {
      summary: { agent: agentId, model: `${binding.provider}/${binding.model}`, usage, outcome: done.summary },
      agent: agentId,
      provenance: new Map(files.filter((entry) => !entry.path.startsWith("restricted/")).map((entry) => [entry.path, provenance])),
      ...(result === undefined ? {} : { result }),
    };
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
      const schema = options.schema === undefined ? "" : `\n\nReturn your result as JSON matching this schema, written with outputs_write to ${RESULT_FILE} (nothing else in that file):\n${JSON.stringify(options.schema)}`;
      const child = await this.#child(run, ws, { kind: "agent", name: options.agentType, inputs: { task: prompt + schema, resultFile: options.schema !== undefined, ...(options.label === undefined ? {} : { label: options.label }) } }, signal);
      if (!child.ok) return { tokens: 0 };
      for (const [path, value] of child.outcome.provenance) provenance.set(path, value);
      agent = child.outcome.agent ?? agent;
      const usage = child.outcome.summary["usage"] as { inputTokens?: number; outputTokens?: number } | undefined;
      return { result: child.outcome.result ?? child.outcome.summary["outcome"] ?? true, tokens: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0) };
    };
    const outcome = await runWorkflow({
      source,
      args: run.inputs["args"] ?? {},
      budgets: this.#defaults.workflow,
      runAgent,
      log: (line) => this.#log(`workflow ${run.name} (${run.id}): ${line}`),
    }).catch((error: unknown) => {
      throw new JobFailure(`Workflow ${run.name} failed: ${redactText(message(error)).slice(0, 500)}`);
    });
    const result = JSON.stringify(outcome.result ?? null);
    return {
      summary: { workflow: run.name, agents: outcome.agents, failedAgents: outcome.failedAgents, tokens: outcome.tokens, result: result.length > 20_000 ? "(too large to keep)" : (JSON.parse(result) as unknown) },
      ...(agent === undefined ? {} : { agent }),
      provenance,
    };
  }

  async #stage(run: JobRun, ws: StepWorkspace, signal?: AbortSignal): Promise<StepOutcome> {
    const plan = STAGES[run.name];
    if (plan === undefined) throw new JobFailure(`Unknown stage "${run.name}"`);
    const provenance = new Map<string, Provenance>();
    const steps: Array<{ id: string; kind: string; name: string }> = [];
    let agent: string | undefined;
    for (const step of plan.steps) {
      const child = await this.#child(run, ws, { kind: step.kind, name: step.name, inputs: step.inputs }, signal);
      steps.push({ id: child.id, kind: step.kind, name: step.name });
      if (!child.ok) throw new JobFailure(`Step ${step.name} failed: ${child.reason}`);
      for (const [path, value] of child.outcome.provenance) provenance.set(path, value);
      agent = child.outcome.agent ?? agent;
    }
    return { summary: { stage: plan.id, steps }, ...(agent === undefined ? {} : { agent }), provenance };
  }

  /**
   * Runs one step of a stage or workflow as a child run: its own in/out/tmp, the parent's
   * source checkout, the parent's outputs so far as its inputs. On success its out/ is merged
   * into the parent's out/.
   */
  async #child(
    parent: JobRun,
    parentWs: StepWorkspace,
    spec: Pick<NewJobRun, "kind" | "name" | "inputs">,
    signal?: AbortSignal,
  ): Promise<{ id: string; ok: true; outcome: StepOutcome } | { id: string; ok: false; reason: string }> {
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
    const ws: StepWorkspace = { root: paths.root, in: paths.in, out: paths.out, tmp: paths.tmp, ...(parentWs.src === undefined ? {} : { src: parentWs.src }), ...(parentWs.commit === undefined ? {} : { commit: parentWs.commit }) };
    try {
      for (const dir of [paths.in, paths.out, paths.tmp]) await mkdir(dir, { recursive: true });
      await copyTree(parentWs.in, ws.in);
      await copyTree(parentWs.out, ws.in);
      await this.#prepareInputs(run, ws);
      const outcome = await this.#step(run, ws, signal);
      const summary = await this.#finish(run, ws, outcome);
      await store.succeed(id, summary);
      await copyTree(ws.out, parentWs.out);
      return { id, ok: true, outcome };
    } catch (error) {
      const reason = reasonOf(error);
      await store.fail(id, reason).catch(() => undefined);
      return { id, ok: false, reason };
    } finally {
      await removeTree(paths.root).catch(() => undefined);
    }
  }

  // -------------------------------------------------------------------------
  // After a step
  // -------------------------------------------------------------------------

  /** restricted/ → encrypted records; the JobOutput hook over out/; the artifact index. */
  async #finish(run: JobRun, ws: StepWorkspace, outcome: StepOutcome): Promise<Record<string, unknown>> {
    const restricted = await this.#storeRestricted(run, ws);
    const hook = await runJobOutputHook({
      outDir: ws.out,
      cwd: ws.root,
      tmp: ws.tmp,
      interpreters: this.#deps.interpreters,
      ...(this.#deps.hookFile === undefined ? {} : { hookFile: this.#deps.hookFile }),
    });
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
      jobOutputHook: { checkedFiles: hook.checked.files, checkedBytes: hook.checked.bytes },
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
      message: plan !== undefined && run.applicationId !== undefined ? plan.message(run.applicationId) : `Output of ${run.kind} ${run.name}`,
      outputOfJob: run.id,
      jobId: run.id,
      ...(outcome.agent === undefined ? {} : { agent: outcome.agent }),
      ...(run.actor === undefined ? {} : { actor: run.actor }),
    };
    // Enqueue first: the writer creates the write row if it runs before the link is recorded.
    await this.#deps.requestWrite(repository, request);
    await this.#deps.store.recordDocumentWrite(run.id, request);
    return request.writeId;
  }
}
