// Provider form dialog — create or edit an LLM provider (ADR-0009).
// The supported provider list is queried from the API (read from the pinned pi
// catalog); the form adapts per provider. Credentials are write-only.

import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Modal } from "../../../components/ui/modal";
import {
  providersApi,
  type CreateProviderInput,
  type ProviderView,
  type ReplaceProviderInput,
  type SupportedProviders,
} from "../../../lib/api/providers";

interface ModelRow {
  id: string;
  contextWindow: string;
  maxTokens: string;
}

interface FormState {
  id: string;
  kind: "builtin" | "custom";
  enabled: boolean;
  piProvider: string;
  enabledModels: string[];
  apiKey: string;
  api: string;
  baseUrl: string;
  models: ModelRow[];
}

const EMPTY_MODELS: ModelRow[] = [{ id: "", contextWindow: "", maxTokens: "" }];

const EMPTY: FormState = {
  id: "",
  kind: "builtin",
  enabled: true,
  piProvider: "",
  enabledModels: [],
  apiKey: "",
  api: "",
  baseUrl: "",
  models: EMPTY_MODELS,
};

function toForm(provider: ProviderView): FormState {
  return {
    id: provider.id,
    kind: provider.kind,
    enabled: provider.enabled,
    piProvider: provider.piProvider ?? "",
    enabledModels: provider.enabledModels ?? [],
    apiKey: "",
    api: provider.api ?? "",
    baseUrl: provider.baseUrl ?? "",
    models: (provider.models ?? [{ id: "" }]).map((model) => ({
      id: model.id,
      contextWindow: model.contextWindow === undefined ? "" : String(model.contextWindow),
      maxTokens: model.maxTokens === undefined ? "" : String(model.maxTokens),
    })),
  };
}

export interface ProviderFormDialogProps {
  open: boolean;
  provider: ProviderView | null;
  onClose: () => void;
  onSubmit: (input: CreateProviderInput | ReplaceProviderInput) => Promise<void>;
}

