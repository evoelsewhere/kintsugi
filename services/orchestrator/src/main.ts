// kintsugi-worker entry point (ADR-0003, ADR-0025, ADR-0029). Configuration is deployment
// environment only: DATABASE_URL, KINTSUGI_SECRET_KEY (decrypts Git and LLM credentials),
// KINTSUGI_DATA_DIR, KINTSUGI_GIT_POLL_INTERVAL and the job settings
// (KINTSUGI_RUNTIME_MODE, KINTSUGI_JOB_MAX_CONCURRENCY, KINTSUGI_WORKFLOW_*, KINTSUGI_STAGE_*, KINTSUGI_PYTHON,
// KINTSUGI_NODE). Git servers, repositories, LLM providers, the commit identity and the sandbox environment
// (how long a workspace keeps what it holds, the limits of its processes: ADR-0055) are configured in the portal.

import { existsSync } from "node:fs";
import { captureLogs, pgDebugLogSink } from "@kintsugi/domain";
import { CheckoutStorage, checkGitVersion, dataDirFromEnv } from "@kintsugi/git";
import { createChildAgentRuntime, interpretersFromEnv, loadProvider } from "@kintsugi/runtime/launcher";
import type { AgentRuntime } from "@kintsugi/runtime-sdk";
import { Pool } from "pg";
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

/**
 * The budgets of stages and workflows from the environment, with the defaults of DEFAULT_JOB_LIMITS. The limits of the
 * processes of a job (timeouts, output size, turns, cost) are the sandbox settings, read from the database per job.
 */
function jobDefaults(): JobDefaults {
  return {
    script: DEFAULT_JOB_LIMITS.script,
    agent: DEFAULT_JOB_LIMITS.agent,
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
  // The idle limit of a job is a sandbox setting, carried by the job (limits.idleTimeoutSec).
  return createChildAgentRuntime({ mode, node, loadProvider: (providerId) => loadProvider(providerId, databaseUrl) });
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
  // A development installation mirrors what the worker prints to the database for the debug MCP server (ADR-0056).
  const debugging = ["1", "true"].includes((process.env["KINTSUGI_DEBUG_MCP"] ?? "").trim().toLowerCase());
  const capture = debugging ? captureLogs({ service: "worker", sink: pgDebugLogSink(pool), stdout: process.stdout, stderr: process.stderr }) : undefined;
  const interpreters = interpretersFromEnv();
  const agents = agentRuntime(databaseUrl, interpreters.node);
  const worker = await startWorker({
    databaseUrl,
    pool,
    storage,
    pollIntervalSeconds,
    telemetryRetentionDays: positive("KINTSUGI_TELEMETRY_RETENTION_DAYS", 30),
    jobs: { agents, interpreters, defaults: jobDefaults(), concurrency: positive("KINTSUGI_JOB_MAX_CONCURRENCY", 2) },
  });
  console.log(`[worker] git ${gitVersion}, data ${storage.root}, polling every ${pollIntervalSeconds}s; commit identity from the portal (Settings → Git)`);
  console.log(`[worker] runtime ${agents.engine}, python ${interpreters.python}, node ${interpreters.node}; jobs run in job workspaces without an OS sandbox, agent jobs as child processes (ADR-0029)`);

  const shutdown = async (): Promise<void> => {
    await worker.stop();
    await capture?.stop();
    await pool.end();
    process.exit(0);
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void shutdown());
}

main().catch((error: unknown) => {
  console.error(`[worker] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
