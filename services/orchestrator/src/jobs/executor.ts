// The generic stage-plan executor (ADR-0027): walks a StagePlan (plan.ts) and runs every leaf
// step — script, agent job, workflow — through the job runner as a child run of the stage.
// It owns what makes a plan more than a list: conditions, parallel groups, per-item fan-out,
// repeat-until loops, the script repair loop, gates, the stage's agent budget, and which
// outputs are published (the stage's out/) and which are intermediate (its work/).
//
// Groups (parallel, forEach) give every member the same inputs: their outputs are staged and
// merged into the stage only when the whole group has finished.

import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { copyTree } from "./files.js";
import { type GateDecider, JobFailure } from "./model.js";
import {
  type AgentStep,
  type ForEachStep,
  type GateStep,
  type LeafStep,
  type Placeholders,
  type RepeatStep,
  type StageContext,
  type StagePlan,
  type StageScope,
  type StageStep,
  fill,
} from "./plan.js";
import { Semaphore } from "./workflow.js";

/** One leaf step as the runner starts it: a child run of the stage. */
export interface LeafRun {
  kind: "script" | "agent" | "workflow";
  name: string;
  inputs: Record<string, unknown>;
}

/** Where a leaf's inputs come from and where its outputs go. */
export interface LeafPlacement {
  /** Directories copied into the child's in/, in order (a later one wins). */
  inputs: readonly string[];
  /** Published outputs go here. */
  out: string;
  /** Intermediate outputs go here. */
  work: string;
  /** true, or the document-repo path prefixes that are intermediate. */
  intermediate: boolean | readonly string[];
}

export type LeafResult =
  | { id: string; ok: true; summary: Record<string, unknown>; stdout?: string; agents: number }
  | { id: string; ok: false; reason: string; detail?: string };

export interface ExecutorDeps {
  plan: StagePlan;
  /** The stage run, for gate requests. */
  run: { id: string; projectId: string; applicationId?: string };
  values: { app: string; repo: string; commit: string };
  /** The stage's directories: declared documents (in), intermediate outputs (work), published outputs (out). */
  dirs: { root: string; in: string; work: string; out: string };
  limits: { maxAgents: number; concurrency: number };
  gates: GateDecider;
  /** `abort`: stops this leaf when a sibling of its group failed (the stage's own `signal` still applies). */
  runLeaf(spec: LeafRun, placement: LeafPlacement, abort?: AbortSignal): Promise<LeafResult>;
  log(message: string, data?: Record<string, unknown>): Promise<void>;
  signal?: AbortSignal;
  /** The selection of a scoped run (ADR-0033). */
  scope?: StageScope;
  /**
   * Resume of a failed run: the agent and workflow leaves and forEach items that succeeded in it
   * (keys of stepKey()); their outputs are already in the stage's out/ and work/, so they are
   * not run again. Script steps always run again.
   */
  completed?: ReadonlySet<string>;
  /** Resume: gate decisions are re-read from the original run's durable stage-decision record. */
  resumeOf?: string;
}

/** The key of a leaf run in a resume's `completed` set: `<step id>[#<forEach key>][@<round>]`. */
export const stepKey = (step: { id: string; key?: string; round?: number }): string =>
  `${step.id}${step.key === undefined ? "" : `#${step.key}`}${step.round === undefined || step.round === 0 ? "" : `@${step.round}`}`;

/** A failed stage, with what it recorded so far (persisted in the run's summary for a resume). */
export class StageFailure extends JobFailure {
  constructor(
    message: string,
    readonly outcome: StageOutcome,
  ) {
    super(message);
  }
}

export interface StepRecord {
  id: string;
  kind: string;
  name?: string;
  runId?: string;
  status: "succeeded" | "failed" | "skipped";
  round?: number;
  key?: string;
  reason?: string;
  /** A resume took this step's outputs from the failed run instead of running it. */
  reused?: boolean;
}

export interface GateRecord {
  id: string;
  question: string;
  choice: string;
  defaulted: boolean;
  by?: string;
}

/** What the stage reports in its summary. */
export interface StageOutcome {
  stage: string;
  steps: StepRecord[];
  gates: GateRecord[];
  agents: number;
  /** Optional inputs of the plan that were not on the document repo's default branch. */
  missingInputs?: Array<{ path: string; stage: string }>;
}

