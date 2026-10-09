// Port of the LLM provider registry. Implemented by infrastructure adapters
// (PgLlmProviderRepository); the application layer depends only on this contract.

import type { AgentModelBinding } from "@kintsugi/runtime-sdk";
import type { LlmProviderRecord, RegisterLlmProvider } from "./llm-provider.js";

export abstract class LlmProviderRepository {
  abstract list(): Promise<LlmProviderRecord[]>;
  abstract get(id: string): Promise<LlmProviderRecord | undefined>;
  abstract create(input: RegisterLlmProvider): Promise<LlmProviderRecord>;
  abstract replace(id: string, input: RegisterLlmProvider): Promise<LlmProviderRecord | undefined>;
  abstract remove(id: string): Promise<boolean>;
  abstract listBindings(): Promise<AgentModelBinding[]>;
  abstract replaceBindings(bindings: AgentModelBinding[]): Promise<void>;
  /** Resolves the stored API key — connectivity checks and the runtime launcher only. */
  abstract resolveApiKey(providerId: string): Promise<string | undefined>;
}
