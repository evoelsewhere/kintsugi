// Typed access to the sandbox environment settings (Settings → Sandbox, ADR-0055).
// Mirrors apps/api → modules/admin/settings (sandbox.manage).

import type { SandboxSettings } from "@kintsugi/domain";
import { apiGet, apiSend } from "../api";

export interface SandboxSettingsView extends SandboxSettings {
  /** True while no administrator has stored any: the defaults apply. */
  isDefault: boolean;
  updatedBy?: string;
  updatedAt?: string;
}

const SANDBOX = "/api/admin/settings/sandbox";

export const sandboxApi = {
  get: () => apiGet<SandboxSettingsView>(SANDBOX),
  save: (settings: SandboxSettings) => apiSend<SandboxSettingsView>(SANDBOX, "PUT", settings),
};
