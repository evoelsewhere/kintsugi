// Provider form dialog (ADR-0009). Two kinds:
//   - catalog: a builtin provider of the pinned pi catalog; the id is generated and models
//     are picked from a searchable list;
//   - custom: any endpoint speaking a supported wire protocol (vLLM, Ollama, LiteLLM,
//     internal gateways), with its own models and headers.
// Credentials are write-only. The form mounts fresh each time the dialog opens, so its
// state always starts from the provider being edited.

import { Check, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckMark, Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ProviderIcon } from "@/components/ui/provider-icon";
import { Select } from "@/components/ui/select";
import {
  providersApi,
  type CreateProviderInput,
  type CustomModelConfig,
  type ProviderView,
  type ReplaceProviderInput,
  type SupportedProviders,
} from "@/lib/api/providers";
import { cn } from "@/lib/utils";

const PROVIDER_ID = /^[a-z0-9][a-z0-9-]*$/;

function generateProviderId(piProvider: string, existing: string[]): string {
  const base = piProvider.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (!existing.includes(base)) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!existing.includes(candidate)) return candidate;
  }
}

export interface ProviderFormDialogProps {
  open: boolean;
  provider: ProviderView | null;
  existingIds: string[];
  onClose: () => void;
  onSubmit: (input: CreateProviderInput | ReplaceProviderInput) => Promise<void>;
}

export function ProviderFormDialog(props: ProviderFormDialogProps): React.JSX.Element | null {
  return props.open ? <ProviderForm {...props} /> : null;
}

type Kind = "builtin" | "custom";
type InputType = "text" | "image";

interface ModelRow {
  id: string;
  name: string;
  contextWindow: string;
  maxTokens: string;
  inputTypes: InputType[];
  reasoning: boolean;
  costInput: string;
  costOutput: string;
  costCacheRead: string;
  costCacheWrite: string;
  compat: string;
}

interface HeaderRow {
  name: string;
  value: string;
  stored: boolean;
  originalName?: string;
}

const toModelRow = (model: CustomModelConfig): ModelRow => ({
  id: model.id,
  name: model.name ?? "",
  contextWindow: model.contextWindow === undefined ? "" : String(model.contextWindow),
  maxTokens: model.maxTokens === undefined ? "" : String(model.maxTokens),
  inputTypes: model.input ?? ["text"],
  reasoning: model.reasoning ?? false,
  costInput: model.cost?.input === undefined ? "" : String(model.cost.input),
  costOutput: model.cost?.output === undefined ? "" : String(model.cost.output),
  costCacheRead: model.cost?.cacheRead === undefined ? "" : String(model.cost.cacheRead),
  costCacheWrite: model.cost?.cacheWrite === undefined ? "" : String(model.cost.cacheWrite),
  compat: model.compat === undefined ? "" : JSON.stringify(model.compat),
});

const EMPTY_MODEL: ModelRow = {
  id: "",
  name: "",
  contextWindow: "",
  maxTokens: "",
  inputTypes: ["text"],
  reasoning: false,
  costInput: "",
  costOutput: "",
  costCacheRead: "",
  costCacheWrite: "",
  compat: "",
};

