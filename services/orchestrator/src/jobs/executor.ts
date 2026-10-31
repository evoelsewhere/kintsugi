// The generic stage-plan executor (ADR-0027): walks a StagePlan (plan.ts) and runs every leaf
// step — script, agent job, workflow — through the job runner as a child run of the stage.
// It owns what makes a plan more than a list: conditions, parallel groups, per-item fan-out,
// repeat-until loops, the script repair loop, gates, the stage's agent budget, and which
// outputs are published (the stage's out/) and which are intermediate (its work/).
//
// Groups (parallel, forEach) give every member the same inputs: their outputs are staged and
// merged into the stage when the whole group has finished (also when a member failed: what the others wrote
// is kept for the next attempt of the job, ADR-0055).
//
// A later attempt of the job skips a step that already succeeded when nothing it was given changed (StepReuse):
// the executor keeps the upstream chain, a hash of everything that came before a step in the plan.

import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chainAfter, contributionOf, digestOf, type LedgerOutput } from "../workspace/ledger.js";
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
  /** The step's key in the plan (`<step id>[#<item>][@<round>]`), which names its folder in the job workspace; set by the executor. */
  key?: string;
}

/** What the executor knows of a step's place in the plan, added to its result (the runner does not set it). */
interface Contribution {
  /** What the step adds to the upstream chain of the steps after it. */
  contribution?: string;
}

export type LeafResult =
  | ({ id: string; ok: true; summary: Record<string, unknown>; stdout?: string; agents: number; outputs?: LedgerOutput[]; digest?: string } & Contribution)
  | ({ id: string; ok: false; reason: string; detail?: string } & Contribution);

/** What an earlier attempt of the job recorded about a step (the ledger, ADR-0055). */
export interface StepReuse {
  /** What the step would run with, given the chain of the steps before it. */
  fingerprint(spec: LeafRun, upstream: string): Promise<string>;
  /** The step's success in an earlier attempt, if its fingerprint is this one and what it wrote is still there. */
  settled(key: string, fingerprint: string): Promise<{ digest: string } | undefined>;
  /** Records how the step ended. */
  record(key: string, entry: { status: "succeeded" | "failed"; fingerprint: string; digest: string; outputs: LedgerOutput[]; reason?: string }): Promise<void>;
}

export interface ExecutorDeps {
  plan: StagePlan;
  /** The stage run, for gate requests. */
  run: { id: string; projectId: string; applicationId?: string };
  values: { app: string; sources: string };
  /** The stage's directories: declared documents (in), intermediate outputs (work), published outputs (out). */
  dirs: { root: string; in: string; work: string; out: string };
  /** `maxAgents` absent: a stage may start any number of agent jobs. */
  limits: { maxAgents?: number; concurrency: number };
  gates: GateDecider;
  /** `abort`: stops this leaf when a sibling of its group failed (the stage's own `signal` still applies). */
  runLeaf(spec: LeafRun, placement: LeafPlacement, abort?: AbortSignal): Promise<LeafResult>;
  log(message: string, data?: Record<string, unknown>): Promise<void>;
  signal?: AbortSignal;
  /** The selection of a scoped run (ADR-0033). */
  scope?: StageScope;
  /**
   * Later attempts of the job: the agent and workflow steps (and forEach items) that already succeeded with
   * the same fingerprint are not run again; their outputs are in the stage's out/ and work/. Script steps
   * always run again: they are cheap, deterministic, and the guard before publication.
   */
  /** Earlier run id for legacy persisted gate decisions. */
  resumeOf?: string;
  reuse?: StepReuse;
  /** Gate choices already accepted in a previous attempt. */
  gateChoices?: ReadonlyMap<string, string>;
  /** Record the choice for a later attempt. */
  onGate?: (id: string, choice: string) => Promise<void>;
}

/** The key of a leaf step: `<step id>[#<forEach key>][@<round>]`. It names the step in the ledger and its folder in the workspace. */
export const stepKey = (step: { id: string; key?: string; round?: number }): string =>
  `${step.id}${step.key === undefined ? "" : `#${step.key}`}${step.round === undefined || step.round === 0 ? "" : `@${step.round}`}`;

