// Typed access to the LLM provider registry (Settings → Providers).
// Mirrors apps/api → modules/admin/llm-providers (ADR-0009).

import type { ThinkingLevel } from "@kintsugi/domain";
import { apiGet, apiGetAll, apiSend } from "../api";

export interface CustomModelConfig {
  id: string;
  name?: string;
  input?: ("text" | "image")[];
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
}

export interface ProviderView {
  id: string;
  kind: "builtin" | "custom";
  enabled: boolean;
  hasApiKey: boolean;
  envKeys: string[];
  piProvider?: string;
  enabledModels?: string[];
  api?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  models?: CustomModelConfig[];
  updatedAt: string;
}

export interface CreateProviderInput {
  kind: "builtin" | "custom";
  id: string;
  enabled?: boolean;
  apiKey?: string;
  // builtin
  piProvider?: string;
  enabledModels?: string[];
  // custom
  api?: string;
  baseUrl?: string;
  models?: CustomModelConfig[];
}

export type ReplaceProviderInput = Omit<CreateProviderInput, "id">;

export interface AgentModelBindingInput {
  agent: string;
  projectId?: string;
  provider: string;
  model: string;
  thinking?: ThinkingLevel;
}

export interface TestConnectionResult {
  ok: boolean;
  message: string;
}

export interface SupportedModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
}

export interface SupportedBuiltinProvider {
  id: string;
  models: SupportedModel[];
}

export interface SupportedCustomApi {
  id: string;
  description: string;
}

export interface SupportedProviders {
  builtin: SupportedBuiltinProvider[];
  customApis: SupportedCustomApi[];
}

const BASE = "/api/admin/llm-providers";

export const providersApi = {
  list: () => apiGetAll<ProviderView>(BASE),
  supported: () => apiGet<SupportedProviders>(`${BASE}/supported`),
  create: (input: CreateProviderInput) => apiSend<ProviderView>(BASE, "POST", input),
  replace: (id: string, input: ReplaceProviderInput) => apiSend<ProviderView>(`${BASE}/${id}`, "PATCH", input),
  remove: (id: string) => apiSend<void>(`${BASE}/${id}`, "DELETE"),
  test: (id: string) => apiSend<TestConnectionResult>(`${BASE}/${id}/test`, "POST"),
  listBindings: () => apiGet<AgentModelBindingInput[]>(`${BASE}/model-bindings`),
  replaceBindings: (bindings: AgentModelBindingInput[]) => apiSend<AgentModelBindingInput[]>(`${BASE}/model-bindings`, "PUT", bindings),
};
