// Domain of installation settings managed in the portal (admin.installation_setting). Pure types and the port.

import type { SandboxSettings, TelemetryExportSettings } from "@kintsugi/domain";

export interface CommitIdentity {
  name: string;
  email: string;
}

export interface CommitIdentityView extends CommitIdentity {
  /** True while no admin has set one: the built-in defaults apply. */
  isDefault: boolean;
  updatedBy?: string;
  updatedAt?: string;
}

export type CodingAgentConnectionLifetime = 15 | 30;

export interface CodingAgentConnectionLifetimeView {
  maxAgeDays: CodingAgentConnectionLifetime;
  isDefault: boolean;
  updatedBy?: string;
  updatedAt?: string;
}

/** The sandbox settings as the portal shows them (ADR-0055). */
export interface SandboxSettingsView extends SandboxSettings {
  /** True while no administrator has stored any: the defaults apply. */
  isDefault: boolean;
  updatedBy?: string;
  updatedAt?: string;
}

/** What an administrator sends: `headers` left out keeps the stored ones, `{}` removes them, anything else replaces them. */
export interface TelemetryExportInput extends TelemetryExportSettings {
  headers?: Record<string, string> | undefined;
}

/** The telemetry export as the portal shows it (ADR-0074). The header values are never returned, only their names. */
export interface TelemetryExportView extends TelemetryExportSettings {
  headerNames: string[];
  /** True while no administrator has stored any: export is off. */
  isDefault: boolean;
  updatedBy?: string;
  updatedAt?: string;
}

export const CODING_AGENT_CONNECTION_LIFETIME_SETTING = "coding-agent-connection-lifetime";
export const DEFAULT_CODING_AGENT_CONNECTION_LIFETIME: CodingAgentConnectionLifetime = 15;

export interface StoredSetting<T> {
  value: T;
  updatedBy?: string;
  updatedAt: string;
}

/** Port: where installation settings are kept. */
export abstract class InstallationSettings {
  abstract get<T>(key: string): Promise<StoredSetting<T> | undefined>;
  abstract put<T>(key: string, value: T, updatedBy: string): Promise<StoredSetting<T>>;
}
