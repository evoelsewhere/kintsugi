// The sandbox settings the worker runs with (ADR-0055): stored in admin.installation_setting under `sandbox`, set in the
// portal (Settings → Sandbox & Agent), read when a job starts and in each sweep, so a change applies to the next job without
// a restart. A value that is missing, unreadable or out of range is the default, field by field.

import { DEFAULT_SANDBOX, SANDBOX_SETTING, type SandboxSettings, resolveSandbox } from "@kintsugi/domain";
import type { Pool } from "pg";
import type { JobDefaults } from "./jobs/runner.js";

export type SandboxProvider = () => Promise<SandboxSettings>;

/** The defaults, for a worker without a database of settings (tests). */
export const defaultSandbox: SandboxProvider = async () => DEFAULT_SANDBOX;

/** The settings in the database, read at most once per `ttlMs` (jobs start in bursts). */
export function pgSandbox(pool: Pick<Pool, "query">, ttlMs = 5000): SandboxProvider {
  let cached: { at: number; settings: SandboxSettings } | undefined;
  return async () => {
    if (cached !== undefined && Date.now() - cached.at < ttlMs) return cached.settings;
    const result = await pool.query<{ value: unknown }>("select value from admin.installation_setting where key = $1", [SANDBOX_SETTING]).catch(() => undefined);
    // A database that cannot be read right now does not change what a job runs with: the last settings stand.
    const settings = result === undefined ? (cached?.settings ?? DEFAULT_SANDBOX) : resolveSandbox(result.rows[0]?.value);
    cached = { at: Date.now(), settings };
    return settings;
  };
}

/** The limits of a job: the worker's defaults with the script and agent limits of the sandbox settings (0 = no limit). */
export function limitsWith(base: JobDefaults, settings: SandboxSettings): JobDefaults {
  return {
    ...base,
    script: { timeoutSec: settings.scriptTimeoutSec, maxOutputBytes: settings.maxOutputBytes },
    agent: {
      timeoutSec: settings.agentTimeoutSec,
      maxOutputBytes: settings.maxOutputBytes,
      ...(settings.maxTurns > 0 ? { maxTurns: settings.maxTurns } : {}),
      ...(settings.maxCostUsd > 0 ? { maxCostUsd: settings.maxCostUsd } : {}),
    },
  };
}