/** Agent failures worth one more try: the provider's, not a limit the job hit (timeout, turns, budget). */
const TRANSIENT_PROVIDER_FAILURE = /finish_reason|content_filter|provider|rate.?limit|overloaded|\b(429|50[0-4])\b|ECONNRESET|ETIMEDOUT|fetch failed|stalled/i;

const MAX_STDOUT = 20_000;
const SAFE_PATH = /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[^\\:\0]+$/;

export class StagePlanExecutor {
  readonly #deps: ExecutorDeps;
  readonly #steps: StepRecord[] = [];
  readonly #gates = new Map<string, GateRecord>();
  readonly #stdout = new Map<string, string>();
  #agents = 0;
  #groups = 0;
  #round = 0;

  constructor(deps: ExecutorDeps) {
    this.#deps = deps;
  }

  /** Runs the plan; a failure is thrown as a StageFailure carrying the steps recorded so far. */
  async run(): Promise<StageOutcome> {
    let missingInputs: Array<{ path: string; stage: string }> = [];
    try {
      missingInputs = await this.#missingInputs();
      for (const step of this.#deps.plan.steps) await this.#runStep(step);
    } catch (error) {
      if (error instanceof JobFailure && !(error instanceof StageFailure)) throw new StageFailure(error.message, this.#outcome(missingInputs));
      throw error;
    }
    return this.#outcome(missingInputs);
  }

  #outcome(missingInputs: Array<{ path: string; stage: string }>): StageOutcome {
    return {
      stage: this.#deps.plan.id,
      steps: [...this.#steps],
      gates: [...this.#gates.values()],
      agents: this.#agents,
      ...(this.#deps.plan.optional === undefined ? {} : { missingInputs }),
    };
  }

  /** The plan's optional inputs that are not among the stage's inputs; each is logged. */
  async #missingInputs(): Promise<Array<{ path: string; stage: string }>> {
    const missing: Array<{ path: string; stage: string }> = [];
    for (const entry of this.#deps.plan.optional ?? []) {
      const path = fill(entry.path, this.#values());
      if (!SAFE_PATH.test(path)) throw new JobFailure(`Invalid stage path "${path}"`);
      const present = await readFile(join(this.#deps.dirs.in, ...path.split("/"))).then(
        () => true,
        () => false,
      );
      if (present) continue;
      missing.push({ path, stage: entry.stage });
      await this.#deps.log(`optional input missing: ${path} (run ${entry.stage} and merge its pull request to use it)`, { missing: path, stage: entry.stage });
    }
    return missing;
  }

  // ---------------------------------------------------------------------------
  // Context for the plan's dynamic parts
  // ---------------------------------------------------------------------------

  #values(extra: Placeholders = {}): Placeholders {
    const { app, repo, commit } = this.#deps.values;
    return { app, repo, commit, run: this.#deps.run.id, ...(this.#round === 0 ? {} : { round: String(this.#round) }), ...extra };
  }

  #context(): StageContext {
    const { values, dirs } = this.#deps;
    const readText = async (path: string): Promise<string | undefined> => {
      const relative = fill(path, this.#values(), { partial: true });
      if (!SAFE_PATH.test(relative)) throw new JobFailure(`Invalid stage path "${relative}"`);
      for (const dir of [dirs.out, dirs.work, dirs.in]) {
        const text = await readFile(join(dir, ...relative.split("/")), "utf8").catch(() => undefined);
        if (text !== undefined) return text;
      }
      return undefined;
    };
    return {
      ...values,
      scope: this.#deps.scope,
      round: this.#round,
      readText,
      readJson: async (path) => {
        const text = await readText(path);
        if (text === undefined) return undefined;
        try {
          return JSON.parse(text) as unknown;
        } catch {
          throw new JobFailure(`${fill(path, this.#values(), { partial: true })} is not valid JSON`);
        }
      },
      stdout: (id) => this.#stdout.get(id),
      gate: (id) => this.#gates.get(id)?.choice,
      agentsLeft: () => Math.max(0, this.#deps.limits.maxAgents - this.#agents),
    };
  }

  async #resolve<T>(value: T | ((ctx: StageContext) => T | Promise<T>)): Promise<T> {
    return typeof value === "function" ? (value as (ctx: StageContext) => T | Promise<T>)(this.#context()) : value;
  }

  async #enabled(step: StageStep): Promise<boolean> {
    if (step.when === undefined || (await step.when(this.#context()))) return true;
    this.#record({ id: step.id, kind: step.kind, status: "skipped" });
    await this.#deps.log(`step ${step.id} skipped`, { step: step.id, skipped: true });
    return false;
  }

  #record(entry: StepRecord): void {
    this.#steps.push({ ...entry, ...(this.#round === 0 ? {} : { round: this.#round }) });
  }

  #checkAborted(): void {
    if (this.#deps.signal?.aborted === true) throw new JobFailure("aborted");
  }

  // ---------------------------------------------------------------------------
  // Steps
  // ---------------------------------------------------------------------------

  async #runStep(step: StageStep): Promise<void> {
    this.#checkAborted();
    if (!(await this.#enabled(step))) return;
    switch (step.kind) {
      case "script":
      case "agent":
      case "workflow":
        return this.#leafOrFail(step, this.#placement(step));
      case "parallel":
        return this.#group(
          step.id,
          step.steps.map((member) => ({ step: member, extra: {} })),
          this.#deps.limits.concurrency,
          false,
        );
      case "forEach":
        return this.#forEach(step);
      case "repeat":
        return this.#repeat(step);
      case "gate":
        return this.#gate(step);
    }
  }

  #placement(step: LeafStep, extra: Placeholders = {}, dirs: { out: string; work: string } = this.#deps.dirs): LeafPlacement {
    const values = this.#values(extra);
    const intermediate = step.intermediate === undefined || typeof step.intermediate === "boolean" ? (step.intermediate ?? false) : step.intermediate.map((path) => fill(path, values));
    return { inputs: [this.#deps.dirs.in, this.#deps.dirs.work, this.#deps.dirs.out], out: dirs.out, work: dirs.work, intermediate };
  }

  async #leafOrFail(step: LeafStep, placement: LeafPlacement, extra: Placeholders = {}): Promise<void> {
    const result = await this.#leaf(step, placement, extra);
    if (!result.ok) throw new JobFailure(`Step ${step.id} failed: ${result.reason}`);
  }

  /** Runs one leaf (with its repair loop for scripts); records it; never throws for a failed step. */
  #stageAborted(): boolean {
    return this.#deps.signal?.aborted === true;
  }

  async #leaf(step: LeafStep, placement: LeafPlacement, extra: Placeholders = {}, abort?: AbortSignal): Promise<LeafResult> {
    let first = await this.#start(step, placement, extra, abort);
    if (!first.ok && step.kind === "agent" && TRANSIENT_PROVIDER_FAILURE.test(first.reason) && this.#deps.signal?.aborted !== true) {
      // A provider hiccup (content filter, overload, dropped connection) is not the step's fault: one more try.
      await this.#deps.log(`step ${step.id}: the provider failed (${first.reason}); trying once more`, { step: step.id, retry: true });
      first = await this.#start(step, placement, extra, abort);
    }
    if (first.ok || step.kind !== "script" || step.repair === undefined || this.#deps.signal?.aborted === true) return first;
    await this.#deps.log(`step ${step.id} failed; ${step.repair.agent} gets the error once to fix it`, { step: step.id, repair: step.repair.id });
    const error = first.detail ?? first.reason;
    const repaired = await this.#start(step.repair, this.#placement(step.repair, { ...extra, error }, { out: placement.out, work: placement.work }), { ...extra, error }, abort);
    if (!repaired.ok) return repaired;
    return this.#start(step, placement, extra, abort);
  }

  async #start(step: LeafStep, placement: LeafPlacement, extra: Placeholders, abort?: AbortSignal): Promise<LeafResult> {
    const values = this.#values(extra);
    const key = stepKey({ id: step.id, ...(extra.key === undefined ? {} : { key: extra.key }), round: this.#round });
    if (step.kind !== "script" && this.#deps.completed?.has(key) === true) {
      this.#record({ id: step.id, kind: step.kind, status: "succeeded", reused: true, ...(extra.key === undefined ? {} : { key: extra.key }) });
      await this.#deps.log(`step ${key} succeeded in the resumed run: not run again`, { step: step.id, reused: true });
      return { id: "", ok: true, summary: { reused: true }, agents: 0 };
    }
    const spec = await this.#spec(step, values);
    if (spec.kind === "agent" && this.#agents >= this.#deps.limits.maxAgents) {
      throw new JobFailure(`Stage agent cap reached (${this.#deps.limits.maxAgents} agent jobs, KINTSUGI_STAGE_MAX_AGENTS) before step ${step.id}`);
    }
    if (spec.kind === "agent") this.#agents += 1;
    const result = await this.#deps.runLeaf(spec, placement, abort);
    if (result.ok) {
      if (spec.kind === "workflow") this.#agents += result.agents;
      if (result.stdout !== undefined) this.#stdout.set(step.id, result.stdout.slice(-MAX_STDOUT));
    }
    this.#record({
      id: step.id,
      kind: step.kind,
      name: spec.name,
      runId: result.id,
      status: result.ok ? "succeeded" : "failed",
      ...(extra.key === undefined ? {} : { key: extra.key }),
      ...(result.ok ? {} : { reason: result.reason }),
    });
    return result;
  }

  /** The child run of a leaf: stage values filled now, workspace paths by the child itself. */
  async #spec(step: LeafStep, values: Placeholders): Promise<LeafRun> {
    const partial = (text: string): string => fill(text, values, { partial: true });
    const expects = (step.expects ?? []).map(partial);
    switch (step.kind) {
      case "script": {
        const args = (await this.#resolve(step.args)).map(partial);
        const name = step.fromInputs === true ? (partial(step.script).split("/").at(-1) ?? step.script) : step.script;
        return {
          kind: "script",
          name,
          inputs: {
            args,
            ...(step.fromInputs === true ? { scriptFromInputs: partial(step.script) } : {}),
            ...(step.stdoutTo === undefined ? {} : { stdoutTo: partial(step.stdoutTo) }),
            ...(expects.length === 0 ? {} : { expects }),
          },
        };
      }
      case "agent":
        return {
          kind: "agent",
          name: step.agent,
          inputs: {
            task: partial(step.task),
            ...(step.documents === undefined ? {} : { documents: step.documents.map(partial) }),
            ...(step.schema === undefined ? {} : { schema: step.schema, resultFile: true }),
            ...(step.resultTo === undefined ? {} : { resultTo: partial(step.resultTo) }),
            ...(expects.length === 0 ? {} : { expects }),
            label: step.id,
          },
        };
      case "workflow": {
        const left = Math.max(0, this.#deps.limits.maxAgents - this.#agents);
        return {
          kind: "workflow",
          name: step.workflow,
          inputs: {
            args: await this.#resolve(step.args),
            budget: { maxAgents: left },
            ...(step.resultTo === undefined ? {} : { resultTo: partial(step.resultTo) }),
            ...(expects.length === 0 ? {} : { expects }),
          },
        };
      }
    }
  }

  /** Members run with the same inputs; their outputs are merged once all have finished. */
  async #group(id: string, members: ReadonlyArray<{ step: LeafStep; extra: Placeholders }>, concurrency: number, tolerateFailures: boolean): Promise<void> {
    this.#groups += 1;
    const staging = join(this.#deps.dirs.root, `group-${this.#groups}`);
    const dirs = { out: join(staging, "out"), work: join(staging, "work") };
    await mkdir(dirs.out, { recursive: true });
    await mkdir(dirs.work, { recursive: true });
    try {
      const slots = new Semaphore(Math.max(1, concurrency));
      const enabled: Array<{ step: LeafStep; extra: Placeholders }> = [];
      for (const member of members) if (await this.#enabled(member.step)) enabled.push(member);
      // Every member settles before the group ends (no step keeps running behind a failure). When one
      // fails and the group does not tolerate it, the others are stopped at once: their work is lost anyway.
      const stop = new AbortController();
      let firstFailure: { step: string; reason: string } | undefined;
      const results = await Promise.all(
        enabled.map((member) =>
          slots.run(async (): Promise<LeafResult> => {
            if (this.#deps.signal?.aborted === true) return { id: "", ok: false, reason: "aborted" };
            if (stop.signal.aborted) return { id: "", ok: false, reason: "not started: another step of the group failed" };
            let result: LeafResult;
            try {
              result = await this.#leaf(member.step, this.#placement(member.step, member.extra, dirs), member.extra, stop.signal);
            } catch (error) {
              result = { id: "", ok: false, reason: error instanceof Error ? error.message : String(error) };
            }
            if (!result.ok && !tolerateFailures && !stop.signal.aborted && !this.#stageAborted()) {
              firstFailure = { step: member.step.id, reason: result.reason };
              stop.abort(new Error("another step of the group failed"));
              await this.#deps.log(`step ${id}: ${member.step.id} failed; stopping the rest of the group`, { step: id, failed: member.step.id });
            }
            return result;
          }),
        ),
      );
      this.#checkAborted();
      const failed = results.flatMap((result, index) => (result.ok ? [] : [{ step: enabled[index]!.step.id, reason: result.reason }]));
      if (failed.length > 0 && !tolerateFailures) {
        const first = firstFailure ?? failed[0]!;
        throw new JobFailure(`Step ${id} failed: ${first.step}: ${first.reason}${failed.length > 1 ? ` (and ${failed.length - 1} more)` : ""}`);
      }
      if (failed.length > 0) await this.#deps.log(`step ${id}: ${failed.length} of ${results.length} failed and are left out`, { step: id, failed: failed.length });
      await copyTree(dirs.out, this.#deps.dirs.out);
      await copyTree(dirs.work, this.#deps.dirs.work);
    } finally {
      await rm(staging, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
    }
  }

  async #forEach(step: ForEachStep): Promise<void> {
    const items = await step.items(this.#context());
    const left = Math.max(0, this.#deps.limits.maxAgents - this.#agents);
    const taken = items.slice(0, left);
    if (taken.length < items.length) await this.#deps.log(`step ${step.id}: ${items.length - taken.length} of ${items.length} items left out (stage agent cap)`, { step: step.id });
    await this.#deps.log(`step ${step.id}: ${taken.length} job(s)`, { step: step.id, items: taken.length });
    const member: AgentStep = step.step;
    await this.#group(
      step.id,
      taken.map((entry) => ({ step: member, extra: { item: entry.item, key: entry.key } })),
      Math.min(step.concurrency ?? this.#deps.limits.concurrency, this.#deps.limits.concurrency),
      step.tolerateFailures === true,
    );
  }

  async #repeat(step: RepeatStep): Promise<void> {
    const outer = this.#round;
    try {
      for (let round = 1; round <= step.max; round++) {
        this.#round = round;
        for (const member of step.steps) {
          this.#checkAborted();
          if (!(await this.#enabled(member))) continue;
          if (member.kind === "gate") await this.#gate(member);
          else await this.#leafOrFail(member, this.#placement(member, { maxRounds: String(step.max) }), { maxRounds: String(step.max) });
        }
        if (await step.until(this.#context())) {
          await this.#deps.log(`step ${step.id}: done after round ${round}`, { step: step.id, rounds: round });
          return;
        }
      }
      await this.#deps.log(`step ${step.id}: stopped after ${step.max} rounds`, { step: step.id, rounds: step.max });
    } finally {
      this.#round = outer;
    }
  }

  async #gate(step: GateStep): Promise<void> {
    const question = await this.#resolve(step.question);
    const { run, plan, gates, signal } = this.#deps;
    const decision = await gates.decide(
      { runId: run.id, projectId: run.projectId, ...(run.applicationId === undefined ? {} : { applicationId: run.applicationId }), stage: plan.id, gate: step.id, question, options: step.options, default: step.default, decisionMode: step.decisionMode, ...(this.#deps.resumeOf === undefined ? {} : { resumeOf: this.#deps.resumeOf }) },
      signal,
    );
    if (!step.options.includes(decision.choice)) throw new JobFailure(`Gate ${step.id} returned a choice outside its allowed options`);
    if (step.decisionMode === "required-human" && (decision.defaulted || decision.by === undefined || decision.by.trim() === "")) {
      throw new JobFailure(`Gate ${step.id} requires a decision from an authenticated human`);
    }
    if (step.decisionMode === "default" && (!decision.defaulted || decision.choice !== step.default)) {
      throw new JobFailure(`Gate ${step.id} must use its documented default`);
    }
    const choice = decision.choice;
    this.#gates.set(step.id, { id: step.id, question, choice, defaulted: decision.defaulted, ...(decision.by === undefined ? {} : { by: decision.by }) });
    await this.#deps.log(decision.defaulted ? `gate defaulted: ${step.id} — ${question} → ${choice}` : `gate decided: ${step.id} → ${choice}${decision.by === undefined ? "" : ` by ${decision.by}`}`, {
      gate: step.id,
      choice,
      defaulted: decision.defaulted,
    });
    if (step.stopOn?.includes(choice) === true) throw new JobFailure(`Stopped at gate ${step.id}: ${choice}`);
  }
}
