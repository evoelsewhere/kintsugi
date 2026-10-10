// Domain model of the LLM provider registry (ADR-0009). Pure types — no framework,
// no I/O. The configuration shape is the runtime-sdk contract (`LlmProviderConfig`);
// it is not redefined here.

import type { ThinkingLevel } from "@kintsugi/domain";
import type {
  AgentModelBinding,
  BuiltinProviderConfig,
  CustomModelConfig,
  CustomProviderConfig,
  LlmProviderConfig,
  SecretRef,
} from "@kintsugi/runtime-sdk";

export type ProviderKind = "builtin" | "custom";

/** Write-only credentials supplied when a provider is registered; persisted encrypted. */
export interface ProviderCredentials {
  apiKey?: string;
  env?: Record<string, string>;
}

/** Provider configuration without `auth`; the repository attaches the stored { secretId } auth. */
export type ProviderConfigInput =
  | Omit<BuiltinProviderConfig, "auth">
  | (Omit<CustomProviderConfig, "auth" | "headers"> & { headers?: Record<string, string | null> });

/** Application command: register or replace a provider. */
export interface RegisterLlmProvider {
  id: string;
  enabled: boolean;
  config: ProviderConfigInput;
  credentials: ProviderCredentials;
}

/** Persisted provider. `config.auth` references secrets by id — never plaintext. */
export interface LlmProviderRecord {
  id: string;
  kind: ProviderKind;
  enabled: boolean;
  config: LlmProviderConfig;
  /** Credential presence only — values never leave the repository. */
  hasApiKey: boolean;
  envKeys: string[];
  updatedAt: string;
}

export type { AgentModelBinding, CustomModelConfig, LlmProviderConfig, SecretRef, ThinkingLevel };