/** A failed stage, with what it recorded so far (persisted in the run's summary). */
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
  /** An earlier attempt already ran this step with the same fingerprint; its outputs were kept. */
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
  /** The upstream chain: everything that came before the next step in the plan (see ledger.ts). */
  #chain: string;

  constructor(deps: ExecutorDeps) {
    this.#deps = deps;
    this.#chain = digestOf(["stage", deps.plan.id]);
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
    const { app, sources } = this.#deps.values;
    return { app, sources, run: this.#deps.run.id, ...(this.#round === 0 ? {} : { round: String(this.#round) }), ...extra };
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
      agentsLeft: () => this.#agentsLeft(),
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
        return this.#fold((await this.#leafOrFail(step, this.#placement(step))).contribution);
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

  async #leafOrFail(step: LeafStep, placement: LeafPlacement, extra: Placeholders = {}): Promise<LeafResult> {
    const result = await this.#leaf(step, placement, extra);
    if (!result.ok) throw new JobFailure(`Step ${step.id} failed: ${result.reason}`);
    return result;
  }

  /** A sequential step has finished: what it adds to the chain is what the steps after it depend on. */
  #fold(contribution: string | undefined): void {
    if (contribution !== undefined) this.#chain = chainAfter(this.#chain, [contribution]);
  }

  /** Runs one leaf (with its repair loop for scripts); records it; never throws for a failed step. */
  #stageAborted(): boolean {
    return this.#deps.signal?.aborted === true;
  }

  /** `upstream`: the chain the step starts from; the members of a group all start from the chain before the group. */
  async #leaf(step: LeafStep, placement: LeafPlacement, extra: Placeholders = {}, abort?: AbortSignal, upstream: string = this.#chain): Promise<LeafResult> {
    let first = await this.#start(step, placement, extra, abort, upstream);
    if (!first.ok && step.kind === "agent" && TRANSIENT_PROVIDER_FAILURE.test(first.reason) && this.#deps.signal?.aborted !== true) {
      // A provider hiccup (content filter, overload, dropped connection) is not the step's fault: one more try.
      await this.#deps.log(`step ${step.id}: the provider failed (${first.reason}); trying once more`, { step: step.id, retry: true });
      first = await this.#start(step, placement, extra, abort, upstream);
    }
    if (first.ok || step.kind !== "script" || step.repair === undefined || this.#deps.signal?.aborted === true) return first;
    await this.#deps.log(`step ${step.id} failed; ${step.repair.agent} gets the error once to fix it`, { step: step.id, repair: step.repair.id });
    const error = first.detail ?? first.reason;
    const repaired = await this.#start(step.repair, this.#placement(step.repair, { ...extra, error }, { out: placement.out, work: placement.work }), { ...extra, error }, abort, upstream);
    if (!repaired.ok) return repaired;
    return this.#start(step, placement, extra, abort, upstream);
  }

  async #start(step: LeafStep, placement: LeafPlacement, extra: Placeholders, abort: AbortSignal | undefined, upstream: string): Promise<LeafResult> {
    const values = this.#values(extra);
    const key = stepKey({ id: step.id, ...(extra.key === undefined ? {} : { key: extra.key }), round: this.#round });
    const spec = await this.#spec(step, values);
    const reuse = this.#deps.reuse;
    const fingerprint = reuse === undefined ? undefined : await reuse.fingerprint(spec, upstream);
    if (reuse !== undefined && fingerprint !== undefined && step.kind !== "script") {
      const settled = await reuse.settled(key, fingerprint);
      if (settled !== undefined) {
        this.#record({ id: step.id, kind: step.kind, name: spec.name, status: "succeeded", reused: true, ...(extra.key === undefined ? {} : { key: extra.key }) });
        await this.#deps.log(`step ${key} succeeded in an earlier attempt and nothing it was given changed: not run again`, { step: step.id, reused: true });
        return { id: "", ok: true, summary: { reused: true }, agents: 0, contribution: contributionOf(key, fingerprint, settled.digest) };
      }
    }
    if (spec.kind === "agent" && this.#agentsLeft() === 0) {
      throw new JobFailure(`Stage agent cap reached (${this.#deps.limits.maxAgents} agent jobs) before step ${step.id}`);
    }
    if (spec.kind === "agent") this.#agents += 1;
    const result = await this.#deps.runLeaf(spec, { ...placement, key }, abort);
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
    if (reuse === undefined || fingerprint === undefined) return result;
    // A script is a function of what it is given, which the fingerprint covers; what it wrote may carry a timestamp. An
    // agent's output is what the steps after it were given, so its content goes into the chain.
    const digest = !result.ok ? "failed" : step.kind === "script" ? "script" : (result.digest ?? "");
    await reuse.record(key, { status: result.ok ? "succeeded" : "failed", fingerprint, digest, outputs: result.ok ? (result.outputs ?? []) : [], ...(result.ok ? {} : { reason: result.reason }) });
    return { ...result, contribution: contributionOf(key, fingerprint, digest) };
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
            task: partial(await this.#resolve(step.task)),
            ...(step.documents === undefined ? {} : { documents: (await this.#resolve(step.documents)).map(partial) }),
            ...(step.schema === undefined ? {} : { schema: step.schema, resultFile: true }),
            ...(step.resultTo === undefined ? {} : { resultTo: partial(step.resultTo) }),
            ...(step.readsTo === undefined ? {} : { readsTo: partial(step.readsTo) }),
            ...(expects.length === 0 ? {} : { expects }),
            label: step.id,
          },
        };
      case "workflow": {
        const left = this.#agentsLeft();
        return {
          kind: "workflow",
          name: step.workflow,
          inputs: {
            args: await this.#resolve(step.args),
            ...(Number.isFinite(left) ? { budget: { maxAgents: left } } : {}),
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
    const before = this.#chain;
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
              result = await this.#leaf(member.step, this.#placement(member.step, member.extra, dirs), member.extra, stop.signal, before);
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
      const failed = results.flatMap((result, index) => (result.ok ? [] : [{ step: enabled[index]!.step.id, reason: result.reason }]));
      if (this.#stageAborted() || (failed.length > 0 && !tolerateFailures)) {
        // What the members that succeeded wrote is kept: the next attempt of the job skips them.
        await copyTree(dirs.out, this.#deps.dirs.out);
        await copyTree(dirs.work, this.#deps.dirs.work);
        // A cancelled stage keeps them too (ADR-0090).
        this.#checkAborted();
        const first = firstFailure ?? failed[0]!;
        throw new JobFailure(`Step ${id} failed: ${first.step}: ${first.reason}${failed.length > 1 ? ` (and ${failed.length - 1} more)` : ""}`);
      }
      if (failed.length > 0) await this.#deps.log(`step ${id}: ${failed.length} of ${results.length} failed and are left out`, { step: id, failed: failed.length });
      await copyTree(dirs.out, this.#deps.dirs.out);
      await copyTree(dirs.work, this.#deps.dirs.work);
      this.#chain = chainAfter(
        before,
        results.flatMap((result) => (result.contribution === undefined ? [] : [result.contribution])),
      );
    } finally {
      await rm(staging, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
    }
  }

  /** Agent jobs the stage may still start; Infinity when it has no limit. */
  #agentsLeft(): number {
    const max = this.#deps.limits.maxAgents;
    return max === undefined ? Number.POSITIVE_INFINITY : Math.max(0, max - this.#agents);
  }

  async #forEach(step: ForEachStep): Promise<void> {
    const items = await step.items(this.#context());
    const taken = items.slice(0, this.#agentsLeft());
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
    const extra: Placeholders = step.max === undefined ? {} : { maxRounds: String(step.max) };
    try {
      for (let round = 1; step.max === undefined || round <= step.max; round++) {
        if (round > 1 && this.#agentsLeft() === 0) {
          await this.#deps.log(`step ${step.id}: stopped after ${round - 1} round(s), the stage agent cap is reached`, { step: step.id, rounds: round - 1, stopped: "agent-cap" });
          return;
        }
        this.#round = round;
        const started = this.#agents;
        for (const member of step.steps) {
          this.#checkAborted();
          if (!(await this.#enabled(member))) continue;
          if (member.kind === "gate") await this.#gate(member);
          else if (member.kind === "forEach") await this.#forEach(member);
          else this.#fold((await this.#leafOrFail(member, this.#placement(member, extra), extra)).contribution);
        }
        if (await step.until(this.#context())) {
          await this.#deps.log(`step ${step.id}: done after round ${round}`, { step: step.id, rounds: round });
          return;
        }
        if (this.#agents === started) {
          await this.#deps.log(`step ${step.id}: stopped after round ${round}, it started no agent job`, { step: step.id, rounds: round, stopped: "idle" });
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
    const replayed = this.#deps.gateChoices?.get(step.id);
    const decision = replayed !== undefined && step.options.includes(replayed)
      ? { choice: replayed, defaulted: false, by: "an earlier attempt" }
      : await gates.decide(
          { runId: run.id, projectId: run.projectId, ...(run.applicationId === undefined ? {} : { applicationId: run.applicationId }), stage: plan.id, gate: step.id, question, options: step.options, default: step.default, decisionMode: step.decisionMode, ...(this.#deps.resumeOf === undefined ? {} : { resumeOf: this.#deps.resumeOf }) },
          signal,
        );
    if (!step.options.includes(decision.choice)) throw new JobFailure("Gate " + step.id + " returned a choice outside its allowed options");
    if (replayed === undefined && step.decisionMode === "required-human" && (decision.defaulted || decision.by === undefined || decision.by.trim() === "")) {
      throw new JobFailure("Gate " + step.id + " requires a decision from an authenticated human");
    }
    if (replayed === undefined && step.decisionMode === "default" && (!decision.defaulted || decision.choice !== step.default)) {
      throw new JobFailure("Gate " + step.id + " must use its documented default");
    }
    if (replayed !== undefined && step.decisionMode === "default" && decision.choice !== step.default) {
      throw new JobFailure("Gate " + step.id + " must use its documented default");
    }
    const choice = decision.choice;
    await this.#deps.onGate?.(step.id, choice);
    this.#chain = chainAfter(this.#chain, [digestOf(["gate", step.id, choice])]);
    this.#gates.set(step.id, { id: step.id, question, choice, defaulted: decision.defaulted, ...(decision.by === undefined ? {} : { by: decision.by }) });
    await this.#deps.log(decision.defaulted ? `gate defaulted: ${step.id} — ${question} → ${choice}` : `gate decided: ${step.id} → ${choice}${decision.by === undefined ? "" : ` by ${decision.by}`}`, {
      gate: step.id,
      choice,
      defaulted: decision.defaulted,
    });
    if (step.stopOn?.includes(choice) === true) throw new JobFailure(`Stopped at gate ${step.id}: ${choice}`);
  }
}
