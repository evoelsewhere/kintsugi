// Kintsugi Runtime entry point: the `AgentRuntime` contract from packages/runtime-sdk.
// Two backends share one job loop shape (JobSpec → JobHandle → JobEvent):
//   - "pi"   — the real engine (ADR-0001), one container per job (ADR-0004);
//   - "mock" — a deterministic simulation so the orchestrator and telemetry can be
//              built against the contract before real pi jobs run.
// Built-in agent definitions are fixed in code (ADR-0014); nothing here reads agent
// configuration from a repository.

import type { AgentRuntime, JobHandle, JobSpec } from "@kintsugi/runtime-sdk";
import { startMockJob } from "./mock-agent.js";
import { PI_ENGINE_ID, RUNTIME_VERSION } from "./version.js";

export type RuntimeMode = "mock" | "pi";

export interface CreateAgentRuntimeOptions {
  /** Defaults to "mock" until the runner image and launcher wiring land. */
  mode?: RuntimeMode;
}

/** The pi job backend (services/runtime/src/pi-runtime.ts), loaded lazily. */
export interface PiJobBackend {
  startJob(spec: JobSpec): Promise<JobHandle>;
}

let piBackend: Promise<PiJobBackend> | undefined;

/** Mock-only consumers never load the pi SDK. */
function loadPiBackend(): Promise<PiJobBackend> {
  piBackend ??= import("./pi-runtime.js").then((m) => m.createPiJobBackend());
  return piBackend;
}

class MockAgentRuntime implements AgentRuntime {
  readonly engine = `mock@${RUNTIME_VERSION}`;

  async startJob(spec: JobSpec): Promise<JobHandle> {
    return startMockJob(spec, RUNTIME_VERSION);
  }
}

class PiAgentRuntime implements AgentRuntime {
  readonly engine = PI_ENGINE_ID;

  async startJob(spec: JobSpec): Promise<JobHandle> {
    const backend = await loadPiBackend();
    return backend.startJob(spec);
  }
}

export function createAgentRuntime(options: CreateAgentRuntimeOptions = {}): AgentRuntime {
  const mode = options.mode ?? "mock";
  return mode === "pi" ? new PiAgentRuntime() : new MockAgentRuntime();
}

export { EventStream } from "./event-stream.js";
export { startMockJob } from "./mock-agent.js";
export { PI_ENGINE_ID, PI_VERSION, RUNTIME_VERSION } from "./version.js";
