// Test helpers: a throwaway workspace and a pi model runtime backed by pi-ai's faux
// provider, so kernel tests run real pi sessions without network or LLM calls.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxProvider, InMemoryCredentialStore, type FauxResponseStep } from "@earendil-works/pi-ai";
import type { AgentDefinition, AgentRuntime, JobEvent, JobLimits, JobSpec } from "@kintsugi/runtime-sdk";
import { createAgentRuntime } from "../src/agent-runtime.js";

export interface Workspace {
  root: string;
  src: string;
  out: string;
  /** A directory next to the workspace that jobs must never reach. */
  outside: string;
  remove(): void;
}

export function createWorkspace(): Workspace {
  const root = mkdtempSync(join(tmpdir(), "kintsugi-runtime-test-"));
  const src = join(root, "src");
  const out = join(root, "out");
  const outside = join(root, "outside");
  for (const dir of [src, out, outside]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(src, "hello.txt"), "hello from the workspace");
  writeFileSync(join(outside, "token.txt"), "TOP_SECRET_VALUE");
  return { root, src, out, outside, remove: () => rmSync(root, { recursive: true, force: true }) };
}

export function agent(tools: string[], extra: Partial<AgentDefinition> = {}): AgentDefinition {
  return { id: "test-agent", version: "1.0.0", instructions: "You are a test agent.", tools, ...extra };
}

/** `root`: the agent's working directory; by default the source folder, so a relative path reads from it. */
export function jobSpec(workspace: Workspace, definition: AgentDefinition, limits: Partial<JobLimits> = {}, root: string = workspace.src): JobSpec {
  return {
    agent: definition,
    task: "do the thing",
    model: { provider: "faux", id: "m1" },
    workspace: { root, readOnly: [workspace.src], outDir: workspace.out },
    limits: { timeoutSec: 30, ...limits },
    metadata: { projectId: "p1" },
  };
}

/** A pi-backed runtime whose model replays `steps` (messages or factories) in order. */
export async function fauxRuntime(steps: FauxResponseStep[]): Promise<AgentRuntime> {
  const faux = fauxProvider({ provider: "faux", models: [{ id: "m1" }] });
  faux.setResponses(steps);
  const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  await modelRuntime.setRuntimeApiKey("faux", "test-key");
  return createAgentRuntime({ mode: "pi", resolveModelRuntime: async () => modelRuntime });
}

export interface JobRun {
  events: JobEvent[];
  done: Extract<JobEvent, { type: "job.completed" | "job.failed" }>;
}

export async function runJob(runtime: AgentRuntime, spec: JobSpec): Promise<JobRun> {
  const job = await runtime.startJob(spec);
  const events: JobEvent[] = [];
  for await (const event of job.events) events.push(event);
  return { events, done: await job.done };
}

/** Resolves after `ms`, or as soon as `signal` aborts (well-behaved providers stop on abort). */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
