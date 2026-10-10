// Smoke runner: executes one Kintsugi runtime job through the pi backend against the
// LLM provider registry in Postgres (ADR-0004, ADR-0009). JobEvents stream to stdout
// as NDJSON. The container launcher lands with the worker (ADR-0004); this exercises
// the same job contract in-process.
//
//   node dist/bin/run-job.js --provider <id> --model <id> [--instruction "..."]

import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobSpec } from "@kintsugi/runtime-sdk";
import { loadAgent } from "../launcher/agent-registry.js";
import { buildModelRuntime, piProviderId } from "../launcher/model-runtime.js";
import { loadProvider } from "../launcher/provider-registry.js";
import { createPiJobBackend } from "../pi-runtime.js";

if (existsSync(".env")) process.loadEnvFile(".env");

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const providerArg = arg("provider");
const modelArg = arg("model");
if (providerArg === undefined || modelArg === undefined) {
  console.error("usage: run-job --provider <id> --model <id> [--instruction <text>]");
  process.exit(1);
}

const instruction = arg("instruction") ?? "Reply with one short sentence confirming you are running.";
const denyPattern = arg("deny-bash");
const outDir = arg("out") ?? process.env["KINTSUGI_JOB_OUT"] ?? join(tmpdir(), "kintsugi-out");
const agentId = arg("agent") ?? "assessment";
const definition = await loadAgent(agentId);
const { config, credentials } = await loadProvider(providerArg);
const modelRuntime = await buildModelRuntime(config, credentials);

const spec: JobSpec = {
  agent: { id: agentId, version: definition?.version ?? "0.0.0" },
  ...(definition === undefined ? {} : { definition }),
  context: { projectId: "smoke", trigger: "user:dev" },
  rulebook: { version: "smoke" },
  packs: [],
  requires: [],
  inputs: [],
  instruction,
  // Empty allowlist / no thinking = use the agent catalog defaults (ADR-0014).
  model: { provider: piProviderId(config), id: modelArg },
  policy: { allowTools: [], ...(denyPattern === undefined ? {} : { denyBashPatterns: [denyPattern] }) },
  outputs: [],
  budget: { maxTurns: 2, timeoutSec: 180 },
};

const backend = await createPiJobBackend({ modelRuntime, cwd: process.cwd(), outDir });
const job = await backend.startJob(spec);
for await (const event of job.events) {
  console.log(JSON.stringify(event));
}
const done = await job.done;
console.error(`\n${done.summary}`);
