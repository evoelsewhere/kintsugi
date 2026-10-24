// Typed access to the OpenTelemetry export of job spans (Settings → Telemetry export, ADR-0074).
// Mirrors apps/api → modules/admin/settings (telemetry.manage). The header values are write-only: the API returns names.

import type { TelemetryExportSettings } from "@kintsugi/domain";
import { apiGet, apiSend } from "../api";

export interface TelemetryExportView extends TelemetryExportSettings {
  headerNames: string[];
  /** True while no administrator has stored any: export is off. */
  isDefault: boolean;
  updatedBy?: string;
  updatedAt?: string;
}

/** `headers` left out keeps the stored ones, `{}` removes them, anything else replaces them. */
export interface TelemetryExportInput extends TelemetryExportSettings {
  headers?: Record<string, string>;
}

const TELEMETRY_EXPORT = "/api/admin/settings/telemetry-export";

export const telemetryExportApi = {
  get: () => apiGet<TelemetryExportView>(TELEMETRY_EXPORT),
  save: (input: TelemetryExportInput) => apiSend<TelemetryExportView>(TELEMETRY_EXPORT, "PUT", input),
};
