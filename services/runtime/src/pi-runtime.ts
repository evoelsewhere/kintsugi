// pi backend of the Kintsugi Runtime (ADR-0001): one pi AgentSession per job inside the
// runner container (ADR-0004), with pi's events mapped onto the JobEvent contract from
// packages/runtime-sdk. The runner mounts the job's read-only checkout at /src and writes
// only to /out; the worker commits /out to the workspace repo (ADR-0007).
//
// ToolPolicy is enforced at session construction: pi's tool allowlist is exactly the
// agent's `allowTools` (built-in agents are fixed in code, ADR-0014). `denyBashPatterns`
// is enforced by the `policy` pi extension at tool-call time (services/runtime README).

import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type { JobEvent, JobHandle, JobSpec } from "@kintsugi/runtime-sdk";
import type { PiJobBackend } from "./agent-runtime.js";
import { EventStream } from "./event-stream.js";
import { describeInputs } from "./job-inputs.js";
import { RUNTIME_VERSION } from "./version.js";

type CreateSessionOptions = NonNullable<Parameters<typeof createAgentSession>[0]>;
type ThinkingLevelOption = CreateSessionOptions["thinkingLevel"];

const now = (): string => new Date().toISOString();

export interface PiBackendOptions {
  /** Job checkout. The runner image mounts it read-only at /src. */
  cwd?: string;
  /** Built by the launcher from the LLM provider registry (ADR-0009). Defaults to models.json + auth.json. */
  modelRuntime?: ModelRuntime;
}

/** Minimal structural view of pi messages, used only for usage accounting. */
interface UsageLike {
  input?: number;
  output?: number;
  cost?: { total?: number };
}

interface MessageLike {
  role?: string;
  usage?: UsageLike;
}

function readUsage(message: unknown): UsageLike | undefined {
  return (message as MessageLike | undefined)?.usage;
}

/** Prompt composed here until the per-agent prompts land in services/runtime/agents/ (ADR-0014). */
function composePrompt(spec: JobSpec): string {
  const lines = [
    `You are the Kintsugi runtime agent "${spec.agent.id}" (version ${spec.agent.version}).`,
    `Project: ${spec.context.projectId}${spec.context.applicationId ? ` / application ${spec.context.applicationId}` : ""}.`,
    `Rulebook: ${spec.rulebook.version}${spec.rulebook.commit ? ` @ ${spec.rulebook.commit}` : ""}; packs: ${spec.packs.join(", ") || "(none)"}.`,
    `Required capabilities: ${spec.requires.join(", ") || "(none)"}.`,
    `Inputs (read-only): ${describeInputs(spec.inputs) || "(none)"}.`,
    "Work only on platform tasks and write only to /out.",
  ];
  if (spec.instruction) {
    lines.push("", "## Instruction", spec.instruction);
  }
  return lines.join("\n");
}

class PiJob implements JobHandle {
  readonly events = new EventStream<JobEvent>();
  readonly done: Promise<Extract<JobEvent, { type: "job.completed" }>>;

  #settled = false;
  #resolveDone!: (event: Extract<JobEvent, { type: "job.completed" }>) => void;
  #rejectDone!: (error: unknown) => void;
  #inputTokens = 0;
  #outputTokens = 0;
  #costUsd = 0;
  #unsubscribe: (() => void) | undefined;

  constructor(
    readonly jobId: string,
    private readonly spec: JobSpec,
    private readonly session: AgentSession,
  ) {
    this.done = new Promise((resolve, reject) => {
      this.#resolveDone = resolve;
      this.#rejectDone = reject;
    });
    this.done.catch(() => undefined);
  }

  /** Wired by the backend right after `session.subscribe()` returns its unsubscriber. */
  attach(unsubscribe: () => void): void {
    this.#unsubscribe = unsubscribe;
  }

