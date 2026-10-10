// Kintsugi Runtime entry point: the `AgentRuntime` contract from packages/runtime-sdk.
// The runtime is a generic agent kernel (ADR-0023): every job carries its whole agent
// definition, and no agent is defined here. Two backends share one job loop shape
// (JobSpec → JobHandle → JobEvent):
//   - "pi"   — the real engine (ADR-0001), run inside the job sandbox (ADR-0004);
//   - "mock" — a deterministic simulation so the orchestrator and telemetry can be
//              built against the contract without LLM calls.

import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AgentRuntime, JobHandle, JobSpec } from "@kintsugi/runtime-sdk";
import { startMockJob } from "./mock-agent.js";
import { PI_ENGINE_ID, RUNTIME_VERSION } from "./version.js";

export type CreateAgentRuntimeOptions =
  | { mode?: "mock" }
  | {
      mode: "pi";
      /** Provides the job's models and credentials (launcher/model-runtime.ts). */
      resolveModelRuntime(spec: JobSpec): Promise<ModelRuntime>;
    };

export type RuntimeMode = NonNullable<CreateAgentRuntimeOptions["mode"]>;

/** The pi job backend (services/runtime/src/pi-runtime.ts), loaded lazily. */
export interface PiJobBackend {
  startJob(spec: JobSpec): Promise<JobHandle>;
}

class MockAgentRuntime implements AgentRuntime {
  readonly engine = `mock@${RUNTIME_VERSION}`;

  async startJob(spec: JobSpec): Promise<JobHandle> {
    return startMockJob(spec, RUNTIME_VERSION);
  }
}

class PiAgentRuntime implements AgentRuntime {
  readonly engine = PI_ENGINE_ID;
  readonly #backend: Promise<PiJobBackend>;

  constructor(resolveModelRuntime: (spec: JobSpec) => Promise<ModelRuntime>) {
    // Mock-only consumers never load the pi SDK.
    this.#backend = import("./pi-runtime.js").then((m) => m.createPiJobBackend({ resolveModelRuntime }));
  }

  async startJob(spec: JobSpec): Promise<JobHandle> {
    return (await this.#backend).startJob(spec);
  }
}

export function createAgentRuntime(options: CreateAgentRuntimeOptions = {}): AgentRuntime {
  return options.mode === "pi" ? new PiAgentRuntime(options.resolveModelRuntime) : new MockAgentRuntime();
}

export { EventStream } from "./event-stream.js";
export { startMockJob } from "./mock-agent.js";
export { PI_ENGINE_ID, PI_VERSION, RUNTIME_VERSION } from "./version.js";
