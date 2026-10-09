// Provider form dialog — redesigned (ADR-0009).
// Providers come from the pinned pi catalog (no Kind choice); the provider id is
// generated; models are picked from a searchable list. Credentials are write-only.
// All controls are custom components (no native form widgets).

import { Check, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import { Field } from "../../../components/ui/field";
import { Input } from "../../../components/ui/input";
import { Modal } from "../../../components/ui/modal";
import { ProviderIcon } from "../../../components/ui/provider-icon";
import {
  providersApi,
  type CreateProviderInput,
  type ProviderView,
  type ReplaceProviderInput,
  type SupportedProviders,
} from "../../../lib/api/providers";
import { cn } from "../../../lib/utils";

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

export function ProviderFormDialog({ open, provider, existingIds, onClose, onSubmit }: ProviderFormDialogProps): React.JSX.Element {
  const [supported, setSupported] = useState<SupportedProviders | null>(null);
  const [piProvider, setPiProvider] = useState("");
  const [enabledModels, setEnabledModels] = useState<string[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [providerQuery, setProviderQuery] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPiProvider(provider?.piProvider ?? "");
    setEnabledModels(provider?.enabledModels ?? []);
    setApiKey("");
    setEnabled(provider?.enabled ?? true);
    setProviderQuery("");
    setModelQuery("");
    setError(null);
    void providersApi.supported().then(setSupported).catch(() => setSupported({ builtin: [], customApis: [] }));
  }, [open, provider]);

  const catalog = useMemo(() => {
    const needle = providerQuery.trim().toLowerCase();
    const all = supported?.builtin ?? [];
    return all.filter((entry) => entry.id.includes(needle));
  }, [supported, providerQuery]);

  const selected = useMemo(() => supported?.builtin.find((entry) => entry.id === piProvider), [supported, piProvider]);

  const filteredModels = useMemo(() => {
    const needle = modelQuery.trim().toLowerCase();
    return (selected?.models ?? []).filter((model) => model.id.toLowerCase().includes(needle) || (model.name ?? "").toLowerCase().includes(needle));
  }, [selected, modelQuery]);

  const generatedId = provider?.id ?? generateProviderId(piProvider || "provider", existingIds);

  function pickProvider(id: string): void {
    setPiProvider(id);
    setEnabledModels([]);
  }

  function toggleModel(id: string): void {
    setEnabledModels((prev) => (prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]));
  }

  async function submit(): Promise<void> {
    if (piProvider === "") return setError("Choose a provider from the catalog.");
    const input = {
      kind: "builtin" as const,
      piProvider,
      enabledModels,
      enabled,
      ...(apiKey === "" ? {} : { apiKey }),
    };
    setSaving(true);
    try {
      await onSubmit(provider === null ? { ...input, id: generatedId } : input);
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
      title={provider === null ? "Add provider" : `Configure ${provider.id}`}
      description="Providers come from the pinned pi catalog. Settings are stored in the database; credentials are encrypted."
      onClose={onClose}
      footer={
        <>
          <Button size="small" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="small" variant="solid" onClick={() => void submit()} disabled={saving || piProvider === ""}>
            {saving ? "Saving…" : "Save provider"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Provider picker (create) or summary (edit) */}
        {provider === null ? (
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" strokeWidth={1.75} />
              <Input value={providerQuery} placeholder={`Search ${supported?.builtin.length ?? ""} providers…`} className="pl-8" onChange={(event) => setProviderQuery(event.target.value)} />
            </div>
            <div className="max-h-52 overflow-y-auto rounded-[var(--geist-radius)] [box-shadow:var(--ds-shadow-border)]">
              {catalog.map((entry) => {
                const active = entry.id === piProvider;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => pickProvider(entry.id)}
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
        ) : (
          <div className="shadow-border flex items-center gap-2.5 rounded-[var(--geist-radius)] px-3 py-2.5">
            <ProviderIcon id={provider.piProvider ?? provider.id} label={provider.id} className="size-5" />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] text-text">{provider.id}</p>
              <p className="truncate text-[12px] text-text-muted">pi catalog · {provider.piProvider ?? "—"}</p>
            </div>
          </div>
        )}

        {/* Models — searchable checklist */}
        {piProvider !== "" ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[14px] leading-5 text-text">Models</span>
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-text-muted">
                  {enabledModels.length === 0 ? "All enabled" : `${enabledModels.length} selected`}
                </span>
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
              <Input value={modelQuery} placeholder="Filter models…" className="pl-8" onChange={(event) => setModelQuery(event.target.value)} />
            </div>
            <div className="max-h-64 overflow-y-auto rounded-[var(--geist-radius)] [box-shadow:var(--ds-shadow-border)]">
              {filteredModels.map((model) => {
                const checked = enabledModels.includes(model.id);
                return (
                  <div
                    key={model.id}
                    role="checkbox"
                    aria-checked={checked}
                    tabIndex={0}
                    onClick={() => toggleModel(model.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleModel(model.id);
                      }
                    }}
                    className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
                  >
                    <Checkbox checked={checked} onChange={() => toggleModel(model.id)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-text">{model.name ?? model.id}</p>
                      {model.name === undefined ? null : <p className="truncate text-[11px] text-text-muted">{model.id}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-[11px] text-text-muted">
                      {model.reasoning === true ? <span className="rounded-[var(--geist-pill-radius)] bg-recessed px-1.5">reasoning</span> : null}
                      {model.contextWindow === undefined ? null : <span>{Math.round(model.contextWindow / 1000)}k ctx</span>}
                      {model.maxTokens === undefined ? null : <span>{Math.round(model.maxTokens / 1000)}k out</span>}
                    </div>
                  </div>
                );
              })}
              {filteredModels.length === 0 ? <p className="px-3 py-2 text-[13px] text-text-muted">No models match.</p> : null}
            </div>
          </div>
        ) : null}

        <Field label={provider?.hasApiKey === true ? "API key (stored — leave blank to keep)" : "API key"} hint="Write-only: encrypted at rest and never displayed again.">
          <Input type="password" value={apiKey} placeholder="••••••••" onChange={(event) => setApiKey(event.target.value)} />
        </Field>

        <Checkbox checked={enabled} onChange={setEnabled} label="Enabled for runtime jobs" />

        {error === null ? null : <p className="text-[13px] text-[var(--ds-status-red)]">{error}</p>}
      </div>
    </Modal>
  );
}
