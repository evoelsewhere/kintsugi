// pi backend of the Kintsugi Runtime (ADR-0001): one pi AgentSession per job inside the
// runner container (ADR-0004), with pi's events mapped onto the JobEvent contract from
// packages/runtime-sdk. The runner mounts the job's read-only checkout at /src and writes
// only to /out; the worker commits /out to the workspace repo (ADR-0007).
//
// Full agent features are wired here: agent catalog prompts + skills (ADR-0014), the
// Kintsugi extensions (system prompt, policy) and pi's built-in extensions (codemode,
// tool_search, MCP), plus the custom Kintsugi tools (kb_search, outputs_write).
// ToolPolicy: the allowlist is enforced at session construction; denyBashPatterns is
// enforced by the policy extension at tool-call time (blocked calls are surfaced as
// JobEvent tool.call with decision "blocked").

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createAgentSession,
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type { JobEvent, JobHandle, JobSpec } from "@kintsugi/runtime-sdk";
import { agentDefinition } from "./agents/catalog.js";
import { buildJobSystemPrompt, buildSystemPrompt, resolveSkillTexts } from "./agents/system-prompt.js";
import type { PiJobBackend } from "./agent-runtime.js";
import { EventStream } from "./event-stream.js";
import { createPolicyExtension, createSystemPromptExtension, type PolicySink } from "./extensions/kintsugi.js";
import { describeInputs } from "./job-inputs.js";
import { createGitReadTool, kbAskTool, webFetchTool } from "./tools/harness-tools.js";
import { createOutputsWriteTool, kbSearchTool } from "./tools/kintsugi-tools.js";
import { RUNTIME_VERSION } from "./version.js";

type CreateSessionOptions = NonNullable<Parameters<typeof createAgentSession>[0]>;
type ThinkingLevelOption = CreateSessionOptions["thinkingLevel"];

const now = (): string => new Date().toISOString();

export interface PiBackendOptions {
  /** Job checkout. The runner image mounts it read-only at /src. */
  cwd?: string;
  /** Writable output directory. The runner image mounts it at /out. */
  outDir?: string;
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

class PiJob implements JobHandle {
  readonly events = new EventStream<JobEvent>();
  readonly done: Promise<Extract<JobEvent, { type: "job.completed" }>>;

  #settled = false;
  #resolveDone!: (event: Extract<JobEvent, { type: "job.completed" }>) => void;
  #rejectDone!: (error: unknown) => void;
  #inputTokens = 0;
  #outputTokens = 0;
  #costUsd = 0;
  #blockedCalls = 0;
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

  /** Called by the policy extension when a tool call is blocked before execution. */
  pushBlocked(tool: string, reason: string, input: unknown): void {
    if (this.#settled) return;
    this.#blockedCalls += 1;
    this.events.push({
      type: "tool.call",
      jobId: this.jobId,
      callId: `${this.jobId}-blocked-${this.#blockedCalls}`,
      tool,
      input,
      decision: "blocked",
      reason,
    });
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
      // Only allowlisted tools reach execution; blocked calls come from pushBlocked().
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
      summary: `${this.spec.agent.id} run complete: ${this.#inputTokens} input / ${this.#outputTokens} output tokens${
        this.#blockedCalls === 0 ? "" : `, ${this.#blockedCalls} blocked call(s)`
      }`,
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
  const outDir = options.outDir ?? process.env["KINTSUGI_JOB_OUT"] ?? resolve(cwd, "..", "out");
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

      // Agent resolution (ADR-0022): JobSpec.definition (from the installation DB) wins;
      // the code catalog is the fallback for builtins (dev without DB, seeds, validation).
      const resolved = spec.definition;
      const fallback = agentDefinition(spec.agent.id);
      if (resolved === undefined && fallback === undefined) {
        throw new Error(`unknown agent "${spec.agent.id}" and no definition in the JobSpec (ADR-0022)`);
      }
      const rolePrompt = resolved?.systemPrompt ?? fallback!.systemPrompt;
      const skillTexts = resolved !== undefined ? resolveSkillTexts(resolved.skills) : (fallback!.skills ?? []).map((path) => resolveSkillTexts([{ path }])[0] ?? "");
      const systemPrompt = buildJobSystemPrompt(spec, rolePrompt, skillTexts.filter((text) => text !== ""));
      const allowTools = spec.policy.allowTools.length > 0 ? spec.policy.allowTools : (resolved?.allowTools ?? fallback!.allowTools);
      const denyBashPatterns = spec.policy.denyBashPatterns ?? resolved?.denyBashPatterns;
      const thinkingLevel = spec.model.thinking ?? resolved?.thinking ?? fallback!.thinking;

      let job: PiJob | undefined;
      const sink: PolicySink = {
        blocked: (tool, reason, input) => job?.pushBlocked(tool, reason, input),
      };

      const agentDir = mkdtempSync(join(tmpdir(), `kintsugi-agent-${jobId.slice(0, 8)}-`));
      const resourceLoader = new DefaultResourceLoader({
        cwd,
        agentDir,
        extensionFactories: [
          createSystemPromptExtension(systemPrompt),
          createPolicyExtension({ allowTools, denyBashPatterns }, sink),
          createCodemodeExtension(),
          createToolSearchExtension(),
          createMcpExtension(),
        ],
      });
      await resourceLoader.reload();

      const { session } = await createAgentSession({
        cwd,
        agentDir,
        modelRuntime,
        model,
        thinkingLevel: thinkingLevel as ThinkingLevelOption,
        tools: allowTools,
        customTools: [kbSearchTool, kbAskTool, createGitReadTool(cwd), webFetchTool, createOutputsWriteTool(outDir)],
        sessionManager: SessionManager.inMemory(),
        resourceLoader,
      });

      job = new PiJob(jobId, spec, session);
      job.attach(session.subscribe((event) => job!.onSessionEvent(event)));

      job.events.push({ type: "job.started", jobId, at: now(), runtimeVersion: RUNTIME_VERSION });

      const timeoutMs = spec.budget.timeoutSec * 1000;
      const timer = setTimeout(() => {
        void job!.abort(`timeout after ${spec.budget.timeoutSec}s`);
      }, timeoutMs);

      const promptText = spec.instruction ?? "Perform the task described in your system prompt for this job.";
      void session
        .prompt(promptText)
        .then(() => {
          clearTimeout(timer);
          job!.onComplete();
        })
        .catch((error: unknown) => {
          clearTimeout(timer);
          job!.failBeforeStart(error instanceof Error ? error.message : String(error));
        });

      return job;
    },
  };
}
