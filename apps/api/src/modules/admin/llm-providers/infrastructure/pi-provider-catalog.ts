// Pi adapter of the provider catalog: reads the builtin provider/model list from the
// pinned pi release (ADR-0009, ADR-0018) so the portal offers exactly what the runtime
// can call. Custom wire protocols follow pi's models.json api ids.

import { Injectable } from "@nestjs/common";
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import {
  ProviderCatalog,
  type SupportedCustomApi,
  type SupportedModel,
  type SupportedProviders,
} from "../domain/provider-catalog.js";

/** TODO: read from pi's api registry (dist/api/*) when it exposes a stable list. */
const CUSTOM_APIS: SupportedCustomApi[] = [
  { id: "openai-completions", description: "OpenAI-compatible chat completions (vLLM, Ollama, LiteLLM, gateways)" },
  { id: "openai-responses", description: "OpenAI Responses API endpoints" },
  { id: "anthropic-messages", description: "Anthropic Messages API (Anthropic-compatible gateways)" },
  { id: "google-generative-ai", description: "Google Generative AI (Gemini) endpoints" },
  { id: "bedrock-converse-stream", description: "AWS Bedrock ConverseStream-compatible endpoints" },
  { id: "mistral-conversations", description: "Mistral Conversations API endpoints" },
];

@Injectable()
export class PiProviderCatalog extends ProviderCatalog {
  list(): SupportedProviders {
    return {
      builtin: getBuiltinProviders().map((id) => ({ id, models: this.#modelsOf(id) })),
      customApis: CUSTOM_APIS,
    };
  }

  #modelsOf(providerId: string): SupportedModel[] {
    const models = getBuiltinModels(providerId as Parameters<typeof getBuiltinModels>[0]) as unknown as Array<{
      id: string;
      name?: string;
      contextWindow?: number;
      maxTokens?: number;
      reasoning?: boolean;
    }>;
    return models.map((model) => ({
      id: model.id,
      ...(model.name === undefined ? {} : { name: model.name }),
      ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
      ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
      ...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
    }));
  }
}
