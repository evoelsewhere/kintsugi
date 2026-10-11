// Providers — the LLM provider registry UI (Settings → Providers).
// Full CRUD against /api/admin/llm-providers (ADR-0009): providers as list rows,
// agent → model bindings as a compact editor. Credentials are write-only.

import type { ThinkingLevel } from "@kintsugi/domain";
import { PlugZap, Plus, Settings2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ProviderIcon } from "@/components/ui/provider-icon";
import { Select, type SelectOption } from "@/components/ui/select";
import { StatusDot } from "@/components/ui/status-dot";
import {
  providersApi,
  type AgentModelBindingInput,
  type CreateProviderInput,
  type ProviderView,
  type ReplaceProviderInput,
  type TestConnectionResult,
} from "@/lib/api/providers";
import { cn } from "@/lib/utils";
import { ProviderFormDialog } from "./provider-form-dialog";

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

const THINKING_OPTIONS: SelectOption[] = [{ value: "", label: "Default" }, ...THINKING_LEVELS.map((level) => ({ value: level, label: level }))];

export function ProvidersSection(): React.JSX.Element {
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [bindings, setBindings] = useState<AgentModelBindingInput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; provider: ProviderView | null }>({ open: false, provider: null });
  const [removeTarget, setRemoveTarget] = useState<ProviderView | null>(null);
  const [tests, setTests] = useState<Record<string, TestConnectionResult>>({});

  const load = useCallback(async (): Promise<void> => {
    try {
      const [all, list] = await Promise.all([providersApi.list(), providersApi.listBindings()]);
      setProviders(all);
      setBindings(list);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(input: CreateProviderInput | ReplaceProviderInput): Promise<void> {
    if (dialog.provider === null) await providersApi.create(input as CreateProviderInput);
    else await providersApi.replace(dialog.provider.id, input as ReplaceProviderInput);
    await load();
  }

  async function remove(provider: ProviderView): Promise<void> {
    await providersApi.remove(provider.id);
    await load();
  }

  async function test(provider: ProviderView): Promise<void> {
    setTests((prev) => ({ ...prev, [provider.id]: { ok: true, message: "testing…" } }));
    try {
      const result = await providersApi.test(provider.id);
      setTests((prev) => ({ ...prev, [provider.id]: result }));
    } catch (testError) {
      setTests((prev) => ({ ...prev, [provider.id]: { ok: false, message: testError instanceof Error ? testError.message : String(testError) } }));
    }
  }

  async function saveBindings(): Promise<void> {
    try {
      setBindings(await providersApi.replaceBindings(bindings));
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  }

  const providerOptions: SelectOption[] = providers.map((provider) => ({ value: provider.id, label: provider.id, hint: provider.kind }));

  return (
    <div className="flex flex-col gap-5">
      {/* Toolbar */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-medium text-text">LLM providers</h2>
          <p className="mt-0.5 text-[12px] text-text-muted">Registry used by the Kintsugi runtime (ADR-0009) — credentials are encrypted at rest.</p>
        </div>
        <Button size="small" variant="solid" onClick={() => setDialog({ open: true, provider: null })}>
          <Plus className="size-4" />
          Add provider
        </Button>
      </div>

      {error === null ? null : <p className="text-[13px] text-[var(--ds-status-red)]">{error}</p>}

      {/* Provider list */}
      <Card className="overflow-hidden p-0">
        {providers.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-text-secondary">No providers configured yet — add one to let runtime agents call models.</p>
        ) : (
          providers.map((provider, index) => {
            const testResult = tests[provider.id];
            return (
              <div key={provider.id}>
                <div className={cn("flex items-center gap-3 px-4 py-2.5", index > 0 && "[box-shadow:0_-1px_0_rgba(0,0,0,0.06)]")}>
                  <ProviderIcon id={provider.kind === "builtin" ? (provider.piProvider ?? provider.id) : provider.id} label={provider.id} className="size-5" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] text-text">{provider.id}</p>
                    <p className="truncate text-[12px] text-text-muted">
                      {provider.kind === "builtin"
                        ? `pi catalog · ${provider.piProvider ?? "—"}`
                        : `${provider.api ?? "—"} · ${provider.baseUrl ?? "—"}`}
                    </p>
                  </div>
                  <span className="hidden shrink-0 items-center gap-1.5 text-[12px] text-text-secondary sm:inline-flex">
                    <StatusDot tone={provider.hasApiKey ? "green" : "orange"} />
                    {provider.hasApiKey ? "key stored" : "no key"}
                  </span>
                  {provider.enabled ? null : <span className="shrink-0 text-[12px] text-text-muted">disabled</span>}
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="small" variant="ghost" onClick={() => setDialog({ open: true, provider })}>
                      <Settings2 className="size-4" />
                      Configure
                    </Button>
                    <Button size="small" variant="ghost" onClick={() => void test(provider)}>
                      <PlugZap className="size-4" />
                      Test
                    </Button>
                    <Button
                      size="icon"
                      variant="danger"
                      aria-label={`Remove ${provider.id}`}
                      onClick={() => setRemoveTarget(provider)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                {testResult === undefined ? null : (
                  <p className="flex items-center gap-1.5 px-4 pb-2.5 text-[12px] text-text-secondary">
                    <StatusDot tone={testResult.ok ? "green" : "red"} />
                    {testResult.message}
                  </p>
                )}
              </div>
            );
          })
        )}
      </Card>

      {/* Agent model bindings */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Agent model bindings</CardTitle>
            <CardDescription>Provider and model per runtime agent — blank = installation default.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button size="small" variant="ghost" onClick={() => setBindings((prev) => [...prev, { agent: "", provider: providers[0]?.id ?? "", model: "" }])}>
              <Plus className="size-4" />
              Add binding
            </Button>
            <Button size="small" variant="solid" onClick={() => void saveBindings()} disabled={bindings.length === 0}>
              Save bindings
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {bindings.length === 0 ? (
            <p className="text-[13px] text-text-muted">No bindings yet — agents fall back to the installation default.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {bindings.map((binding, index) => (
                <div key={index} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1.1fr_1fr_1fr_0.8fr_auto]">
                  <Input
                    value={binding.agent}
                    placeholder="agent id"
                    aria-label="Agent id"
                    className="h-[var(--geist-form-height)] text-[14px]"
                    onChange={(event) => setBindings((prev) => prev.map((row, i) => (i === index ? { ...row, agent: event.target.value } : row)))}
                  />
                  <Select
                    value={binding.provider}
                    placeholder="Default"
                    options={providerOptions}
                    onChange={(value) => setBindings((prev) => prev.map((row, i) => (i === index ? { ...row, provider: value } : row)))}
                  />
                  <Input
                    value={binding.model}
                    placeholder="model id"
                    className="h-[var(--geist-form-height)] text-[14px]"
                    onChange={(event) => setBindings((prev) => prev.map((row, i) => (i === index ? { ...row, model: event.target.value } : row)))}
                  />
                  <Select
                    value={binding.thinking ?? ""}
                    options={THINKING_OPTIONS}
                    onChange={(value) =>
                      setBindings((prev) =>
                        prev.map((row, i) => (i === index ? { ...row, thinking: (value === "" ? undefined : value) as ThinkingLevel | undefined } : row)),
                      )
                    }
                  />
                  <Button size="icon" variant="danger" aria-label="Remove binding" onClick={() => setBindings((prev) => prev.filter((_, i) => i !== index))}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ProviderFormDialog
        open={dialog.open}
        provider={dialog.provider}
        existingIds={providers.map((entry) => entry.id)}
        onClose={() => setDialog({ open: false, provider: null })}
        onSubmit={save}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        title="Remove provider?"
        description={removeTarget === null ? undefined : `Remove "${removeTarget.id}" and its model bindings?`}
        confirmLabel="Remove provider"
        busyLabel="Removing…"
        onConfirm={() => (removeTarget === null ? Promise.resolve() : remove(removeTarget))}
        onClose={() => setRemoveTarget(null)}
      >
        This action cannot be undone. Agent model bindings that use this provider will also be removed.
      </ConfirmDialog>
    </div>
  );
}
