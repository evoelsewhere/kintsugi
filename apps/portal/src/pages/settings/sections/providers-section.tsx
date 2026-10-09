// Providers — the LLM provider registry UI (Settings → Providers).
// Full CRUD against /api/admin/llm-providers (ADR-0009): credentials are write-only,
// settings live in the database. Includes agent → model bindings.

import { RUNTIME_AGENTS, type ThinkingLevel } from "@kintsugi/domain";
import { PlugZap, Plus, Settings2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { StatusDot } from "../../../components/ui/status-dot";
import {
  providersApi,
  type AgentModelBindingInput,
  type CreateProviderInput,
  type ProviderView,
  type ReplaceProviderInput,
  type TestConnectionResult,
} from "../../../lib/api/providers";
import { ProviderFormDialog } from "./provider-form-dialog";

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

export function ProvidersSection(): React.JSX.Element {
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [bindings, setBindings] = useState<AgentModelBindingInput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; provider: ProviderView | null }>({ open: false, provider: null });
  const [tests, setTests] = useState<Record<string, TestConnectionResult>>({});

  const load = useCallback(async (): Promise<void> => {
    try {
      const [page, list] = await Promise.all([providersApi.list(), providersApi.listBindings()]);
      setProviders(page.items);
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
    if (!window.confirm(`Remove provider "${provider.id}"? Bindings that use it are removed too.`)) return;
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="h-subtitle text-text">LLM providers</h2>
          <p className="mt-1 text-[13px] text-text-secondary">
            Registry used by the Kintsugi runtime (ADR-0009). Settings are stored in the database; credentials are encrypted at rest.
          </p>
        </div>
        <Button variant="solid" onClick={() => setDialog({ open: true, provider: null })}>
          <Plus className="size-4" />
          Add provider
        </Button>
      </div>

      {error === null ? null : <p className="text-[13px] text-[var(--ds-status-red)]">{error}</p>}

      {providers.length === 0 ? (
        <Card>
          <CardContent>
            <p className="text-[13px] text-text-secondary">No providers configured yet. Add one to let runtime agents call models.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {providers.map((provider) => {
            const test_ = tests[provider.id];
            return (
              <Card key={provider.id}>
                <CardHeader>
                  <div>
                    <CardTitle>{provider.id}</CardTitle>
                    <CardDescription>
                      {provider.kind === "builtin"
                        ? `pi catalog · ${provider.piProvider ?? "—"}`
                        : `${provider.api ?? "—"} · ${provider.baseUrl ?? "—"}`}
                    </CardDescription>
                  </div>
                  <StatusDot tone={provider.hasApiKey ? "green" : "orange"} />
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-text-secondary">
                    <span className="rounded-[var(--geist-pill-radius)] bg-recessed px-2 py-0.5">{provider.kind}</span>
                    <span className="rounded-[var(--geist-pill-radius)] bg-recessed px-2 py-0.5">
                      {provider.kind === "custom" ? `${provider.models?.length ?? 0} models` : (provider.enabledModels?.length ?? 0) === 0 ? "all models" : `${provider.enabledModels?.length} models`}
                    </span>
                    <span className="rounded-[var(--geist-pill-radius)] bg-recessed px-2 py-0.5">{provider.hasApiKey ? "key stored" : "no key"}</span>
                    {provider.enabled ? null : <span className="rounded-[var(--geist-pill-radius)] bg-recessed px-2 py-0.5">disabled</span>}
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <Button size="small" onClick={() => setDialog({ open: true, provider })}>
                      <Settings2 className="size-4" />
                      Configure
                    </Button>
                    <Button size="small" onClick={() => void test(provider)}>
                      <PlugZap className="size-4" />
                      Test
                    </Button>
                    <Button size="small" variant="danger" onClick={() => void remove(provider)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>

                  {test_ === undefined ? null : (
                    <p className="mt-3 text-[12px] text-text-secondary">
                      <StatusDot tone={test_.ok ? "green" : "red"} className="mr-1.5 align-middle" />
                      {test_.message}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Agent model bindings</CardTitle>
            <CardDescription>Which provider and model each runtime agent uses (blank project = installation default).</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="small"
              onClick={() =>
                setBindings((prev) => [...prev, { agent: "assessment", provider: providers[0]?.id ?? "", model: "" }])
              }
            >
              <Plus className="size-4" />
              Add binding
            </Button>
            <Button size="small" variant="solid" onClick={() => void saveBindings()}>
              Save bindings
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-1 gap-2 text-[11px] tracking-wider text-text-muted uppercase sm:grid-cols-[1.2fr_1fr_1fr_0.8fr_auto]">
              <span>Agent</span>
              <span>Provider</span>
              <span>Model</span>
              <span>Thinking</span>
              <span className="w-9" />
            </div>
            {bindings.map((binding, index) => (
              <div key={index} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1.2fr_1fr_1fr_0.8fr_auto]">
                <select
                  value={binding.agent}
                  onChange={(event) =>
                    setBindings((prev) => prev.map((row, i) => (i === index ? { ...row, agent: event.target.value as AgentModelBindingInput["agent"] } : row)))
                  }
                  className="shadow-border h-9 rounded-[var(--geist-radius)] bg-transparent px-2 text-[13px] text-text focus-visible:outline-1 focus-visible:outline-[var(--ds-input-focus-color)] focus-visible:shadow-none"
                >
                  {RUNTIME_AGENTS.map((agent) => (
                    <option key={agent} value={agent}>
                      {agent}
                    </option>
                  ))}
                </select>
                <select
                  value={binding.provider}
                  onChange={(event) => setBindings((prev) => prev.map((row, i) => (i === index ? { ...row, provider: event.target.value } : row)))}
                  className="shadow-border h-9 rounded-[var(--geist-radius)] bg-transparent px-2 text-[13px] text-text focus-visible:outline-1 focus-visible:outline-[var(--ds-input-focus-color)] focus-visible:shadow-none"
                >
                  <option value="">—</option>
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.id}
                    </option>
                  ))}
                </select>
                <Input
                  value={binding.model}
                  placeholder="model id"
                  className="h-9 text-[13px]"
                  onChange={(event) => setBindings((prev) => prev.map((row, i) => (i === index ? { ...row, model: event.target.value } : row)))}
                />
                <select
                  value={binding.thinking ?? ""}
                  onChange={(event) =>
                    setBindings((prev) =>
                      prev.map((row, i) =>
                        i === index ? { ...row, thinking: (event.target.value === "" ? undefined : event.target.value) as ThinkingLevel | undefined } : row,
                      ),
                    )
                  }
                  className="shadow-border h-9 rounded-[var(--geist-radius)] bg-transparent px-2 text-[13px] text-text focus-visible:outline-1 focus-visible:outline-[var(--ds-input-focus-color)] focus-visible:shadow-none"
                >
                  <option value="">—</option>
                  {THINKING_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
                <Button
                  size="icon"
                  variant="danger"
                  aria-label="Remove binding"
                  onClick={() => setBindings((prev) => prev.filter((_, i) => i !== index))}
                >
                  ×
                </Button>
              </div>
            ))}
            {bindings.length === 0 ? <p className="text-[13px] text-text-secondary">No bindings yet.</p> : null}
          </div>
        </CardContent>
      </Card>

      <ProviderFormDialog
        open={dialog.open}
        provider={dialog.provider}
        onClose={() => setDialog({ open: false, provider: null })}
        onSubmit={save}
      />
    </div>
  );
}
