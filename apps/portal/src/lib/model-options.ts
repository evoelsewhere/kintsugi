// The models a binding may pick for a provider: a built-in provider offers its enabled models
// (all models of its pi catalog entry when none are listed), a custom provider the models it
// declares. A binding's current model stays selectable even when it is no longer offered.

import type { ThinkingLevel } from "@kintsugi/domain";
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

/** What pi accepts for a custom reasoning model that declares no level map: everything up to `high`. */
const CUSTOM_REASONING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];

/**
 * The thinking levels a model supports, as pi reports them (`getSupportedThinkingLevels`): a built-in
 * model carries its own list from the catalog, a custom model reasons up to `high` when it says it
 * reasons and not at all otherwise. No model, or a model the catalog does not know, offers none.
 */
export function modelThinkingLevels(provider: ProviderView | undefined, supported: SupportedProviders | undefined, modelId: string): ThinkingLevel[] {
  if (provider === undefined || modelId === "") return [];
  if (provider.kind === "custom") {
    const model = provider.models?.find((entry) => entry.id === modelId);
    if (model === undefined) return [];
    return model.reasoning === true ? [...CUSTOM_REASONING_LEVELS] : ["off"];
  }
  const catalog = supported?.builtin.find((entry) => entry.id === (provider.piProvider ?? provider.id))?.models ?? [];
  return [...(catalog.find((model) => model.id === modelId)?.thinkingLevels ?? [])];
}
