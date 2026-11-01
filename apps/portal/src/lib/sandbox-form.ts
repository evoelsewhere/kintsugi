// The form of Settings → Sandbox & Agent (ADR-0055): the stored numbers are seconds, bytes and hours, the form shows minutes
// and megabytes where people think in them. Pure, so the conversions and the checks are tested without a browser; the
// checks are the ones the API and the worker apply (@kintsugi/domain).

import { type SandboxSettings, DEFAULT_SANDBOX, sandboxProblems } from "@kintsugi/domain";

const MIB = 1024 * 1024;

/** What the inputs hold: text, so a half-typed number is not lost. */
export interface SandboxForm {
  checkoutHours: string;
  retentionDays: string;
  scriptTimeoutMin: string;
  agentTimeoutMin: string;
  agentIdleTimeoutMin: string;
  maxOutputMib: string;
  maxTurns: string;
  maxCostUsd: string;
  maxJobConcurrency: string;
  markReadOnly: boolean;
}

/** Minutes with no more digits than needed: 10, 0.5. */
const minutes = (seconds: number): string => String(Math.round((seconds / 60) * 100) / 100);

export function toForm(settings: SandboxSettings): SandboxForm {
  return {
    checkoutHours: String(settings.checkoutHours),
    retentionDays: String(settings.retentionDays),
    scriptTimeoutMin: minutes(settings.scriptTimeoutSec),
    agentTimeoutMin: minutes(settings.agentTimeoutSec),
    agentIdleTimeoutMin: minutes(settings.agentIdleTimeoutSec),
    maxOutputMib: String(Math.round((settings.maxOutputBytes / MIB) * 100) / 100),
    maxTurns: String(settings.maxTurns),
    maxCostUsd: String(settings.maxCostUsd),
    maxJobConcurrency: String(settings.maxJobConcurrency),
    markReadOnly: settings.markReadOnly,
  };
}

/** A number from the text of an input; NaN when it is empty or not one (the checks then name the field). */
const num = (text: string): number => (text.trim() === "" ? Number.NaN : Number(text));

export function fromForm(form: SandboxForm): Record<keyof SandboxSettings, unknown> {
  return {
    checkoutHours: num(form.checkoutHours),
    retentionDays: num(form.retentionDays),
    scriptTimeoutSec: Math.round(num(form.scriptTimeoutMin) * 60),
    agentTimeoutSec: Math.round(num(form.agentTimeoutMin) * 60),
    agentIdleTimeoutSec: Math.round(num(form.agentIdleTimeoutMin) * 60),
    maxOutputBytes: Math.round(num(form.maxOutputMib) * MIB),
    maxTurns: num(form.maxTurns),
    maxCostUsd: num(form.maxCostUsd),
    maxJobConcurrency: num(form.maxJobConcurrency),
    markReadOnly: form.markReadOnly,
  };
}

/** What is wrong with the form, in the words of the API; empty when it can be saved. */
export function formProblems(form: SandboxForm): string[] {
  return sandboxProblems(fromForm(form));
}

/** The settings to send, or undefined while the form has problems. */
export function toSettings(form: SandboxForm): SandboxSettings | undefined {
  return formProblems(form).length === 0 ? (fromForm(form) as unknown as SandboxSettings) : undefined;
}

export const isUnchanged = (form: SandboxForm, stored: SandboxSettings): boolean => JSON.stringify(form) === JSON.stringify(toForm(stored));

export type SandboxNumberField = Exclude<keyof SandboxForm, "markReadOnly">;

/** What a field holds when nothing is saved: the installation's default, in the units of the form. */
export const defaultValue = (field: SandboxNumberField): string => toForm(DEFAULT_SANDBOX)[field];

/** The default of a field in words: "24 hours", or what 0 means (`zero`) for a limit that can be off. */
export function defaultLabel(field: SandboxNumberField, unit: string, zero?: string): string {
  const value = defaultValue(field);
  return Number(value) === 0 && zero !== undefined ? zero : `${value} ${unit}`;
}

/** The agent limits that 0 switches off: with all of them off, nothing stops a model that loops but a person. */
export const AGENT_LIMIT_FIELDS = ["agentTimeoutMin", "maxTurns", "maxCostUsd"] as const satisfies readonly SandboxNumberField[];

/** The agent limits the form switches off (0); a field that is empty or not a number is a problem, not a 0. */
export const agentLimitsOff = (form: SandboxForm): Array<(typeof AGENT_LIMIT_FIELDS)[number]> =>
  AGENT_LIMIT_FIELDS.filter((field) => form[field].trim() !== "" && Number(form[field]) === 0);

/** The form field of each setting, and the factor from the form's unit to the stored one. */
const FIELD_OF: Record<string, { field: SandboxNumberField; factor: number }> = {
  "Checkout hours": { field: "checkoutHours", factor: 1 },
  "Retention days": { field: "retentionDays", factor: 1 },
  "Script timeout": { field: "scriptTimeoutMin", factor: 60 },
  "Agent timeout": { field: "agentTimeoutMin", factor: 60 },
  "Agent idle timeout": { field: "agentIdleTimeoutMin", factor: 60 },
  "Output limit": { field: "maxOutputMib", factor: MIB },
  "Turn limit": { field: "maxTurns", factor: 1 },
  "Cost limit": { field: "maxCostUsd", factor: 1 },
  "Job concurrency": { field: "maxJobConcurrency", factor: 1 },
};

/** How the form names a field: its label and the unit beside its input. */
export type FieldNames = Partial<Record<SandboxNumberField, { label: string; unit: string }>>;

/**
 * The problems of the form by field, worded with the form's own label and unit ("Turns per job must be 0 or between 1
 * and 10000 turns"); `other` keeps any problem that names no field.
 */
export function fieldProblems(form: SandboxForm, names: FieldNames): { fields: Partial<Record<SandboxNumberField, string>>; other: string[] } {
  const fields: Partial<Record<SandboxNumberField, string>> = {};
  const other: string[] = [];
  for (const problem of formProblems(form)) {
    const label = Object.keys(FIELD_OF).find((entry) => problem.startsWith(`${entry} must`));
    const target = label === undefined ? undefined : FIELD_OF[label];
    const name = target === undefined ? undefined : names[target.field];
    if (label === undefined || target === undefined || name === undefined) {
      other.push(problem);
      continue;
    }
    const range = /must be (0 or )?between ([\d.]+) and ([\d.]+)$/.exec(problem);
    const value = (stored: string | undefined): string => String(Math.round((Number(stored) / target.factor) * 100) / 100);
    fields[target.field] =
      range === null ? `${name.label}${problem.slice(label.length)}` : `${name.label} must be ${range[1] ?? ""}between ${value(range[2])} and ${value(range[3])} ${name.unit}`;
  }
  return { fields, other };
}

/** The footer line: unsaved changes first, then where the settings in effect come from. */
export function footerStatus(state: { changed: boolean; loaded: boolean; failed: boolean; isDefault: boolean; updatedBy?: string; updatedAt?: string }): string {
  if (state.changed) return "Unsaved changes: save them to apply them to the next job.";
  if (!state.loaded) return state.failed ? "Not loaded." : "Loading…";
  if (state.isDefault) return "Nothing saved yet: the defaults shown under each field apply.";
  return `Set by ${state.updatedBy ?? "an admin"}${state.updatedAt === undefined ? "" : ` on ${new Date(state.updatedAt).toLocaleString()}`}.`;
}

export { DEFAULT_SANDBOX };
