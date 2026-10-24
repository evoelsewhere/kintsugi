// Workflow executor (ADR-0027): runs a multi-job workflow from packages/agents/builtin/plugins/*/workflows
// (never from a repository). A workflow module is plain JavaScript with `export const meta`
// and a top-level body that may `await` and `return`; its body runs as an async function
// with injected globals:
//
//   args                        the caller's arguments
//   log(message)                progress line
//   agent(prompt, options)      starts one agent job; resolves to its result, or null when it failed
//   parallel(thunks)            runs thunks; a failed thunk yields null (positions are kept)
//   pipeline(items, fn)         fn(item, item, index) for every item, bounded concurrency
//   phase(title)                marks a phase
//   budget                      { total, remaining() } in tokens (total 0 = unlimited), and
//                               budget.agents { total, remaining() }: the agent-job cap a stage hands over (Infinity when none)
//
// Budgets: `concurrency` agent jobs at a time, and, only when a stage hands over what is left of its own budget, at most `maxAgents` in all. The code
// runs in a separate VM context with only these globals — a convenience, not a security
// boundary: workflows are Kintsugi's own reviewed code.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { findBuiltinFile } from "@kintsugi/agents";


const WORKFLOW_NAME = /^[a-z][a-z0-9-]{0,63}$/;

export interface AgentCallOptions {
  agentType?: string;
  label?: string;
  phase?: string;
  schema?: Record<string, unknown>;
}

export interface AgentCallResult {
  /** The structured result (schema calls) or a summary; undefined when the job failed. */
  result?: unknown;
  tokens: number;
}

export interface WorkflowBudgets {
  /** Agent jobs the workflow may start in all; absent = no limit (a stage hands over what is left of its own). */
  maxAgents?: number;
  concurrency: number;
  /** Token budget across the workflow's agent jobs; 0 = unlimited. */
  maxTokens?: number;
}

export interface WorkflowRun {
  source: string;
  args: unknown;
  budgets: WorkflowBudgets;
  runAgent(prompt: string, options: AgentCallOptions): Promise<AgentCallResult>;
  log(message: string): void;
}

export interface WorkflowOutcome {
  result: unknown;
  agents: number;
  failedAgents: number;
  tokens: number;
  meta?: unknown;
}

/** Loads a built-in workflow by id (the file name without `.js`). */
export async function loadWorkflow(name: string, dir?: string): Promise<string> {
  if (!WORKFLOW_NAME.test(name)) throw new Error(`Invalid workflow id "${name}"`);
  const file = dir === undefined ? findBuiltinFile("workflows", `${name}.js`) : join(dir, `${name}.js`);
  if (file === undefined) throw new Error(`No built-in plugin has a workflow "${name}"`);
  return readFile(file, "utf8");
}

/** Turns a workflow module into the body of an async function. */
export function workflowBody(source: string): string {
  const body = source.replace(/^export\s+const\s+meta\s*=/m, "const meta =");
  if (/^\s*(import|export)\b/m.test(body)) throw new Error("A workflow may not import modules or export anything but `meta`");
  return body;
}

/** At most `limit` pieces of work at a time, started in call order. */
export class Semaphore {
  #active = 0;
  readonly #waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.#active >= this.limit) await new Promise<void>((resolve) => this.#waiting.push(resolve));
    this.#active += 1;
    try {
      return await work();
    } finally {
      this.#active -= 1;
      this.#waiting.shift()?.();
    }
  }
}

export async function runWorkflow(run: WorkflowRun): Promise<WorkflowOutcome> {
  const { budgets } = run;
  const agentSlots = new Semaphore(Math.max(1, budgets.concurrency));
  const totalTokens = budgets.maxTokens ?? 0;
  let started = 0;
  let failed = 0;
  let tokens = 0;

  const maxAgents = budgets.maxAgents ?? Number.POSITIVE_INFINITY;
  const agents = Object.freeze({ total: maxAgents, remaining: () => Math.max(0, maxAgents - started) });
  const budget = Object.freeze({ total: totalTokens, remaining: () => (totalTokens === 0 ? Number.POSITIVE_INFINITY : totalTokens - tokens), agents });

  const agent = async (prompt: unknown, options: AgentCallOptions = {}): Promise<unknown> => {
    if (typeof prompt !== "string" || prompt.trim() === "") throw new Error("agent(prompt) needs a non-empty prompt");
    if (started >= maxAgents) throw new Error(`workflow agent cap reached (${maxAgents})`);
    if (totalTokens > 0 && tokens >= totalTokens) throw new Error("workflow token budget exhausted");
    started += 1;
    return agentSlots.run(async () => {
      const outcome = await run.runAgent(prompt, options);
      tokens += outcome.tokens;
      if (outcome.result === undefined) {
        failed += 1;
        return null;
      }
      return outcome.result;
    });
  };

  const parallel = async (thunks: unknown): Promise<unknown[]> => {
    if (!Array.isArray(thunks)) throw new Error("parallel() takes an array of functions");
    return Promise.all(
      // Thunks start in array order; agent() bounds how many jobs actually run at once.
      thunks.map(async (thunk) => {
        try {
          return typeof thunk === "function" ? await (thunk as () => unknown)() : await thunk;
        } catch (error) {
          run.log(`parallel step failed: ${error instanceof Error ? error.message : String(error)}`);
          return null;
        }
      }),
    );
  };

  const pipeline = async (items: unknown, fn: (item: unknown, original: unknown, index: number) => unknown): Promise<unknown[]> => {
    if (!Array.isArray(items)) throw new Error("pipeline() takes an array");
    return parallel(items.map((item, index) => () => fn(item, item, index)));
  };

  const log = (message: unknown): void => run.log(String(message));
  const phase = (title: unknown): void => run.log(`phase: ${String(title)}`);

  const context = { args: run.args, log, agent, parallel, pipeline, phase, budget };
  const factory = runInNewContext(`(async function workflow() {\n${workflowBody(run.source)}\n})`, context, {
    filename: "workflow.js",
    timeout: 10_000,
  }) as () => Promise<unknown>;
  const result = await factory();
  return { result, agents: started, failedAgents: failed, tokens };
}