  async followUp(message: string): Promise<void> {
    if (this.#settled) throw new Error("job already finished");
    await this.session.prompt(message);
  }

  async abort(reason: string): Promise<void> {
    if (this.#settled) return;
    await this.session.abort();
    this.#fail(reason);
  }

  /** Called by the backend with every AgentSessionEvent pi emits. */
  onSessionEvent(event: AgentSessionEvent): void {
    if (this.#settled) return;

    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      this.events.push({ type: "message.delta", jobId: this.jobId, text: event.assistantMessageEvent.delta });
      return;
    }

    if (event.type === "tool_execution_start") {
      // Only allowlisted tools reach the session; blocked tools never execute.
      this.events.push({
        type: "tool.call",
        jobId: this.jobId,
        callId: event.toolCallId,
        tool: event.toolName,
        input: event.args,
        decision: "allowed",
      });
      return;
    }

    if (event.type === "tool_execution_end") {
      this.events.push({
        type: "tool.result",
        jobId: this.jobId,
        callId: event.toolCallId,
        ok: !event.isError,
        summary: event.durationMs === undefined ? undefined : `took ${event.durationMs} ms`,
      });
      return;
    }

    if (event.type === "message_end") {
      const usage = readUsage(event.message);
      if (usage) {
        this.#inputTokens += usage.input ?? 0;
        this.#outputTokens += usage.output ?? 0;
        this.#costUsd += usage.cost?.total ?? 0;
      }
    }
  }

  /** Called when the prompt run has finished (or aborted). */
  onComplete(): void {
    if (this.#settled) return;
    this.events.push({
      type: "usage",
      jobId: this.jobId,
      model: `${this.spec.model.provider}/${this.spec.model.id}`,
      inputTokens: this.#inputTokens,
      outputTokens: this.#outputTokens,
      costUsd: this.#costUsd,
    });

    if (this.spec.budget.maxCostUsd !== undefined && this.#costUsd > this.spec.budget.maxCostUsd) {
      this.#fail(`budget exceeded: ${this.#costUsd} USD > ${this.spec.budget.maxCostUsd} USD`);
      return;
    }

    this.#settled = true;
    const event: Extract<JobEvent, { type: "job.completed" }> = {
      type: "job.completed",
      jobId: this.jobId,
      at: now(),
      summary: `${this.spec.agent.id} run complete: ${this.#inputTokens} input / ${this.#outputTokens} output tokens`,
    };
    this.#teardown();
    this.events.push(event);
    this.events.close();
    this.#resolveDone(event);
  }

  #fail(error: string): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#teardown();
    this.events.push({ type: "job.failed", jobId: this.jobId, at: now(), error });
    this.events.close();
    this.#rejectDone(new Error(error));
  }

  #teardown(): void {
    this.#unsubscribe?.();
    this.session.dispose();
  }

  /** Used by the backend to fail the job before the session exists. */
  failBeforeStart(error: string): void {
    this.#fail(error);
  }
}

export function createPiJobBackend(options: PiBackendOptions = {}): PiJobBackend {
  const cwd = options.cwd ?? process.env["KINTSUGI_JOB_SRC"] ?? "/src";
  const modelRuntimePromise: Promise<ModelRuntime> =
    options.modelRuntime === undefined ? ModelRuntime.create() : Promise.resolve(options.modelRuntime);

  return {
    async startJob(spec: JobSpec): Promise<JobHandle> {
      const jobId = crypto.randomUUID();
      const modelRuntime = await modelRuntimePromise;
      const model = modelRuntime.getModel(spec.model.provider, spec.model.id);
      if (model === undefined) {
        throw new Error(`model ${spec.model.provider}/${spec.model.id} is not in the provider registry (ADR-0009)`);
      }

      const { session } = await createAgentSession({
        cwd,
        modelRuntime,
        model,
        thinkingLevel: spec.model.thinking as ThinkingLevelOption,
        tools: spec.policy.allowTools,
        sessionManager: SessionManager.inMemory(),
      });

      const job = new PiJob(jobId, spec, session);
      job.attach(session.subscribe((event) => job.onSessionEvent(event)));

      job.events.push({ type: "job.started", jobId, at: now(), runtimeVersion: RUNTIME_VERSION });

      const timeoutMs = spec.budget.timeoutSec * 1000;
      const timer = setTimeout(() => {
        void job.abort(`timeout after ${spec.budget.timeoutSec}s`);
      }, timeoutMs);

      void session
        .prompt(composePrompt(spec))
        .then(() => {
          clearTimeout(timer);
          job.onComplete();
        })
        .catch((error: unknown) => {
          clearTimeout(timer);
          job.failBeforeStart(error instanceof Error ? error.message : String(error));
        });

      return job;
    },
  };
}
