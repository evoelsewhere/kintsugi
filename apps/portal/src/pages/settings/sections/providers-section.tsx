// Providers — the LLM provider registry UI (Settings → Providers).
// Full CRUD against /api/admin/llm-providers (ADR-0009): providers as list rows,
// agent → model bindings as a compact editor (agents from the catalog, models from the chosen
// provider, an optional project scope; "All projects" is the installation default), with
// type-ahead pickers, a warning on bindings whose agent no longer exists, and "Apply to a
// project" to bind every runtime agent of a project at once. Credentials are write-only.

import type { ThinkingLevel } from "@kintsugi/domain";
import { AlertTriangle, Layers, PlugZap, Plus, Settings2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
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
  type ModelBindingStatus,
  type ProviderView,
  type ReplaceProviderInput,
  type SupportedProviders,
  type TestConnectionResult,
} from "@/lib/api/providers";
import { modelOptions, modelThinkingLevels, thinkingOptions } from "@/lib/model-options";
import { cn } from "@/lib/utils";
import { ApplyModelDialog } from "./apply-model-dialog";
import { ProviderFormDialog } from "./provider-form-dialog";

/** The editable binding of a stored one (the orphan flag is kept apart, by agent name). */
const bindingOf = ({ orphan: _orphan, ...binding }: ModelBindingStatus): AgentModelBindingInput => binding;

