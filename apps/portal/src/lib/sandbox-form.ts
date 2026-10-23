// The form of Settings → Sandbox (ADR-0055): the stored numbers are seconds, bytes and hours, the form shows minutes
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

export { DEFAULT_SANDBOX };
