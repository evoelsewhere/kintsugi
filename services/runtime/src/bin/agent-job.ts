// Agent job child process (ADR-0029): the worker starts one per agent job, in the job's
// workspace, through the launcher (launcher/agent-process.ts). It reads one AgentChildInput
// as JSON from stdin — the JobSpec and, for pi, the provider record with its API key and
// inline secrets — and writes the job's JobEvents to stdout as JSON lines. Provider
// environment credentials arrive in this process's environment only. Nothing is read from
// or written to disk except through the kernel's confined tools.
//
// Not a command for people: use run-job.ts for development runs.

import type { JobEvent } from "@kintsugi/runtime-sdk";
import { createAgentRuntime } from "../agent-runtime.js";
import type { AgentChildInput } from "../launcher/agent-process.js";
import { buildModelRuntime } from "../launcher/model-runtime.js";

const write = (event: JobEvent): void => {
  process.stdout.write(`${JSON.stringify(event)}\n`);
};

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const input = JSON.parse(await readStdin()) as AgentChildInput;
  const { provider } = input;
  if (input.mode === "pi" && provider === undefined) throw new Error("no provider was passed to the agent job");
  const runtime =
    input.mode === "mock"
      ? createAgentRuntime({ mode: "mock" })
      : createAgentRuntime({
          mode: "pi",
          resolveModelRuntime: () =>
            buildModelRuntime(provider!.config, {
              ...(provider!.apiKey === undefined ? {} : { apiKey: provider!.apiKey }),
              ...(provider!.secrets === undefined ? {} : { secrets: provider!.secrets }),
            }),
        });
  const job = await runtime.startJob(input.spec);
  // Thinking and long tool-call arguments stream without JobEvents: report liveness so the
  // launcher's idle watchdog only stops a job whose provider really went silent.
  let reported = 0;
  const alive = setInterval(() => {
    const at = (job as { lastActivityAt?: number }).lastActivityAt;
    if (at === undefined || at <= reported) return;
    reported = at;
    process.stdout.write(`${JSON.stringify({ type: "activity", at: new Date(at).toISOString() })}\n`);
  }, 10_000);
  alive.unref();
  let ended = false;
  for await (const event of job.events) {
    if (event.type === "job.completed" || event.type === "job.failed") ended = true;
    write(event);
  }
  const done = await job.done;
  clearInterval(alive);
  if (!ended) write(done);
  process.exitCode = done.type === "job.completed" ? 0 : 1;
}

main().catch((error: unknown) => {
  write({ type: "job.failed", jobId: "unstarted", at: new Date().toISOString(), reason: "error", error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
