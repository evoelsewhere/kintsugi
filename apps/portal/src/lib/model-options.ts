// The models a binding may pick for a provider: a built-in provider offers its enabled models
// (all models of its pi catalog entry when none are listed), a custom provider the models it
// declares. A binding's current model stays selectable even when it is no longer offered.

import type { SelectOption } from "@/components/ui/select";
import type { ProviderView, SupportedProviders } from "./api/providers";

export function modelOptions(provider: ProviderView | undefined, supported: SupportedProviders | undefined, current?: string): SelectOption[] {
  const options: SelectOption[] = [];
  if (provider !== undefined) {
    if (provider.kind === "custom") {
      for (const model of provider.models ?? []) options.push({ value: model.id, label: model.id, ...(model.name === undefined ? {} : { hint: model.name }) });
    } else {
      const catalog = supported?.builtin.find((entry) => entry.id === (provider.piProvider ?? provider.id))?.models ?? [];
      const ids = provider.enabledModels !== undefined && provider.enabledModels.length > 0 ? provider.enabledModels : catalog.map((model) => model.id);
      for (const id of ids) {
        const name = catalog.find((model) => model.id === id)?.name;
        options.push({ value: id, label: id, ...(name === undefined ? {} : { hint: name }) });
      }
    }
  }
  if (current !== undefined && current !== "" && !options.some((option) => option.value === current)) options.unshift({ value: current, label: current, hint: "not offered by this provider" });
  return options;
}

/** Whether pi's catalog (or a custom provider's model definition) advertises reasoning for this model. */
export function modelSupportsReasoning(provider: ProviderView | undefined, supported: SupportedProviders | undefined, modelId: string): boolean {
  if (provider === undefined || modelId === "") return false;
  if (provider.kind === "custom") return provider.models?.find((model) => model.id === modelId)?.reasoning === true;
  const catalog = supported?.builtin.find((entry) => entry.id === (provider.piProvider ?? provider.id))?.models ?? [];
  return catalog.find((model) => model.id === modelId)?.reasoning === true;
}
