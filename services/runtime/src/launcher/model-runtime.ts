// Builds the job's pi ModelRuntime from a stored LLM provider record (ADR-0009).
// Builtin providers come from pi's pinned catalog; custom providers are described
// through a job-scoped models.json. Credentials never touch that file — they are
// injected at runtime (`setRuntimeApiKey`) or as environment variables (ADR-0004).

import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

/** pi provider id a job calls: the builtin catalog id, or the custom provider id. */
export function piProviderId(config: StoredProviderConfig): string {
  return config.kind === "builtin" ? (config.piProvider ?? config.id) : config.id;
}

export async function buildModelRuntime(config: StoredProviderConfig, credentials: ResolvedCredentials): Promise<ModelRuntime> {
  // Provider-specific environment (Bedrock region, Vertex project, …) travels as
  // environment variables only (ADR-0004).
  for (const [name, value] of Object.entries(credentials.env ?? {})) {
    process.env[name] = value;
  }

  let modelsPath: string | null = null;
  if (config.kind === "custom") {
    const dir = await mkdtemp(join(tmpdir(), "kintsugi-models-"));
    modelsPath = join(dir, "models.json");
    await writeFile(modelsPath, JSON.stringify({ providers: { [config.id]: toPiProviderConfig(config, credentials) } }, null, 2), "utf8");
  }

  const runtime = await ModelRuntime.create({ modelsPath, refreshOnCreate: false });
  if (credentials.apiKey !== undefined) {
    await runtime.setRuntimeApiKey(piProviderId(config), credentials.apiKey);
  }
  return runtime;
}

function toPiProviderConfig(config: StoredProviderConfig, credentials: ResolvedCredentials): Record<string, unknown> {
  const resolve = (value: string | { secretId: string }): string =>
    typeof value === "string" ? value : (credentials.secrets?.[value.secretId] ?? "");
  return {
    ...(config.api === undefined ? {} : { api: config.api }),
    ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
    ...(config.headers === undefined ? {} : { headers: Object.fromEntries(Object.entries(config.headers).map(([name, value]) => [name, resolve(value)])) }),
    models: (config.models ?? []).map((model) => ({ ...model })),
  };
}
