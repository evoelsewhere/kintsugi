// pi backend of the agent kernel (ADR-0001, ADR-0023): validates the JobSpec, builds a
// locked-down pi session for it and runs the task. Isolation is the sandbox's job
// (ADR-0004); this layer makes sure pi only sees what the JobSpec gives it.

import { randomUUID } from "node:crypto";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { JobHandle, JobSpec, JobServices } from "@kintsugi/runtime-sdk";
import type { PiJobBackend } from "./agent-runtime.js";
import { KernelJob } from "./kernel/job.js";
import { createCommandPolicyExtension } from "./kernel/policy.js";
import { createJobSession } from "./kernel/session.js";
import { validateJobSpec } from "./kernel/validate.js";
import { RUNTIME_VERSION } from "./version.js";

export interface PiBackendOptions {
  /** Provides the job's models and credentials (launcher/model-runtime.ts); never read from the host. */
  resolveModelRuntime(spec: JobSpec): Promise<ModelRuntime>;
  services?: JobServices;
}

export function createPiJobBackend(options: PiBackendOptions): PiJobBackend {
  return {
    async startJob(spec: JobSpec, services?: JobServices): Promise<JobHandle> {
      validateJobSpec(spec);
      const job = new KernelJob(randomUUID(), spec, RUNTIME_VERSION);
      void (async () => {
        try {
          const modelRuntime = await options.resolveModelRuntime(spec);
          const { session, dispose } = await createJobSession({
            spec,
            services: services ?? options.services ?? {},
            modelRuntime,
            extensions: [createCommandPolicyExtension(spec.agent.denyCommandPatterns ?? [], (tool, reason, input) => job.blocked(tool, reason, input))],
            onBlocked: (tool, reason, input) => job.blocked(tool, reason, input),
            onOutput: (path) => job.output(path),
          });
          await job.run(session, dispose);
        } catch (error) {
          job.failToStart(error);
        }
      })();
      return job;
    },
  };
}
