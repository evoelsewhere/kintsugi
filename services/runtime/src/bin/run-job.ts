// Dev runner: executes one job through the agent kernel and streams JobEvents to stdout
// as NDJSON. The agent definition comes from a JSON file you supply (ADR-0023: no agent
// ships with Kintsugi). With --mock no LLM is called; otherwise the provider is loaded
// from the registry in Postgres (ADR-0009). This runs in-process, without the job
// sandbox: point --read only at directories you trust (ADR-0004).
//
//   node dist/bin/run-job.js --agent-file <agent.json> --read <dir> --out <dir> --task "..."
//     (--mock | --provider <id> --model <id>) [--max-turns <n>] [--timeout <sec>] [--max-cost <usd>]

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentDefinition, JobSpec } from "@kintsugi/runtime-sdk";
import { createAgentRuntime } from "../agent-runtime.js";
import { buildModelRuntime, piProviderId } from "../launcher/model-runtime.js";
import { loadProvider } from "../launcher/provider-registry.js";

if (existsSync(".env")) process.loadEnvFile(".env");

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}
const numberArg = (name: string): number | undefined => (arg(name) === undefined ? undefined : Number(arg(name)));

const USAGE =
  "usage: run-job --agent-file <agent.json> --read <dir> --out <dir> --task <text> (--mock | --provider <id> --model <id>) " +
  "[--max-turns <n>] [--timeout <sec>] [--max-cost <usd>]";

const agentFile = arg("agent-file");
const readDir = arg("read");
const outDir = arg("out");
const task = arg("task");
const mock = process.argv.includes("--mock");
const providerId = arg("provider");
const modelId = arg("model");
if (agentFile === undefined || readDir === undefined || outDir === undefined || task === undefined || (!mock && (providerId === undefined || modelId === undefined))) {
  console.error(USAGE);
  process.exit(1);
}

const agent = JSON.parse(readFileSync(agentFile, "utf8")) as AgentDefinition;
const maxTurns = numberArg("max-turns");
const maxCostUsd = numberArg("max-cost");

let resolveModelRuntime: Parameters<typeof createAgentRuntime>[0] = { mode: "mock" };
let provider = "mock";
if (!mock) {
  const { config, credentials } = await loadProvider(providerId!);
  // Single-process dev run: provider environment goes into this process (the launcher
  // sets it on the sandboxed runner instead).
  Object.assign(process.env, credentials.env);
  const modelRuntime = await buildModelRuntime(config, credentials);
  provider = piProviderId(config);
  resolveModelRuntime = { mode: "pi", resolveModelRuntime: async () => modelRuntime };
}

const spec: JobSpec = {
  agent,
  task,
  model: { provider, id: modelId ?? "mock" },
  workspace: { readOnly: [resolve(readDir)], outDir: resolve(outDir) },
  limits: {
    timeoutSec: numberArg("timeout") ?? 300,
    ...(maxTurns === undefined ? {} : { maxTurns }),
    ...(maxCostUsd === undefined ? {} : { maxCostUsd }),
  },
  metadata: { trigger: "user:dev" },
};

const job = await createAgentRuntime(resolveModelRuntime).startJob(spec);
for await (const event of job.events) {
  console.log(JSON.stringify(event));
}
const done = await job.done;
console.error(`\n${done.type === "job.completed" ? done.summary : `failed (${done.reason}): ${done.error}`}`);
process.exitCode = done.type === "job.completed" ? 0 : 1;
