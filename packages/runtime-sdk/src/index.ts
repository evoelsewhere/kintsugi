// Contract for the Kintsugi Runtime: Kintsugi's own agents (knowledge, assessment,
// planning, gate review, …) executed on pi, one Docker container per job (ADR-0004).
// The runner reads a read-only git checkout and writes only to /out; the worker
// commits /out to the workspace repo (ADR-0007). See docs/reference/runtime-agents.md.

import type { CapabilityName, Phase, RulebookRef, RunnerSpec, RuntimeAgentId, ThinkingLevel } from "@kintsugi/domain";

export interface JobContext {
  projectId: string;
  applicationId?: string;
  workItemId?: string;
  phase?: Phase;
  /** User or event that triggered the job (e.g. "user:alice", "event:pr.opened"). */
  trigger: string;
}

/** Read-only inputs mounted into the job container. Repos are pinned to a commit. */
export type JobInput =
  | { kind: "repo"; url: string; commit: string; paths?: string[] }
  | { kind: "pull-request"; url: string }
  | { kind: "document"; repoUrl: string; commit: string; path: string }
  | { kind: "kb-query"; kb: "as-is" | "to-be"; query: string };

export interface ToolPolicy {
  /** Derived from the built-in agent definition in code; not configurable per project. */
  allowTools: string[];
  denyBashPatterns?: string[];
}

/** A file the job wants persisted; the worker validates it and commits it to the workspace repo. */
export interface JobOutputRule {
  /** Path pattern in the workspace repo, e.g. "assessment/{app}/scorecard.md". */
  path: string;
  commit: "pull-request" | "auto";
}

export interface JobSpec {
  /** Built-in agent; its prompt, skills, tools and policy are fixed in code (ADR-0014). */
  agent: { id: RuntimeAgentId; version: string };
  context: JobContext;
  /** Project rulebook the job runs against (ADR-0011); readiness of `requires` is checked before launch. */
  rulebook: RulebookRef;
  /** Packs resolved for the job's units; rules and skills come from these layers. */
  packs: string[];
  /** From the pipeline stage definition (rulebook pipelines/*.yaml), not hard-coded per agent. */
  requires: CapabilityName[];
  /** Waivers the readiness check relied on, recorded for audit. */
  waivers?: string[];
  /** True when every unit in the job is a pilot unit (allows `draft` capabilities). */
  pilot?: boolean;
  inputs: JobInput[];
  /** Task-specific instruction appended to the agent's own prompt and skills. */
  instruction?: string;
  /** Resolved from AgentModelBinding; provider refers to an LlmProviderConfig id. */
  model: { provider: string; id: string; thinking?: ThinkingLevel };
  policy: ToolPolicy;
  outputs: JobOutputRule[];
  budget: { maxCostUsd?: number; maxTurns?: number; timeoutSec: number };
}

export type JobEvent =
  | { type: "job.started"; jobId: string; at: string; runtimeVersion: string }
  | { type: "message.delta"; jobId: string; text: string }
  | { type: "tool.call"; jobId: string; callId: string; tool: string; input: unknown; decision: "allowed" | "blocked"; reason?: string }
  | { type: "tool.result"; jobId: string; callId: string; ok: boolean; summary?: string }
  | { type: "output"; jobId: string; target: "file" | "pr-comment"; ref: string }
  | { type: "usage"; jobId: string; model: string; inputTokens: number; outputTokens: number; costUsd?: number }
  | { type: "job.completed"; jobId: string; at: string; summary: string }
  | { type: "job.failed"; jobId: string; at: string; error: string };

export interface JobHandle {
  jobId: string;
  events: AsyncIterable<JobEvent>;
  /** Interactive agents (e.g. kb-assistant) accept follow-up messages. */
  followUp?(message: string): Promise<void>;
  abort(reason: string): Promise<void>;
  done: Promise<Extract<JobEvent, { type: "job.completed" }>>;
}

/** A rulebook runner executed in its own isolated container (no LLM credentials). */
export interface RunnerJobSpec {
  runner: { id: string; pack: string; spec: RunnerSpec };
  context: JobContext;
  rulebook: RulebookRef;
  inputs: JobInput[];
  /** Optional comparator run after the runner, producing the standard compare report. */
  thenCompare?: { profile?: string; comparator?: string };
}

/** Standard compare report contract, produced by the built-in compare engine or a custom comparator. */
export interface CompareReport {
  verdict: "pass" | "fail";
  diffCount: number;
  clusters: { id: string; files: string[]; summary: string }[];
  reportPath: string;
}

export interface AgentRuntime {
  /** Identifies the underlying engine, e.g. "pi@1.1.0". */
  readonly engine: string;
  startJob(spec: JobSpec): Promise<JobHandle>;
}

// ---------------------------------------------------------------------------
// LLM provider registry for the runtime (ADR-0009). Mirrors what pi supports;
// the worker translates it into a job-scoped pi models.json + environment.
// ---------------------------------------------------------------------------

/** Credentials are stored encrypted in Postgres; only references travel in configs. */
export type SecretRef = { secretId: string };

export type ProviderAuth =
  | { type: "api-key"; key: SecretRef }
  /** Provider-specific environment, e.g. Azure base URL / API version / deployment map,
   *  Vertex project + location, Bedrock region + keys. Secret values use SecretRef. */
  | { type: "env"; vars: Record<string, string | SecretRef> }
  | { type: "service-account-json"; file: SecretRef; envVar: string }
  | { type: "none" };

/** A provider from pi-ai's built-in catalog (list is read from the pinned pi version). */
export interface BuiltinProviderConfig {
  kind: "builtin";
  id: string; // Kintsugi id, unique per installation
  piProvider: string; // pi provider id, e.g. "anthropic", "openai", "amazon-bedrock"
  auth: ProviderAuth;
  /** pi `modelOverrides` for built-in models (sampling, prompt cache, input limits…). */
  modelOverrides?: Record<string, Record<string, unknown>>;
  enabledModels?: string[]; // allowlist; empty = all catalog models
}

/** A custom provider expressed in pi's models.json shape (vLLM, Ollama, LiteLLM, internal gateway…). */
export interface CustomProviderConfig {
  kind: "custom";
  id: string;
  /** pi wire protocol, e.g. "openai-completions", "openai-responses", "anthropic-messages",
   *  "google-generative-ai", "bedrock-converse-stream", "mistral-conversations". */
  api: string;
  baseUrl: string;
  auth: ProviderAuth;
  headers?: Record<string, string | SecretRef>;
  models: CustomModelConfig[];
}

export interface CustomModelConfig {
  id: string;
  name?: string;
  input?: ("text" | "image")[];
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  /** USD per million tokens; used for budgets and cost reporting. */
  cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  /** pi compat flags, e.g. { supportsDeveloperRole: false, supportsReasoningEffort: false }. */
  compat?: Record<string, boolean>;
}

export type LlmProviderConfig = BuiltinProviderConfig | CustomProviderConfig;

/** Which provider/model a runtime agent uses, optionally per project. */
export interface AgentModelBinding {
  agent: RuntimeAgentId;
  projectId?: string; // undefined = installation default
  provider: string; // LlmProviderConfig.id
  model: string;
  thinking?: ThinkingLevel;
}
