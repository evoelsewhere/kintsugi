// The form of Settings → Telemetry export (ADR-0074). Pure, so the parsing and the checks are tested without a browser;
// the checks are the ones the API applies (@kintsugi/domain). Header values are write-only: the form never holds the
// stored ones, only what the administrator types to replace them.

import { telemetryExportProblems, telemetryHeaderProblems } from "@kintsugi/domain";
import type { TelemetryExportInput, TelemetryExportView } from "./api/telemetry-export";

export interface TelemetryExportForm {
  enabled: boolean;
  endpoint: string;
  serviceName: string;
  /** One `Name: value` per line; empty keeps the stored headers. */
  headers: string;
  /** Remove the stored headers (ignored while new ones are typed). */
  clearHeaders: boolean;
}

export function toForm(view: TelemetryExportView): TelemetryExportForm {
  return { enabled: view.enabled, endpoint: view.endpoint, serviceName: view.serviceName, headers: "", clearHeaders: false };
}

/** The headers typed in the form, or what is wrong with the lines. */
export function parseHeaders(text: string): { headers: Record<string, string>; problems: string[] } {
  const headers: Record<string, string> = {};
  const problems: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const colon = line.indexOf(":");
    if (colon <= 0) {
      problems.push(`"${line.trim().slice(0, 40)}" is not Name: value`);
      continue;
    }
    headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  if (problems.length === 0) problems.push(...telemetryHeaderProblems(headers));
  return { headers, problems };
}

export function formProblems(form: TelemetryExportForm): string[] {
  return [...telemetryExportProblems(form), ...parseHeaders(form.headers).problems];
}

/** The body to send, or undefined while the form has problems. */
export function toInput(form: TelemetryExportForm): TelemetryExportInput | undefined {
  if (formProblems(form).length > 0) return undefined;
  const typed = parseHeaders(form.headers).headers;
  const replace = Object.keys(typed).length > 0;
  return {
    enabled: form.enabled,
    endpoint: form.endpoint.trim(),
    serviceName: form.serviceName.trim(),
    ...(replace ? { headers: typed } : form.clearHeaders ? { headers: {} } : {}),
  };
}

export function isUnchanged(form: TelemetryExportForm, stored: TelemetryExportView): boolean {
  return JSON.stringify(form) === JSON.stringify(toForm(stored));
}
