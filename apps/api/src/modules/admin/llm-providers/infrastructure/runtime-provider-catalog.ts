// Adapter of the provider catalog port over the runtime's catalog: the builtin
// provider/model list of the pinned pi release (ADR-0009, ADR-0018). The pi-specific
// part lives in services/runtime; this adapter only maps it onto the domain port.

import { Injectable } from "@nestjs/common";
import { builtinEndpoint, listSupportedProviders } from "@kintsugi/runtime/provider-catalog";
import { ProviderCatalog, type ProviderEndpoint, type SupportedProviders } from "../domain/provider-catalog.js";

@Injectable()
export class RuntimeProviderCatalog extends ProviderCatalog {
  list(): SupportedProviders {
    return listSupportedProviders();
  }

  endpointOf(piProvider: string): ProviderEndpoint | undefined {
    return builtinEndpoint(piProvider);
  }
}
