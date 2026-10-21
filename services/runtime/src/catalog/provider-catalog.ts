// Catalog of the LLM providers the pinned pi release can call (ADR-0009, ADR-0018), in a
// pi-agnostic shape. apps/api serves it to the portal so admins can only configure
// what the runtime supports; pi-specific code stays in services/runtime (AGENTS.md).
// Exported as `@kintsugi/runtime/provider-catalog` so importers load only pi-ai's
// provider list, not the agent session machinery.

import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";

export interface SupportedModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  /** The thinking levels pi accepts for this model, weakest first (`["off"]` when it does not reason). */
  thinkingLevels: string[];
}

export interface SupportedBuiltinProvider {
  id: string;
  models: SupportedModel[];
}

export interface SupportedCustomApi {
  /** pi wire protocol id of a custom provider. */
  id: string;
  description: string;
}

export interface SupportedProviders {
  builtin: SupportedBuiltinProvider[];
  customApis: SupportedCustomApi[];
}

/** TODO: read from pi's api registry when it exposes a stable list. */
const CUSTOM_APIS: SupportedCustomApi[] = [
  { id: "openai-completions", description: "OpenAI-compatible chat completions (vLLM, Ollama, LiteLLM, gateways)" },
  { id: "openai-responses", description: "OpenAI Responses API endpoints" },
  { id: "anthropic-messages", description: "Anthropic Messages API (Anthropic-compatible gateways)" },
  { id: "google-generative-ai", description: "Google Generative AI (Gemini) endpoints" },
  { id: "bedrock-converse-stream", description: "AWS Bedrock ConverseStream-compatible endpoints" },
  { id: "mistral-conversations", description: "Mistral Conversations API endpoints" },
];

export function listSupportedProviders(): SupportedProviders {
  return {
    builtin: getBuiltinProviders().map((id) => ({ id, models: modelsOf(id) })),
    customApis: CUSTOM_APIS,
  };
}

/** A builtin provider's single wire protocol and base URL; undefined when it has several or none. */
export function builtinEndpoint(providerId: string): { api: string; baseUrl: string } | undefined {
  const models = getBuiltinModels(providerId as Parameters<typeof getBuiltinModels>[0]) as unknown as Array<{ api?: string; baseUrl?: string }>;
  const endpoints = new Set(models.map((model) => `${model.api ?? ""} ${model.baseUrl ?? ""}`));
  if (endpoints.size !== 1) return undefined;
  const [api, baseUrl] = [...endpoints][0]!.split(" ");
  return api && baseUrl ? { api, baseUrl } : undefined;
}

function modelsOf(providerId: string): SupportedModel[] {
  const models = getBuiltinModels(providerId as Parameters<typeof getBuiltinModels>[0]);
  return models.map((model) => ({
    id: model.id,
    ...(model.name === undefined ? {} : { name: model.name }),
    ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
    ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
    ...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
    thinkingLevels: getSupportedThinkingLevels(model),
  }));
}
