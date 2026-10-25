// The settings of the sandbox environment a job runs in (ADR-0029, ADR-0055): how long a job workspace keeps what it
// can make again and what it cannot, and the limits of the processes in it. An administrator sets them in the portal
// (Settings → Sandbox & Agent); they are stored in admin.installation_setting under `sandbox`, and the worker reads them when
// a job starts and in each sweep, so a change applies to the next job without a restart. Pure: the API validates with
// the same rules the worker applies.

export const SANDBOX_SETTING = "sandbox";

export interface SandboxSettings {
  /** Hours the checkouts of a failed job are kept for a retry before the sweep drops them (a retry makes them again). */
  checkoutHours: number;
  /** Days the results of a failed or cancelled job (and of a failed write) are kept for inspection and a retry. */
  retentionDays: number;
  /** Seconds a script step may run before it is killed. */
  scriptTimeoutSec: number;
  /** Seconds an agent job may run; 0 = no limit (a stalled provider is still caught by the idle limit). */
  agentTimeoutSec: number;
  /** Seconds without a sign of life from the model before an agent job is stopped as stalled; 0 turns the watchdog off. */
  agentIdleTimeoutSec: number;
  /** Bytes a step may write to its output folder; a script that exceeds it is killed. */
  maxOutputBytes: number;
  /** Assistant turns per agent job; 0 = no limit. */
  maxTurns: number;
  /** Cost limit per agent job in USD; 0 = no limit. */
  maxCostUsd: number;
  /** Job runs a worker runs at the same time; the rest wait in the queue. */
  maxJobConcurrency: number;
  /** Mark the checkouts and the inputs of a job read-only on disk. The kernel confines the agents either way. */
  markReadOnly: boolean;
}

export const DEFAULT_SANDBOX: SandboxSettings = {
  checkoutHours: 24,
  retentionDays: 7,
  scriptTimeoutSec: 600,
  agentTimeoutSec: 0,
  agentIdleTimeoutSec: 300,
  maxOutputBytes: 50 * 1024 * 1024,
  maxTurns: 0,
  maxCostUsd: 0,
  maxJobConcurrency: 2,
  markReadOnly: true,
};

interface Rule {
  label: string;
  min: number;
  max: number;
  integer: boolean;
  /** 0 is allowed besides min..max (it means "no limit" or "off"). */
  zero: boolean;
}

const RULES: Record<Exclude<keyof SandboxSettings, "markReadOnly">, Rule> = {
  checkoutHours: { label: "Checkout hours", min: 1, max: 24 * 30, integer: true, zero: false },
  retentionDays: { label: "Retention days", min: 1, max: 90, integer: true, zero: false },
  scriptTimeoutSec: { label: "Script timeout", min: 10, max: 24 * 60 * 60, integer: true, zero: false },
  agentTimeoutSec: { label: "Agent timeout", min: 60, max: 24 * 60 * 60, integer: true, zero: true },
  agentIdleTimeoutSec: { label: "Agent idle timeout", min: 30, max: 60 * 60, integer: true, zero: true },
  maxOutputBytes: { label: "Output limit", min: 1024 * 1024, max: 10 * 1024 * 1024 * 1024, integer: true, zero: false },
  maxTurns: { label: "Turn limit", min: 1, max: 10_000, integer: true, zero: true },
  maxCostUsd: { label: "Cost limit", min: 0.01, max: 10_000, integer: false, zero: true },
  maxJobConcurrency: { label: "Job concurrency", min: 1, max: 32, integer: true, zero: false },
};

export const SANDBOX_FIELDS: readonly (keyof typeof RULES)[] = Object.keys(RULES) as Array<keyof typeof RULES>;

function problemOf(rule: Rule, value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return `${rule.label} must be a number`;
  if (rule.integer && !Number.isInteger(value)) return `${rule.label} must be a whole number`;
  if (rule.zero && value === 0) return undefined;
  if (value < rule.min || value > rule.max) return `${rule.label} must be ${rule.zero ? "0 or " : ""}between ${rule.min} and ${rule.max}`;
  return undefined;
}

/** What is wrong with a settings object, field by field; empty when it can be stored. */
export function sandboxProblems(input: Partial<Record<keyof SandboxSettings, unknown>>): string[] {
  const problems: string[] = [];
  for (const field of SANDBOX_FIELDS) {
    const problem = problemOf(RULES[field], input[field]);
    if (problem !== undefined) problems.push(problem);
  }
  if (typeof input.markReadOnly !== "boolean") problems.push("Read-only marking must be on or off");
  return problems;
}

/**
 * The settings in effect from a stored value: each field that is valid is taken, every other one is the default,
 * so a value stored by an older version, or edited by hand, never stops a job from starting.
 */
export function resolveSandbox(stored: unknown): SandboxSettings {
  const value = typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};
  const result: SandboxSettings = { ...DEFAULT_SANDBOX };
  for (const field of SANDBOX_FIELDS) {
    if (problemOf(RULES[field], value[field]) === undefined) result[field] = value[field] as number;
  }
  if (typeof value["markReadOnly"] === "boolean") result.markReadOnly = value["markReadOnly"];
  return result;
}