export function ProvidersSection(): React.JSX.Element {
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [bindings, setBindings] = useState<AgentModelBindingInput[]>([]);
  const [savedBindings, setSavedBindings] = useState<string>("[]");
  /** Agents of stored bindings that are no longer in the catalog (from the API). */
  const [orphans, setOrphans] = useState<ReadonlySet<string>>(new Set());
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [supported, setSupported] = useState<SupportedProviders | undefined>(undefined);
  const [savingBindings, setSavingBindings] = useState(false);
  const [applying, setApplying] = useState(false);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; provider: ProviderView | null }>({ open: false, provider: null });
  const [removeTarget, setRemoveTarget] = useState<ProviderView | null>(null);
  const [tests, setTests] = useState<Record<string, TestConnectionResult>>({});

  const showStored = useCallback((stored: ModelBindingStatus[]): void => {
    const list = stored.map(bindingOf);
    setBindings(list);
    setSavedBindings(JSON.stringify(list));
    setOrphans(new Set(stored.filter((binding) => binding.orphan).map((binding) => binding.agent)));
  }, []);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [all, stored, catalog, allProjects, catalogAgents] = await Promise.all([
        providersApi.list(),
        providersApi.bindingStatus(),
        providersApi.supported(),
        projectsApi.list(),
        agentsApi.list(),
      ]);
      setProviders(all);
      showStored(stored);
      setSupported(catalog);
      setProjects(allProjects);
      setAgents(catalogAgents.filter((agent) => agent.audience === "runtime"));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, [showStored]);

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
  const orphanCount = bindings.filter((binding) => orphans.has(binding.agent)).length;
  const agentOptions: SelectOption[] = agents.map((agent) => ({ value: agent.name, label: agent.name, ...(agent.enabled ? {} : { hint: "disabled" }) }));
  const scopeOptions: SelectOption[] = [{ value: "", label: "All projects", hint: "default" }, ...projects.map((project) => ({ value: project.id, label: project.name, hint: project.id }))];
  const withCurrent = (options: SelectOption[], value: string, missing: string): SelectOption[] =>
    value === "" || options.some((option) => option.value === value) ? options : [{ value, label: value, hint: missing }, ...options];
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
        <CardHeader className="flex-col gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>Agent model bindings</CardTitle>
              <span className="rounded-full bg-recessed px-2 py-0.5 text-[11px] text-text-secondary">
                {bindings.length} {bindings.length === 1 ? "binding" : "bindings"}
              </span>
            </div>
            <CardDescription className="max-w-2xl">
              Choose a provider and model for each runtime agent. Project-specific bindings override the installation default.
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {bindingsChanged ? (
              <span role="status" className="inline-flex items-center gap-1.5 pr-1 text-[12px] text-text-secondary">
                <StatusDot tone="orange" />
                Unsaved changes
              </span>
            ) : null}
            {orphanCount === 0 ? null : (
              <Button
                size="small"
                variant="ghost"
                title="Remove the bindings whose agent no longer exists, then save"
                onClick={() => setBindings((prev) => prev.filter((binding) => !orphans.has(binding.agent)))}
              >
                <Trash2 className="size-4" />
                Remove orphans ({orphanCount})
              </Button>
            )}
            <Button
              size="small"
              variant="ghost"
              disabled={bindingsChanged || providers.length === 0 || agents.length === 0}
              title={bindingsChanged ? "Save or undo the changes first" : "Bind every runtime agent of a project to one provider and model"}
              onClick={() => setApplying(true)}
            >
              <Layers className="size-4" />
              Apply to a project
            </Button>
            <Button size="small" variant="ghost" onClick={() => setBindings((prev) => [...prev, { agent: "", provider: providers[0]?.id ?? "", model: "" }])}>
              <Plus className="size-4" />
              Add binding
            </Button>
            <Button size="small" variant="solid" onClick={() => void saveBindings()} disabled={savingBindings || !bindingsChanged || incomplete}>
              {savingBindings ? "Saving…" : "Save bindings"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="mt-4">
          {bindings.length === 0 ? (
            <div className="rounded-lg bg-recessed px-4 py-5 text-center">
              <p className="text-[13px] font-medium text-text">No model bindings yet</p>
              <p className="mt-1 text-[12px] text-text-secondary">Runtime agents will use the installation default until you add a binding.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {bindings.map((binding, index) => {
                const provider = providers.find((entry) => entry.id === binding.provider);
                const levels = modelThinkingLevels(provider, supported, binding.model);
                const orphan = orphans.has(binding.agent);
                return (
                <div key={index} className={cn("flex flex-col gap-2 rounded-lg bg-background p-3 shadow-border", orphan && "bg-[color-mix(in_srgb,var(--ds-status-orange)_6%,transparent)]")}>
                  {orphan ? (
                    <p role="status" className="flex items-center gap-1.5 text-[12px] text-text">
                      <AlertTriangle className="size-3.5 shrink-0 text-[var(--ds-status-orange)]" strokeWidth={1.75} />
                      <span>
                        <span className="font-medium">{binding.agent}</span>: agent no longer exists. Jobs never use this binding; remove it.
                      </span>
                    </p>
                  ) : null}
                  <div className="flex items-start gap-3">
                  <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2 xl:grid-cols-12">
                  <div className="min-w-0 xl:col-span-4">
                    <label htmlFor={`binding-agent-${index}`} className="mb-1 block text-[11px] font-medium tracking-wide text-text-muted uppercase">Agent</label>
                    <Combobox
                      id={`binding-agent-${index}`}
                      className="min-w-0"
                      value={binding.agent}
                      placeholder="Choose agent"
                      options={withCurrent(agentOptions, binding.agent, orphan ? "agent no longer exists" : "not a runtime agent")}
                      onChange={(value) => patch(index, { agent: value })}
                    />
                  </div>
                  <div className="min-w-0 xl:col-span-3">
                    <label htmlFor={`binding-scope-${index}`} className="mb-1 block text-[11px] font-medium tracking-wide text-text-muted uppercase">Scope</label>
                    <Combobox
                      id={`binding-scope-${index}`}
                      className="min-w-0"
                      value={binding.projectId ?? ""}
                      options={withCurrent(scopeOptions, binding.projectId ?? "", "not a project")}
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
                  </div>
                  <div className="min-w-0 xl:col-span-5">
                    <label htmlFor={`binding-provider-${index}`} className="mb-1 block text-[11px] font-medium tracking-wide text-text-muted uppercase">Provider</label>
                    <Select
                      id={`binding-provider-${index}`}
                      className="min-w-0"
                      value={binding.provider}
                      placeholder="Choose provider"
                      options={providerOptions}
                      onChange={(value) =>
                        setBindings((prev) =>
                          prev.map((row, i) => {
                            if (i !== index) return row;
                            const { thinking: _previous, ...rest } = row;
                            return { ...rest, provider: value, model: "" };
                          }),
                        )
                      }
                    />
                  </div>
                  <div className="min-w-0 xl:col-span-8">
                    <label htmlFor={`binding-model-${index}`} className="mb-1 block text-[11px] font-medium tracking-wide text-text-muted uppercase">Model</label>
                    <Combobox
                      id={`binding-model-${index}`}
                      className="min-w-0"
                      value={binding.model}
                      placeholder="Choose model"
                      disabled={binding.provider === ""}
                      options={modelOptions(provider, supported, binding.model)}
                      onChange={(value) =>
                        setBindings((prev) =>
                          prev.map((row, i) => {
                            if (i !== index) return row;
                            const next = { ...row, model: value };
                            if (row.thinking === undefined || modelThinkingLevels(providers.find((provider) => provider.id === row.provider), supported, value).includes(row.thinking)) return next;
                            const { thinking: _previous, ...rest } = next;
                            return rest;
                          }),
                        )
                      }
                    />
                  </div>
                  <div className="min-w-0 xl:col-span-4">
                    <label htmlFor={`binding-thinking-${index}`} className="mb-1 block text-[11px] font-medium tracking-wide text-text-muted uppercase">Thinking</label>
                    <Select
                      id={`binding-thinking-${index}`}
                      className="min-w-0"
                      value={binding.thinking ?? ""}
                      options={thinkingOptions(levels, binding.thinking)}
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
                  </div>
                  </div>
                  <div className="flex shrink-0 justify-end pt-[18px]">
                    <Button size="icon" variant="danger" aria-label={`Remove ${binding.agent || "new"} model binding`} title="Remove binding" onClick={() => setBindings((prev) => prev.filter((_, i) => i !== index))}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
          {incomplete && bindings.length > 0 ? (
            <p className="mt-3 text-[12px] text-text-muted">Choose an agent, provider, and model for every binding before saving.</p>
          ) : null}
        </CardContent>
      </Card>

      {applying ? (
        <ApplyModelDialog
          providers={providers}
          supported={supported}
          projects={projects}
          agentCount={agents.length}
          onClose={() => setApplying(false)}
          onApplied={(stored, projectName) => {
            showStored(stored);
            setApplying(false);
            toast.success(`Bound ${agents.length} agents of ${projectName}`, "Jobs of this project started from now on use this model.");
          }}
        />
      ) : null}

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
