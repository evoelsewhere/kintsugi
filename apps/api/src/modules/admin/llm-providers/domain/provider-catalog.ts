// Domain port of the supported-provider catalog (ADR-0009: the builtin list is read
// from the pinned pi version). The portal queries it to render per-provider forms.

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
  /** pi wire protocol id used in models.json. */
  id: string;
  description: string;
}

export interface SupportedProviders {
  builtin: SupportedBuiltinProvider[];
  customApis: SupportedCustomApi[];
}

/** Where a builtin provider is reached: its wire protocol and base URL. */
export interface ProviderEndpoint {
  api: string;
  baseUrl: string;
}

export abstract class ProviderCatalog {
  abstract list(): SupportedProviders;
  /** The builtin provider's endpoint, or undefined when it has several or none. */
  abstract endpointOf(piProvider: string): ProviderEndpoint | undefined;
}
