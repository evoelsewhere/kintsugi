// kintsugi-worker entry point (ADR-0003, ADR-0025, ADR-0029). Configuration is deployment
// environment only: DATABASE_URL, KINTSUGI_SECRET_KEY (decrypts Git and LLM credentials),
// KINTSUGI_DATA_DIR, KINTSUGI_GIT_POLL_INTERVAL and the job settings
// (KINTSUGI_RUNTIME_MODE, KINTSUGI_JOB_* including KINTSUGI_JOB_RETENTION_DAYS, KINTSUGI_SCRIPT_TIMEOUT, KINTSUGI_AGENT_IDLE_TIMEOUT, KINTSUGI_WORKFLOW_*, KINTSUGI_STAGE_*,
// KINTSUGI_PYTHON, KINTSUGI_NODE). Git servers, repositories, LLM providers and the commit identity are
// configured in the portal.

import { existsSync } from "node:fs";
import { CheckoutStorage, checkGitVersion, dataDirFromEnv } from "@kintsugi/git";
import { createChildAgentRuntime, interpretersFromEnv, loadProvider } from "@kintsugi/runtime/launcher";
import type { AgentRuntime } from "@kintsugi/runtime-sdk";
import { Pool } from "pg";
import { DEFAULT_JOB_RETENTION_DAYS } from "./jobs/cleanup.js";
import { DEFAULT_JOB_LIMITS, type JobDefaults } from "./jobs/runner.js";
import { startWorker } from "./worker.js";

/** Local development configuration lives in .env (gitignored); the compose package passes env directly. */
if (existsSync(".env")) process.loadEnvFile(".env");

function positive(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

function nonNegative(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be zero (no limit) or a positive number`);
  return value;
}

/** Job limits from the environment, with the defaults of DEFAULT_JOB_LIMITS. */
function jobDefaults(): JobDefaults {
  const maxOutputBytes = positive("KINTSUGI_JOB_MAX_OUTPUT_BYTES", DEFAULT_JOB_LIMITS.agent.maxOutputBytes);
  const maxCostUsd = process.env["KINTSUGI_JOB_MAX_COST_USD"] === undefined ? undefined : positive("KINTSUGI_JOB_MAX_COST_USD", 1);
  return {
    script: { timeoutSec: positive("KINTSUGI_SCRIPT_TIMEOUT", DEFAULT_JOB_LIMITS.script.timeoutSec), maxOutputBytes },
    agent: {
      // 0 = no wall-clock limit (a stalled provider is still caught by the idle watchdog).
      timeoutSec: nonNegative("KINTSUGI_JOB_DEFAULT_TIMEOUT", DEFAULT_JOB_LIMITS.agent.timeoutSec),
      maxOutputBytes,
      maxTurns: positive("KINTSUGI_JOB_MAX_TURNS", DEFAULT_JOB_LIMITS.agent.maxTurns ?? 80),
      ...(maxCostUsd === undefined ? {} : { maxCostUsd }),
    },
    workflow: {
      maxAgents: positive("KINTSUGI_WORKFLOW_MAX_AGENTS", DEFAULT_JOB_LIMITS.workflow.maxAgents),
      concurrency: positive("KINTSUGI_WORKFLOW_CONCURRENCY", DEFAULT_JOB_LIMITS.workflow.concurrency),
    },
    stage: {
      maxAgents: positive("KINTSUGI_STAGE_MAX_AGENTS", DEFAULT_JOB_LIMITS.stage.maxAgents),
      concurrency: positive("KINTSUGI_STAGE_CONCURRENCY", DEFAULT_JOB_LIMITS.stage.concurrency),
    },
  };
}

/**
 * The agent runtime: pi (default) or the mock backend (KINTSUGI_RUNTIME_MODE=mock, no LLM).
 * Every agent job runs in its own child process in its job workspace; the provider's
 * credentials are decrypted per job and handed to that child only (stdin and its environment).
 */
function agentRuntime(databaseUrl: string, node: string): AgentRuntime {
  const mode = (process.env["KINTSUGI_RUNTIME_MODE"] ?? "pi").trim();
  if (mode !== "pi" && mode !== "mock") throw new Error('KINTSUGI_RUNTIME_MODE must be "pi" or "mock"');
  const idle = process.env["KINTSUGI_AGENT_IDLE_TIMEOUT"];
  const idleTimeoutSec = idle === undefined ? undefined : Number(idle);
  if (idleTimeoutSec !== undefined && !(Number.isInteger(idleTimeoutSec) && idleTimeoutSec >= 0)) throw new Error("KINTSUGI_AGENT_IDLE_TIMEOUT must be a whole number of seconds (0 turns it off)");
  return createChildAgentRuntime({ mode, node, loadProvider: (providerId) => loadProvider(providerId, databaseUrl), ...(idleTimeoutSec === undefined ? {} : { idleTimeoutSec }) });
}

async function main(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl === "") throw new Error("DATABASE_URL is not set");
  if ((process.env["KINTSUGI_SECRET_KEY"] ?? "") === "") throw new Error("KINTSUGI_SECRET_KEY is not set; it decrypts Git credentials");
  const pollIntervalSeconds = Number(process.env["KINTSUGI_GIT_POLL_INTERVAL"] ?? 180);
  if (!Number.isFinite(pollIntervalSeconds) || pollIntervalSeconds < 30) throw new Error("KINTSUGI_GIT_POLL_INTERVAL must be at least 30 seconds");

  const gitVersion = await checkGitVersion();
  const storage = new CheckoutStorage(dataDirFromEnv());
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  const interpreters = interpretersFromEnv();
  const agents = agentRuntime(databaseUrl, interpreters.node);
  const worker = await startWorker({
    databaseUrl,
    pool,
    storage,
    pollIntervalSeconds,
    jobRetentionDays: positive("KINTSUGI_JOB_RETENTION_DAYS", DEFAULT_JOB_RETENTION_DAYS),
    jobs: { agents, interpreters, defaults: jobDefaults(), concurrency: positive("KINTSUGI_JOB_MAX_CONCURRENCY", 2) },
  });
  console.log(`[worker] git ${gitVersion}, data ${storage.root}, polling every ${pollIntervalSeconds}s; commit identity from the portal (Settings → Git)`);
  console.log(`[worker] runtime ${agents.engine}, python ${interpreters.python}, node ${interpreters.node}; jobs run in job workspaces without an OS sandbox, agent jobs as child processes (ADR-0029)`);

  const shutdown = async (): Promise<void> => {
    await worker.stop();
    await pool.end();
    process.exit(0);
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void shutdown());
}

main().catch((error: unknown) => {
  console.error(`[worker] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