export function ProviderFormDialog({ open, provider, onClose, onSubmit }: ProviderFormDialogProps): React.JSX.Element {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [supported, setSupported] = useState<SupportedProviders | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(provider === null ? { ...EMPTY, models: EMPTY_MODELS } : toForm(provider));
    setError(null);
    void providersApi.supported().then(setSupported).catch(() => setSupported({ builtin: [], customApis: [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, provider]);

  const selectedBuiltin = useMemo(
    () => supported?.builtin.find((entry) => entry.id === form.piProvider) ?? supported?.builtin[0],
    [supported, form.piProvider],
  );
  const selectedApi = useMemo(() => supported?.customApis.find((entry) => entry.id === form.api) ?? supported?.customApis[0], [supported, form.api]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void => setForm((prev) => ({ ...prev, [key]: value }));
  const setModel = (index: number, patch: Partial<ModelRow>): void =>
    setForm((prev) => ({ ...prev, models: prev.models.map((row, i) => (i === index ? { ...row, ...patch } : row)) }));

  function toggleModel(modelId: string): void {
    set("enabledModels", form.enabledModels.includes(modelId) ? form.enabledModels.filter((id) => id !== modelId) : [...form.enabledModels, modelId]);
  }

  async function submit(): Promise<void> {
    if (provider === null && form.id.trim() === "") return setError("Provider id is required.");
    if (form.kind === "builtin" && (selectedBuiltin === undefined || form.piProvider === "" && selectedBuiltin.id === "")) {
      return setError("Choose a provider from the supported list.");
    }
    const models = form.models.filter((row) => row.id.trim() !== "").map((row) => ({
      id: row.id.trim(),
      ...(row.contextWindow === "" ? {} : { contextWindow: Number(row.contextWindow) }),
      ...(row.maxTokens === "" ? {} : { maxTokens: Number(row.maxTokens) }),
    }));
    if (form.kind === "custom" && models.length === 0) return setError("At least one model is required for custom providers.");
    if (form.kind === "custom" && form.baseUrl.trim() === "") return setError("Base URL is required.");

    const common = { enabled: form.enabled, ...(form.apiKey === "" ? {} : { apiKey: form.apiKey }) };
    const input =
      form.kind === "builtin"
        ? {
            kind: "builtin" as const,
            piProvider: form.piProvider === "" ? (selectedBuiltin?.id ?? "") : form.piProvider,
            enabledModels: form.enabledModels,
            ...common,
          }
        : { kind: "custom" as const, api: form.api === "" ? (selectedApi?.id ?? "") : form.api, baseUrl: form.baseUrl.trim(), models, ...common };

    setSaving(true);
    try {
      await onSubmit(provider === null ? { ...input, id: form.id.trim() } : input);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      wide
      title={provider === null ? "Add LLM provider" : `Configure ${provider.id}`}
      description="Provider settings are stored in the database; credentials are encrypted and never displayed again."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="solid" onClick={() => void submit()} disabled={saving}>
            {saving ? "Saving…" : "Save provider"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[14px] text-text">Kind</span>
            <select
              value={form.kind}
              onChange={(event) => set("kind", event.target.value === "builtin" ? "builtin" : "custom")}
              disabled={provider !== null}
              className="shadow-border h-[var(--geist-form-height)] rounded-[var(--geist-radius)] bg-transparent px-3 text-[14px] text-text focus-visible:outline-1 focus-visible:outline-[var(--ds-input-focus-color)] focus-visible:shadow-none disabled:text-text-muted"
            >
              <option value="builtin">builtin (pi catalog)</option>
              <option value="custom">custom (endpoint)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[14px] text-text">Provider id</span>
            <Input value={form.id} disabled={provider !== null} placeholder="my-gateway" onChange={(event) => set("id", event.target.value)} />
          </label>
        </div>

        {form.kind === "builtin" ? (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-[14px] text-text">Provider</span>
              <select
                value={form.piProvider === "" ? (selectedBuiltin?.id ?? "") : form.piProvider}
                onChange={(event) => {
                  set("piProvider", event.target.value);
                  set("enabledModels", []);
                }}
                className="shadow-border h-[var(--geist-form-height)] rounded-[var(--geist-radius)] bg-transparent px-3 text-[14px] text-text focus-visible:outline-1 focus-visible:outline-[var(--ds-input-focus-color)] focus-visible:shadow-none"
              >
                {(supported?.builtin ?? []).map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.id} ({entry.models.length} models)
                  </option>
                ))}
              </select>
              <span className="text-[12px] text-text-muted">
                {supported === null ? "Loading supported providers…" : `${supported.builtin.length} providers supported by the pinned pi catalog.`}
              </span>
            </label>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[14px] text-text">Models (none selected = all)</span>
                <Button size="small" onClick={() => set("enabledModels", (selectedBuiltin?.models ?? []).map((model) => model.id))}>
                  Select all
                </Button>
              </div>
              <div className="flex max-h-56 flex-wrap gap-2 overflow-y-auto">
                {(selectedBuiltin?.models ?? []).map((model) => {
                  const selected = form.enabledModels.includes(model.id);
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => toggleModel(model.id)}
                      title={model.name ?? model.id}
                      className={`shadow-border rounded-[var(--geist-pill-radius)] px-2.5 py-1 text-[12px] ${selected ? "text-text" : "text-text-secondary"} hover:bg-hover`}
                      style={selected ? { boxShadow: "var(--ds-shadow-border), 0 0 0 2px var(--ds-focus-color)" } : undefined}
                    >
                      {model.id}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-[14px] text-text">Wire protocol</span>
              <select
                value={form.api === "" ? (selectedApi?.id ?? "") : form.api}
                onChange={(event) => set("api", event.target.value)}
                className="shadow-border h-[var(--geist-form-height)] rounded-[var(--geist-radius)] bg-transparent px-3 text-[14px] text-text focus-visible:outline-1 focus-visible:outline-[var(--ds-input-focus-color)] focus-visible:shadow-none"
              >
                {(supported?.customApis ?? []).map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.id}
                  </option>
                ))}
              </select>
              <span className="text-[12px] text-text-muted">{selectedApi?.description ?? "Loading…"}</span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[14px] text-text">Base URL</span>
              <Input value={form.baseUrl} placeholder="https://gateway.example.com/v1" onChange={(event) => set("baseUrl", event.target.value)} />
            </label>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[14px] text-text">Models</span>
                <Button size="small" onClick={() => set("models", [...form.models, { id: "", contextWindow: "", maxTokens: "" }])}>
                  Add model
                </Button>
              </div>
              {form.models.map((row, index) => (
                <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                  <Input value={row.id} placeholder="model id" onChange={(event) => setModel(index, { id: event.target.value })} />
                  <Input value={row.contextWindow} placeholder="context" inputMode="numeric" onChange={(event) => setModel(index, { contextWindow: event.target.value })} />
                  <Input value={row.maxTokens} placeholder="max tokens" inputMode="numeric" onChange={(event) => setModel(index, { maxTokens: event.target.value })} />
                  <Button size="icon" variant="danger" aria-label="Remove model" onClick={() => set("models", form.models.filter((_, i) => i !== index))}>
                    ×
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-[14px] text-text">API key {provider?.hasApiKey === true ? "(stored — leave blank to keep)" : ""}</span>
          <Input type="password" value={form.apiKey} placeholder="••••••••" onChange={(event) => set("apiKey", event.target.value)} />
        </label>

        <label className="flex items-center gap-2 text-[14px] text-text">
          <input type="checkbox" checked={form.enabled} onChange={(event) => set("enabled", event.target.checked)} />
          Enabled
        </label>

        {error === null ? null : <p className="text-[13px] text-[var(--ds-status-red)]">{error}</p>}
      </div>
    </Modal>
  );
}