function ProviderForm({ provider, existingIds, onClose, onSubmit }: ProviderFormDialogProps): React.JSX.Element {
  const editing = provider !== null;
  const [supported, setSupported] = useState<SupportedProviders | null>(null);
  const [kind, setKind] = useState<Kind>(provider?.kind ?? "builtin");
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // builtin
  const [piProvider, setPiProvider] = useState(provider?.piProvider ?? "");
  const [enabledModels, setEnabledModels] = useState<string[]>(provider?.enabledModels ?? []);
  const [providerQuery, setProviderQuery] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  // custom
  const [customId, setCustomId] = useState("");
  const [api, setApi] = useState(provider?.api ?? "openai-completions");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [models, setModels] = useState<ModelRow[]>(provider?.models?.map(toModelRow) ?? [{ ...EMPTY_MODEL }]);
  const [headers, setHeaders] = useState<HeaderRow[]>(
    Object.keys(provider?.headers ?? {}).map((name) => ({ name, value: "", stored: true, originalName: name })),
  );

  useEffect(() => {
    void providersApi
      .supported()
      .then(setSupported)
      .catch(() => setSupported({ builtin: [], customApis: [] }));
  }, []);

  const catalog = useMemo(() => {
    const needle = providerQuery.trim().toLowerCase();
    return (supported?.builtin ?? []).filter((entry) => entry.id.includes(needle));
  }, [supported, providerQuery]);

  const selected = useMemo(() => supported?.builtin.find((entry) => entry.id === piProvider), [supported, piProvider]);

  const filteredModels = useMemo(() => {
    const needle = modelQuery.trim().toLowerCase();
    return (selected?.models ?? []).filter((model) => model.id.toLowerCase().includes(needle) || (model.name ?? "").toLowerCase().includes(needle));
  }, [selected, modelQuery]);

  const generatedId = provider?.id ?? generateProviderId(piProvider || "provider", existingIds);

  function toggleModel(id: string): void {
    setEnabledModels((prev) => (prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]));
  }

  function builtinInput(): CreateProviderInput | ReplaceProviderInput | string {
    if (piProvider === "") return "Choose a provider from the catalog.";
    const input = { kind: "builtin" as const, piProvider, enabledModels, enabled, ...(apiKey === "" ? {} : { apiKey }) };
    return editing ? input : { ...input, id: generatedId };
  }

  function customInput(): CreateProviderInput | ReplaceProviderInput | string {
    const id = customId.trim();
    if (!editing && !PROVIDER_ID.test(id)) return "Provider id: lowercase letters, digits and dashes, starting with a letter or digit.";
    if (!editing && existingIds.includes(id)) return `A provider named "${id}" already exists.`;
    if (api === "") return "Choose the wire protocol.";
    if (!/^https?:\/\/\S+$/.test(baseUrl.trim())) return "Base URL must start with http:// or https://.";
    const rows = models.filter((row) => row.id.trim() !== "");
    if (rows.length === 0) return "Add at least one model.";
    const ids = rows.map((row) => row.id.trim());
    if (new Set(ids).size !== ids.length) return "Model ids must be unique.";
    const numberOf = (value: string): number | undefined | null => {
      if (value.trim() === "") return undefined;
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    };
    const numberCost = (value: string): number | undefined | null => {
      if (value.trim() === "") return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    };
    const parsedModels: CustomModelConfig[] = [];
    for (const row of rows) {
      const contextWindow = numberOf(row.contextWindow);
      const maxTokens = numberOf(row.maxTokens);
      if (contextWindow === null || maxTokens === null) return `Model "${row.id}": context window and max output must be positive whole numbers.`;
      if (row.inputTypes.length === 0) return `Model "${row.id}": pick at least one input type.`;

      const costInput = numberCost(row.costInput);
      const costOutput = numberCost(row.costOutput);
      const costCacheRead = numberCost(row.costCacheRead);
      const costCacheWrite = numberCost(row.costCacheWrite);
      if (costInput === null || costOutput === null || costCacheRead === null || costCacheWrite === null) {
        return `Model "${row.id}": costs must be non-negative numbers.`;
      }
      const hasCost = [costInput, costOutput, costCacheRead, costCacheWrite].some((value) => value !== undefined);
      if (hasCost && (costInput === undefined || costOutput === undefined)) {
        return `Model "${row.id}": enter both input and output costs.`;
      }
      const cost = hasCost
        ? {
            input: costInput!,
            output: costOutput!,
            ...(costCacheRead === undefined ? {} : { cacheRead: costCacheRead }),
            ...(costCacheWrite === undefined ? {} : { cacheWrite: costCacheWrite }),
          }
        : undefined;

      let compat: Record<string, boolean> | undefined;
      if (row.compat.trim() !== "") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(row.compat);
        } catch {
          return `Model "${row.id}": compatibility overrides must be valid JSON.`;
        }
        if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object" || Object.values(parsed).some((value) => typeof value !== "boolean")) {
          return `Model "${row.id}": compatibility overrides must be a JSON object of boolean values.`;
        }
        compat = parsed as Record<string, boolean>;
      }

      parsedModels.push({
        id: row.id.trim(),
        ...(row.name.trim() === "" ? {} : { name: row.name.trim() }),
        ...(contextWindow === undefined ? {} : { contextWindow }),
        ...(maxTokens === undefined ? {} : { maxTokens }),
        input: row.inputTypes,
        reasoning: row.reasoning,
        ...(cost === undefined ? {} : { cost }),
        ...(compat === undefined ? {} : { compat }),
      });
    }
    const headerEntries: Array<[string, string | null]> = [];
    const seenHeaderNames = new Set<string>();
    for (const row of headers) {
      const name = row.name.trim();
      if (name === "" && row.value === "") continue;
      if (name === "") return "Every header needs a name.";
      const normalizedName = name.toLowerCase();
      if (seenHeaderNames.has(normalizedName)) return "Header names must be unique.";
      seenHeaderNames.add(normalizedName);
      // Header names are case-insensitive (the API stores them lower-case).
      const keepStoredValue = row.stored && row.originalName?.toLowerCase() === normalizedName && row.value === "";
      if (row.stored && !keepStoredValue && row.value === "") return `Enter a value to rename header "${row.originalName ?? name}".`;
      headerEntries.push([name, keepStoredValue ? null : row.value]);
    }
    const input = {
      kind: "custom" as const,
      api,
      baseUrl: baseUrl.trim(),
      models: parsedModels,
      headers: Object.fromEntries(headerEntries),
      enabled,
      ...(apiKey === "" ? {} : { apiKey }),
    };
    return editing ? input : { ...input, id };
  }

  async function submit(): Promise<void> {
    const input = kind === "builtin" ? builtinInput() : customInput();
    if (typeof input === "string") return setError(input);
    setError(null);
    setSaving(true);
    try {
      await onSubmit(input);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSaving(false);
    }
  }

  const customApiPresentation: Record<string, { label: string; iconId: string }> = {
    "openai-completions": { label: "OpenAI-compatible Chat Completions", iconId: "openai" },
    "openai-responses": { label: "OpenAI Responses API", iconId: "openai" },
    "anthropic-messages": { label: "Anthropic Messages API", iconId: "anthropic" },
    "google-generative-ai": { label: "Google Gemini API", iconId: "google-generative-ai" },
    "bedrock-converse-stream": { label: "AWS Bedrock ConverseStream", iconId: "bedrock" },
    "mistral-conversations": { label: "Mistral Conversations API", iconId: "mistral" },
  };
  const customApiOptions = (supported?.customApis ?? []).map((entry) => {
    const presentation = customApiPresentation[entry.id] ?? { label: entry.description, iconId: entry.id };
    return {
      value: entry.id,
      label: presentation.label,
      hint: entry.id,
      icon: <ProviderIcon id={presentation.iconId} label={presentation.label} />,
    };
  });

  // Shared by the create grid (right column) and the editing layout (below the identity card).
  const modelsPicker =
    piProvider === "" ? null : (
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[14px] leading-5 text-text">Models</span>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-text-muted">{enabledModels.length === 0 ? "All enabled" : `${enabledModels.length} selected`}</span>
            <Button size="small" variant="ghost" onClick={() => setEnabledModels([])}>
              All
            </Button>
            <Button size="small" onClick={() => setEnabledModels((selected?.models ?? []).map((model) => model.id))}>
              Select all
            </Button>
          </div>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" strokeWidth={1.75} />
          <Input value={modelQuery} placeholder="Filter models…" aria-label="Filter models" className="pl-8" onChange={(event) => setModelQuery(event.target.value)} />
        </div>
        <div className="max-h-72 overflow-y-auto rounded-[var(--geist-radius)] [box-shadow:var(--ds-shadow-border)]">
          {filteredModels.map((model) => {
            const checked = enabledModels.includes(model.id);
            const meta = [
              model.reasoning === true ? "reasoning" : null,
              model.contextWindow === undefined ? null : `${Math.round(model.contextWindow / 1000)}k ctx`,
              model.maxTokens === undefined ? null : `${Math.round(model.maxTokens / 1000)}k out`,
            ]
              .filter((entry): entry is string => entry !== null)
              .join(" · ");
            // The row owns the checkbox role and the toggle; the box inside is visual only.
            return (
              <div
                key={model.id}
                role="checkbox"
                aria-checked={checked}
                aria-label={model.name ?? model.id}
                tabIndex={0}
                onClick={() => toggleModel(model.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggleModel(model.id);
                  }
                }}
                className="flex cursor-pointer items-start gap-2.5 px-3 py-1.5 hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
              >
                <CheckMark checked={checked} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-text">{model.name ?? model.id}</p>
                  <p className="truncate text-[11px] text-text-muted">
                    {model.name === undefined ? meta : meta === "" ? model.id : `${model.id} · ${meta}`}
                  </p>
                </div>
              </div>
            );
          })}
          {filteredModels.length === 0 ? <p className="px-3 py-2 text-[13px] text-text-muted">No models match.</p> : null}
        </div>
      </div>
    );

  return (
    <Modal
      open
      size="nested"
      title={editing ? `Configure ${provider.id}` : "Add provider"}
      description="Catalog providers come from the pinned pi release; custom providers are any endpoint speaking a supported protocol. Credentials are encrypted and never shown again."
      onClose={onClose}
      footer={
        <>
          <Button size="small" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="small" variant="solid" onClick={() => void submit()} disabled={saving || (kind === "builtin" && piProvider === "")}>
            {saving ? "Saving…" : "Save provider"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {editing ? null : (
          <div role="radiogroup" aria-label="Provider kind" className="flex gap-1.5">
            {(
              [
                ["builtin", "Catalog provider"],
                ["custom", "Custom endpoint"],
              ] as const
            ).map(([value, label]) => (
              <Button key={value} size="small" variant={kind === value ? "solid" : "ghost"} role="radio" aria-checked={kind === value} onClick={() => setKind(value)}>
                {label}
              </Button>
            ))}
          </div>
        )}

        {kind === "builtin" ? (
          editing ? (
            <>
              <div className="shadow-border flex items-center gap-2.5 rounded-[var(--geist-radius)] px-3 py-2.5">
                <ProviderIcon id={provider.piProvider ?? provider.id} label={provider.id} className="size-5" />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] text-text">{provider.id}</p>
                  <p className="truncate text-[12px] text-text-muted">pi catalog · {provider.piProvider ?? "—"}</p>
                </div>
              </div>
              {modelsPicker}
            </>
          ) : (
            // Two columns: pick a provider on the left, pick its models on the right.
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" strokeWidth={1.75} />
                  <Input
                    value={providerQuery}
                    placeholder={`Search ${supported?.builtin.length ?? ""} providers…`}
                    aria-label="Search providers"
                    className="pl-8"
                    onChange={(event) => setProviderQuery(event.target.value)}
                  />
                </div>
                <div className="max-h-72 overflow-y-auto rounded-[var(--geist-radius)] [box-shadow:var(--ds-shadow-border)]">
                  {catalog.map((entry) => {
                    const active = entry.id === piProvider;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          setPiProvider(entry.id);
                          setEnabledModels([]);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-text-secondary hover:bg-hover hover:text-text",
                          active && "bg-hover text-text",
                        )}
                      >
                        <ProviderIcon id={entry.id} label={entry.id} />
                        <span className="min-w-0 flex-1 truncate">{entry.id}</span>
                        <span className="shrink-0 text-[11px] text-text-muted">{entry.models.length} models</span>
                        <Check className={cn("size-3.5 shrink-0", active ? "opacity-100" : "opacity-0")} strokeWidth={2} />
                      </button>
                    );
                  })}
                  {catalog.length === 0 ? <p className="px-3 py-2 text-[13px] text-text-muted">No providers match.</p> : null}
                </div>
                {piProvider === "" ? null : (
                  <p className="text-[12px] text-text-muted">
                    Provider id: <span className="font-mono text-[11px] text-text-secondary">{generatedId}</span> (generated)
                  </p>
                )}
              </div>

              {modelsPicker ?? (
                <p className="shadow-border flex min-h-72 items-center justify-center rounded-[var(--geist-radius)] px-4 text-center text-[13px] text-text-muted">
                  Pick a provider to see its models.
                </p>
              )}
            </div>
          )
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Provider id" hint={editing ? "Fixed once created." : "Lowercase letters, digits and dashes."}>
                <Input
                  value={editing ? provider.id : customId}
                  disabled={editing}
                  placeholder="internal-gateway"
                  aria-label="Provider id"
                  onChange={(event) => setCustomId(event.target.value)}
                />
              </Field>
              <Field label="Wire protocol">
                <Select value={api} options={customApiOptions} onChange={setApi} />
              </Field>
            </div>
            <Field label="Base URL" hint="Changing it on an existing provider requires re-entering the API key.">
              <Input value={baseUrl} placeholder="https://llm.internal.example/v1" aria-label="Base URL" onChange={(event) => setBaseUrl(event.target.value)} />
            </Field>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[14px] leading-5 text-text">Models</span>
                <Button size="small" variant="ghost" onClick={() => setModels((prev) => [...prev, { ...EMPTY_MODEL }])}>
                  <Plus className="size-3.5" strokeWidth={2} /> Add model
                </Button>
              </div>
              {models.map((row, index) => {
                const update = (patch: Partial<ModelRow>): void => setModels((prev) => prev.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
                return (
                  <div key={index} className="space-y-3 rounded-md p-3">
                    <div className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[1.3fr_1.2fr_0.8fr_0.8fr_auto]">
                      <Input value={row.id} placeholder="model id" aria-label={`Model ${index + 1} id`} onChange={(event) => update({ id: event.target.value })} />
                      <Input value={row.name} placeholder="display name" aria-label={`Model ${index + 1} name`} onChange={(event) => update({ name: event.target.value })} />
                      <Input value={row.contextWindow} placeholder="context" inputMode="numeric" aria-label={`Model ${index + 1} context window`} onChange={(event) => update({ contextWindow: event.target.value })} />
                      <Input value={row.maxTokens} placeholder="max out" inputMode="numeric" aria-label={`Model ${index + 1} max output tokens`} onChange={(event) => update({ maxTokens: event.target.value })} />
                      <Button size="icon" variant="ghost" aria-label={`Remove model ${index + 1}`} disabled={models.length === 1} onClick={() => setModels((prev) => prev.filter((_, i) => i !== index))}>
                        <Trash2 className="size-3.5" strokeWidth={1.75} />
                      </Button>
                    </div>

                    <div>
                      <p className="mb-1 text-[12px] text-text-muted">Cost (USD per million tokens)</p>
                      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                        <Field label="Input">
                          <Input value={row.costInput} inputMode="decimal" aria-label={`Model ${index + 1} input cost`} onChange={(event) => update({ costInput: event.target.value })} />
                        </Field>
                        <Field label="Output">
                          <Input value={row.costOutput} inputMode="decimal" aria-label={`Model ${index + 1} output cost`} onChange={(event) => update({ costOutput: event.target.value })} />
                        </Field>
                        <Field label="Cache read">
                          <Input value={row.costCacheRead} inputMode="decimal" aria-label={`Model ${index + 1} cache read cost`} onChange={(event) => update({ costCacheRead: event.target.value })} />
                        </Field>
                        <Field label="Cache write">
                          <Input value={row.costCacheWrite} inputMode="decimal" aria-label={`Model ${index + 1} cache write cost`} onChange={(event) => update({ costCacheWrite: event.target.value })} />
                        </Field>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-[13px] text-text-muted">Input types</span>
                      <Checkbox
                        checked={row.inputTypes.includes("text")}
                        onChange={(checked) => update({ inputTypes: checked ? [...row.inputTypes, "text" as const].filter((value, i, all) => all.indexOf(value) === i) : row.inputTypes.filter((value) => value !== "text") })}
                        label="Text"
                      />
                      <Checkbox
                        checked={row.inputTypes.includes("image")}
                        onChange={(checked) => update({ inputTypes: checked ? [...row.inputTypes, "image" as const].filter((value, i, all) => all.indexOf(value) === i) : row.inputTypes.filter((value) => value !== "image") })}
                        label="Image"
                      />
                      <Checkbox checked={row.reasoning} onChange={(reasoning) => update({ reasoning })} label="Reasoning" />
                    </div>

                    <Field label="Compatibility overrides (JSON)" hint="Optional object containing boolean compatibility flags.">
                      <Input value={row.compat} placeholder='{"supportsDeveloperRole": true}' aria-label={`Model ${index + 1} compatibility overrides`} onChange={(event) => update({ compat: event.target.value })} />
                    </Field>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[14px] leading-5 text-text">Headers</span>
                <Button size="small" variant="ghost" onClick={() => setHeaders((prev) => [...prev, { name: "", value: "", stored: false }])}>
                  <Plus className="size-3.5" strokeWidth={2} /> Add header
                </Button>
              </div>
              <p className="text-[12px] text-text-muted">
                Put provider credentials in the API key field, not in headers. Header values are write-only and encrypted at rest; leave a stored value blank to keep it.
              </p>
              {headers.map((row, index) => {
                const update = (patch: Partial<HeaderRow>): void => setHeaders((prev) => prev.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
                return (
                  <div key={index} className="grid grid-cols-[1fr_1.5fr_auto] items-center gap-2">
                    <Input value={row.name} placeholder="header name" aria-label={`Header ${index + 1} name`} onChange={(event) => update({ name: event.target.value })} />
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={row.value}
                      placeholder={row.stored ? "Stored — leave blank to keep" : "value"}
                      aria-label={`Header ${index + 1} value`}
                      onChange={(event) => update({ value: event.target.value })}
                    />
                    <Button size="small" variant="ghost" aria-label={`Remove header ${index + 1}`} onClick={() => setHeaders((prev) => prev.filter((_, i) => i !== index))}>
                      <Trash2 className="size-3.5" strokeWidth={1.75} />
                    </Button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <Field label={provider?.hasApiKey === true ? "API key (stored — leave blank to keep)" : "API key"} hint="Write-only: encrypted at rest and never displayed again.">
          <Input type="password" autoComplete="new-password" value={apiKey} placeholder="••••••••" aria-label="API key" onChange={(event) => setApiKey(event.target.value)} />
        </Field>

        <Checkbox checked={enabled} onChange={setEnabled} label="Enabled for runtime jobs" />

        {error === null ? null : (
          <p role="alert" className="text-[13px] text-[var(--ds-status-red)]">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
