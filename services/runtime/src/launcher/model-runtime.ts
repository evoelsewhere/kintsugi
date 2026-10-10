// Builds a job's pi ModelRuntime from a stored LLM provider record (ADR-0009), entirely in
// memory: no models.json, no auth.json, nothing read from the host's ~/.pi. Builtin
// providers come from pi's pinned catalog; custom providers are registered from the
// record. API keys are runtime-only. Provider environment (Bedrock region, Vertex project…)
// is returned for the launcher to put in the runner's process environment (ADR-0004).

import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";

export interface StoredAuth {
  type: "api-key" | "env" | "none";
  key?: { secretId: string };
  vars?: Record<string, string>;
}

export interface StoredModel {
  id: string;
  name?: string;
  input?: ("text" | "image")[];
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  compat?: Record<string, boolean>;
}

export interface StoredProviderConfig {
  kind: "builtin" | "custom";
  id: string;
  enabled: boolean;
  auth: StoredAuth;
  piProvider?: string;
  enabledModels?: string[];
  api?: string;
  baseUrl?: string;
  headers?: Record<string, string | { secretId: string }>;
  models?: StoredModel[];
}

export interface ResolvedCredentials {
  apiKey?: string;
  env?: Record<string, string>;
  /** secretId → plaintext, for configs that reference secrets inline (e.g. headers). */
  secrets?: Record<string, string>;
}

type ProviderInput = Parameters<ModelRuntime["registerProvider"]>[1];

/** pi provider id a job calls: the builtin catalog id, or the custom provider id. */
export function piProviderId(config: StoredProviderConfig): string {
  return config.kind === "builtin" ? (config.piProvider ?? config.id) : config.id;
}

export async function buildModelRuntime(config: StoredProviderConfig, credentials: ResolvedCredentials): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });
  if (config.kind === "custom") {
    runtime.registerProvider(config.id, toPiProvider(config, credentials));
  }
  // pi refuses to call a provider without a key; keyless servers (Ollama, vLLM…) get a
  // placeholder, as pi's own docs suggest for local models.
  const apiKey = credentials.apiKey ?? (config.auth.type === "none" ? "none" : undefined);
  if (apiKey !== undefined) {
    await runtime.setRuntimeApiKey(piProviderId(config), apiKey);
  }
  return runtime;
}

function toPiProvider(config: StoredProviderConfig, credentials: ResolvedCredentials): ProviderInput {
  const secret = (value: string | { secretId: string }): string =>
    typeof value === "string" ? value : (credentials.secrets?.[value.secretId] ?? "");
  return {
    name: config.id,
    ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
    ...(config.api === undefined ? {} : { api: config.api as ProviderInput["api"] }),
    ...(config.headers === undefined
      ? {}
      : { headers: Object.fromEntries(Object.entries(config.headers).map(([name, value]) => [name, secret(value)])) }),
    models: (config.models ?? []).map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      input: model.input ?? ["text"],
      reasoning: model.reasoning ?? false,
      contextWindow: model.contextWindow ?? 128_000,
      maxTokens: model.maxTokens ?? 16_384,
      cost: { cacheRead: 0, cacheWrite: 0, ...(model.cost ?? { input: 0, output: 0 }) },
      ...(model.compat === undefined ? {} : { compat: model.compat }),
    })),
  };
}
