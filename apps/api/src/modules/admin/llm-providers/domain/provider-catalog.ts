// Domain port of the supported-provider catalog (ADR-0009: the builtin list is read
// from the pinned pi version). The portal queries it to render per-provider forms.

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
  /** pi wire protocol id used in models.json. */
  id: string;
  description: string;
}

export interface SupportedProviders {
  builtin: SupportedBuiltinProvider[];
  customApis: SupportedCustomApi[];
}

export abstract class ProviderCatalog {
  abstract list(): SupportedProviders;
}
