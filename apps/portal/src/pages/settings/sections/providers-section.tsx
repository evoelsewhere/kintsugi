// Providers — the LLM provider registry UI (Settings → Providers).
// Full CRUD against /api/admin/llm-providers (ADR-0009): providers as list rows,
// agent → model bindings as a compact editor (agents from the catalog, models from the chosen
// provider, an optional project scope; "All projects" is the installation default).
// Credentials are write-only.

import type { ThinkingLevel } from "@kintsugi/domain";
import { PlugZap, Plus, Settings2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ProviderIcon } from "@/components/ui/provider-icon";
import { Select, type SelectOption } from "@/components/ui/select";
import { StatusDot } from "@/components/ui/status-dot";
import { useToast } from "@/components/ui/toast";
import { agentsApi, type AgentSummary } from "@/lib/api/agents";
import { projectsApi, type ProjectView } from "@/lib/api/projects";
import {
  providersApi,
  type AgentModelBindingInput,
  type CreateProviderInput,
  type ProviderView,
  type ReplaceProviderInput,
  type SupportedProviders,
  type TestConnectionResult,
} from "@/lib/api/providers";
import { modelOptions } from "@/lib/model-options";
import { cn } from "@/lib/utils";
import { ProviderFormDialog } from "./provider-form-dialog";

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

const THINKING_OPTIONS: SelectOption[] = [{ value: "", label: "Default" }, ...THINKING_LEVELS.map((level) => ({ value: level, label: level }))];

export function ProvidersSection(): React.JSX.Element {
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [bindings, setBindings] = useState<AgentModelBindingInput[]>([]);
  const [savedBindings, setSavedBindings] = useState<string>("[]");
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [supported, setSupported] = useState<SupportedProviders | undefined>(undefined);
  const [savingBindings, setSavingBindings] = useState(false);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; provider: ProviderView | null }>({ open: false, provider: null });
  const [removeTarget, setRemoveTarget] = useState<ProviderView | null>(null);
  const [tests, setTests] = useState<Record<string, TestConnectionResult>>({});

  const load = useCallback(async (): Promise<void> => {
    try {
      const [all, list, catalog, allProjects, catalogAgents] = await Promise.all([
        providersApi.list(),
        providersApi.listBindings(),
        providersApi.supported(),
        projectsApi.list(),
        agentsApi.list(),
      ]);
      setProviders(all);
      setBindings(list);
      setSavedBindings(JSON.stringify(list));
      setSupported(catalog);
      setProjects(allProjects);
      setAgents(catalogAgents.filter((agent) => agent.audience === "runtime"));
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
    toast.success(dialog.provider === null ? "Provider added" : "Provider saved", dialog.provider?.id ?? (input as CreateProviderInput).id);
    await load();
  }

  async function remove(provider: ProviderView): Promise<void> {
    await providersApi.remove(provider.id);
    toast.success(`Removed ${provider.id}`);
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
    setSavingBindings(true);
    try {
      const saved = await providersApi.replaceBindings(bindings);
      setBindings(saved);
      setSavedBindings(JSON.stringify(saved));
      toast.success("Model bindings saved", `${saved.length} binding${saved.length === 1 ? "" : "s"} — jobs started from now on use them.`);
    } catch (saveError) {
      toast.error("Could not save the model bindings", saveError);
    } finally {
      setSavingBindings(false);
    }
  }

  const bindingsChanged = JSON.stringify(bindings) !== savedBindings;
  const incomplete = bindings.some((binding) => binding.agent === "" || binding.provider === "" || binding.model === "");
  const agentOptions: SelectOption[] = agents.map((agent) => ({ value: agent.name, label: agent.name, ...(agent.enabled ? {} : { hint: "disabled" }) }));
  const scopeOptions: SelectOption[] = [{ value: "", label: "All projects", hint: "default" }, ...projects.map((project) => ({ value: project.id, label: project.name, hint: project.id }))];
  const withCurrent = (options: SelectOption[], value: string): SelectOption[] =>
    value === "" || options.some((option) => option.value === value) ? options : [{ value, label: value, hint: "not in the catalog" }, ...options];
  const patch = (index: number, change: Partial<AgentModelBindingInput>): void => setBindings((prev) => prev.map((row, i) => (i === index ? { ...row, ...change } : row)));

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
            <CardDescription>Provider and model per runtime agent, for all projects (the default) or one project. Agents without a binding use the installation default.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button size="small" variant="ghost" onClick={() => setBindings((prev) => [...prev, { agent: "", provider: providers[0]?.id ?? "", model: "" }])}>
              <Plus className="size-4" />
              Add binding
            </Button>
            <Button size="small" variant="solid" onClick={() => void saveBindings()} disabled={savingBindings || !bindingsChanged || incomplete} title={incomplete ? "Choose an agent, provider and model on every row" : undefined}>
              {savingBindings ? "Saving…" : "Save bindings"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {bindings.length === 0 ? (
            <p className="text-[13px] text-text-muted">No bindings yet — agents fall back to the installation default.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="hidden grid-cols-[1.1fr_1fr_0.9fr_1.1fr_0.7fr_auto] gap-2 text-[11px] tracking-wide text-text-muted uppercase sm:grid">
                <span>Agent</span>
                <span>Scope</span>
                <span>Provider</span>
                <span>Model</span>
                <span>Thinking</span>
                <span className="w-8" />
              </div>
              {bindings.map((binding, index) => (
                <div key={index} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1.1fr_1fr_0.9fr_1.1fr_0.7fr_auto]">
                  <Select value={binding.agent} placeholder="Agent" options={withCurrent(agentOptions, binding.agent)} onChange={(value) => patch(index, { agent: value })} />
                  <Select
                    value={binding.projectId ?? ""}
                    options={withCurrent(scopeOptions, binding.projectId ?? "")}
                    onChange={(value) =>
                      setBindings((prev) =>
                        prev.map((row, i) => {
                          if (i !== index) return row;
                          const { projectId: _previous, ...rest } = row;
                          return value === "" ? rest : { ...rest, projectId: value };
                        }),
                      )
                    }
                  />
                  <Select value={binding.provider} placeholder="Provider" options={providerOptions} onChange={(value) => patch(index, { provider: value, model: "" })} />
                  <Select
                    value={binding.model}
                    placeholder="Model"
                    disabled={binding.provider === ""}
                    options={modelOptions(providers.find((provider) => provider.id === binding.provider), supported, binding.model)}
                    onChange={(value) => patch(index, { model: value })}
                  />
                  <Select
                    value={binding.thinking ?? ""}
                    options={THINKING_OPTIONS}
                    onChange={(value) =>
                      setBindings((prev) =>
                        prev.map((row, i) => {
                          if (i !== index) return row;
                          const { thinking: _previous, ...rest } = row;
                          return value === "" ? rest : { ...rest, thinking: value as ThinkingLevel };
                        }),
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
