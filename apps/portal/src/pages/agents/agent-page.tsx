// Agent page (Administration → Plugins → Agent Builder → /plugins/builder/:name, /plugins/builder/new; ADR-0026): the frontmatter
// as a form, the instructions, agent-local skills, live validation against the installation
// (kernel tools, shared skills), the job definition a runtime agent produces, version history
// with restore, and the agent's model binding. Built-in agents open read-only, with "Copy to
// edit".

import { THINKING_LEVELS, type ThinkingLevel } from "@kintsugi/domain";
import { ArrowLeft, Copy, Download, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { PageHeading } from "@/components/page-heading";
import { useToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, type SelectOption } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  type AgentBuilderContext,
  type AgentDefinition,
  type AgentDetail,
  type AgentDraft,
  agentsApi,
  type AgentVersionView,
  type SkillPackage,
} from "@/lib/api/agents";
import { type AgentModelBindingInput, providersApi, type ProviderView, type SupportedProviders } from "@/lib/api/providers";
import { useAuth } from "@/lib/auth";
import { modelOptions } from "@/lib/model-options";
import { cn } from "@/lib/utils";
import { CopyAgentDialog } from "./agent-dialogs";

type EditorTarget = { mode: "create" } | { mode: "open"; name: string };

type Tab = "agent" | "skills" | "history" | "preview";

const THINKING_OPTIONS: SelectOption[] = [{ value: "", label: "Default" }, ...THINKING_LEVELS.map((level) => ({ value: level, label: level }))];
const AUDIENCE_OPTIONS: SelectOption[] = [
  { value: "runtime", label: "runtime", hint: "runs in Kintsugi jobs" },
  { value: "member", label: "member", hint: "runs in members' harnesses" },
];

const BLANK: AgentDraft = {
  name: "",
  audience: "runtime",
  version: "1.0.0",
  description: "",
  tools: ["read", "ls", "grep", "find", "outputs_write"],
  skills: [],
  instructions: "",
  localSkills: [],
};

const errorText = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

/** The next patch version: a save always records a new version. */
function nextVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match === null ? version : `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function draftOf(detail: AgentDetail): AgentDraft {
  const manifest = detail.manifest;
  if (manifest === undefined) return { ...BLANK, name: detail.name, audience: detail.audience, version: nextVersion(detail.version) };
  return {
    name: manifest.name,
    audience: manifest.audience,
    version: detail.source === "custom" ? nextVersion(manifest.version) : manifest.version,
    description: manifest.description,
    tools: manifest.tools,
    skills: manifest.skills,
    ...(manifest.thinking === undefined ? {} : { thinking: manifest.thinking }),
    ...(manifest.denyCommandPatterns === undefined ? {} : { denyCommandPatterns: manifest.denyCommandPatterns }),
    ...(manifest.metadata === undefined ? {} : { metadata: manifest.metadata }),
    instructions: detail.instructions,
    localSkills: detail.localSkills.map((skill) => ({ name: skill.name, description: skill.description, content: skill.content })),
  };
}

export function AgentPage(): React.JSX.Element {
  const { name } = useParams();
  const { can } = useAuth();
  const target: EditorTarget = name === undefined || name === "new" ? { mode: "create" } : { mode: "open", name };
  // Keyed: every agent opened starts with fresh state.
  return <AgentEditor key={target.mode === "create" ? "new" : target.name} target={target} manage={can("agents.manage")} />;
}

function AgentEditor({ target, manage }: { target: EditorTarget; manage: boolean }): React.JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const [copySource, setCopySource] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(target.mode === "open" ? target.name : null);
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [context, setContext] = useState<AgentBuilderContext | null>(null);
  const [draft, setDraft] = useState<AgentDraft>(BLANK);
  const [problems, setProblems] = useState<string[]>([]);
  const [definition, setDefinition] = useState<AgentDefinition | null>(null);
  const [versions, setVersions] = useState<AgentVersionView[]>([]);
  const [tab, setTab] = useState<Tab>("agent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);

  const readOnly = !manage || detail?.source === "builtin";
  const editing = name !== null && detail?.source === "custom";

  async function load(agentName: string | null): Promise<void> {
    try {
      const nextContext = await agentsApi.context();
      setContext(nextContext);
      if (agentName === null) return;
      const loaded = await agentsApi.get(agentName);
      setDetail(loaded);
      setDraft(draftOf(loaded));
      setProblems(loaded.problems);
      if (loaded.source === "custom") setVersions(await agentsApi.versions(agentName));
      if (loaded.audience === "runtime" && loaded.problems.length === 0 && (loaded.source === "builtin" || !manage)) {
        setDefinition(await agentsApi.definition(agentName).catch(() => null));
      }
    } catch (failure) {
      setError(errorText(failure));
    }
  }

  useEffect(() => {
    // load() sets state only after awaiting the API, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(target.mode === "open" ? target.name : null);
    // Loaded once per editor instance (the dialog is keyed by agent).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live validation of the draft: the same checks as saving, and the job definition it yields.
  useEffect(() => {
    if (readOnly || context === null) return;
    const timer = setTimeout(() => {
      agentsApi
        .preview(draft)
        .then((preview) => {
          setProblems(preview.problems);
          setDefinition(preview.definition ?? null);
        })
        .catch((failure: unknown) => setProblems([errorText(failure)]));
    }, 400);
    return () => clearTimeout(timer);
  }, [draft, readOnly, context]);

  const update = (patch: Partial<AgentDraft>): void => setDraft((prev) => ({ ...prev, ...patch }));

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const created = name === null;
      const saved = created ? await agentsApi.create(draft) : await agentsApi.update(name, draft);
      toast.success(`${created ? "Created" : "Saved"} ${saved.name}`, `Version ${saved.version} is now current.`);
      if (created) {
        navigate(`/plugins/builder/${encodeURIComponent(saved.name)}`, { replace: true });
        return;
      }
      setName(saved.name);
      setDetail(saved);
      setDraft(draftOf(saved));
      setVersions(await agentsApi.versions(saved.name));
    } catch (failure) {
      setError(errorText(failure));
      toast.error("Could not save the agent", failure);
    } finally {
      setBusy(false);
    }
  }

  async function restore(version: string): Promise<void> {
    if (name === null) return;
    const restored = await agentsApi.restore(name, version);
    setDetail(restored);
    setDraft(draftOf(restored));
    setVersions(await agentsApi.versions(name));
    toast.success(`Restored ${version}`, "It is the current version again.");
  }

  async function toggleEnabled(enabled: boolean): Promise<void> {
    if (name === null) return;
    try {
      setDetail(await agentsApi.setEnabled(name, enabled));
      toast.success(`${name} ${enabled ? "enabled" : "disabled"}`);
    } catch (failure) {
      toast.error(`Could not ${enabled ? "enable" : "disable"} ${name}`, failure);
    }
  }

  const title = name === null ? "New agent" : name;
  const tabs: { id: Tab; label: string }[] = [
    { id: "agent", label: "Agent" },
    { id: "skills", label: `Local skills (${draft.localSkills.length})` },
    ...(editing ? [{ id: "history" as const, label: `History (${versions.length})` }] : []),
    { id: "preview", label: "Job definition" },
  ];

  const description =
    detail === null
      ? "A Claude Code style agent file with optional agent-local skills."
      : `${detail.source === "builtin" ? "Built-in, read-only" : "Custom"} · ${detail.audience} agent · current version ${detail.version}`;

  return (
    <div className="flex flex-col gap-5">
      <Breadcrumbs items={["Administration", "Plugins", "Agent Builder", title]} />
      <Link to="/plugins/builder" className="inline-flex w-fit items-center gap-1.5 text-[12px] text-text-secondary hover:text-text">
        <ArrowLeft className="size-3.5" />
        All agents
      </Link>
      <PageHeading
        title={title}
        description={description}
        actions={
          <>
            {name !== null ? (
              <Button size="small" variant="ghost" onClick={() => void agentsApi.export(name).catch((failure: unknown) => toast.error(`Could not export ${name}`, failure))}>
                <Download className="size-4" />
                Export
              </Button>
            ) : null}
            {manage && name !== null ? (
              <Button size="small" variant="ghost" onClick={() => setCopySource(name)}>
                <Copy className="size-4" />
                {detail?.source === "builtin" ? "Copy to edit" : "Copy"}
              </Button>
            ) : null}
            {readOnly ? null : (
              <Button size="small" variant="solid" disabled={busy || problems.length > 0 || draft.name === ""} onClick={() => void save()}>
                {busy ? "Saving…" : name === null ? "Create agent" : `Save as ${draft.version}`}
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-col gap-4">
        {error === null ? null : <p role="alert" className="text-[13px] text-[var(--ds-status-red)]">{error}</p>}
        <ProblemList problems={problems} />

        {editing && detail !== null ? (
          <div className="flex flex-wrap items-center gap-3 text-[13px] text-text-secondary">
            <Checkbox checked={detail.enabled} label="Enabled (jobs may run it)" onChange={(enabled) => void toggleEnabled(enabled)} />
            {detail.copiedFrom === undefined ? null : <Badge>copy of {detail.copiedFrom}</Badge>}
            {detail.updatedBy === undefined ? null : <span className="text-text-muted">last saved by {detail.updatedBy}</span>}
          </div>
        ) : null}

        <div role="tablist" className="flex gap-1 [box-shadow:0_1px_0_0_rgba(0,0,0,0.08)]">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={cn("-mb-px px-2.5 py-1.5 text-[13px] text-text-secondary hover:text-text", tab === entry.id && "font-medium text-text [box-shadow:0_-2px_0_0_var(--color-text)_inset]")}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {tab === "agent" ? (
          <AgentForm draft={draft} context={context} readOnly={readOnly} nameLocked={name !== null} update={update} />
        ) : null}
        {tab === "agent" && name !== null && detail !== null && detail.audience === "runtime" ? <ModelBinding agent={name} detail={detail} onSaved={() => load(name)} /> : null}
        {tab === "skills" ? <LocalSkills skills={draft.localSkills} readOnly={readOnly} onChange={(localSkills) => update({ localSkills })} /> : null}
        {tab === "history" && name !== null ? (
          <History
            versions={versions}
            onExport={(version) => void agentsApi.export(name, version).catch((failure: unknown) => setError(errorText(failure)))}
            onRestore={manage ? setRestoreTarget : undefined}
          />
        ) : null}
        {tab === "preview" ? <DefinitionPreview audience={draft.audience} definition={definition} problems={problems} /> : null}
      </div>

      <ConfirmDialog
        open={restoreTarget !== null}
        title="Restore version?"
        description={restoreTarget === null ? undefined : `Make ${restoreTarget} the current version of ${name ?? ""}?`}
        confirmLabel="Restore"
        confirmVariant="solid"
        onConfirm={() => (restoreTarget === null ? Promise.resolve() : restore(restoreTarget))}
        onClose={() => setRestoreTarget(null)}
      >
        Jobs started from now on run the restored version. The history keeps every version.
      </ConfirmDialog>

      <CopyAgentDialog
        source={copySource}
        onClose={() => setCopySource(null)}
        onCopied={async (copied) => {
          toast.success(`Copied to ${copied}`);
          navigate(`/plugins/builder/${encodeURIComponent(copied)}`);
        }}
      />
    </div>
  );
}

function ProblemList({ problems }: { problems: string[] }): React.JSX.Element | null {
  if (problems.length === 0) return null;
  return (
    <div role="status" className="rounded-[var(--geist-radius)] px-3 py-2 shadow-border">
      <p className="text-[13px] font-medium text-[var(--ds-status-red)]">
        {problems.length} problem{problems.length === 1 ? "" : "s"} to fix before saving
      </p>
      <ul className="mt-1 list-disc pl-5 text-[12px] leading-5 text-text-secondary">
        {problems.map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
      </ul>
    </div>
  );
}

interface AgentFormProps {
  draft: AgentDraft;
  context: AgentBuilderContext | null;
  readOnly: boolean;
  nameLocked: boolean;
  update: (patch: Partial<AgentDraft>) => void;
}

function AgentForm({ draft, context, readOnly, nameLocked, update }: AgentFormProps): React.JSX.Element {
  const toggle = (list: string[], value: string, on: boolean): string[] => (on ? [...list, value] : list.filter((entry) => entry !== value));
  // Tools the draft lists that the kernel does not offer stay visible, so they can be removed.
  const toolChoices = [...(context?.kernelTools ?? []), ...draft.tools.filter((tool) => !(context?.kernelTools ?? []).includes(tool))];
  const skillChoices = [...(context?.sharedSkills.map((skill) => skill.name) ?? []), ...draft.skills.filter((skill) => !(context?.sharedSkills ?? []).some((entry) => entry.name === skill))];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <Field label="Name" hint="Lowercase kebab-case; cannot change after creation.">
          <Input value={draft.name} disabled={readOnly || nameLocked} onChange={(event) => update({ name: event.target.value })} />
        </Field>
        <Field label="Version" hint="Semantic version; each save is a new one.">
          <Input value={draft.version} disabled={readOnly} onChange={(event) => update({ version: event.target.value })} />
        </Field>
        <Field label="Audience">
          <Select
            value={draft.audience}
            options={AUDIENCE_OPTIONS}
            disabled={readOnly}
            onChange={(value) => update({ audience: value as AgentDraft["audience"], tools: value === "runtime" ? draft.tools.filter((tool) => context?.kernelTools.includes(tool) ?? true) : draft.tools })}
          />
        </Field>
      </div>
      <Field label="Description" hint="What the agent does and when to use it.">
        <Input value={draft.description} disabled={readOnly} onChange={(event) => update({ description: event.target.value })} />
      </Field>

      {draft.audience === "runtime" ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[14px] text-text">Tools</span>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {toolChoices.map((tool) => (
              <Checkbox key={tool} checked={draft.tools.includes(tool)} disabled={readOnly} label={tool} onChange={(on) => update({ tools: toggle(draft.tools, tool, on) })} />
            ))}
          </div>
          <span className="text-[12px] text-text-muted">Kernel tools only. Read tools are confined to the read-only workspace; outputs_write writes to the job&apos;s output.</span>
        </div>
      ) : (
        <Field label="Tools" hint="Harness tool names, comma-separated (e.g. Read, Write, Bash).">
          <Input
            value={draft.tools.join(", ")}
            disabled={readOnly}
            onChange={(event) => update({ tools: event.target.value.split(",").map((tool) => tool.trim()).filter((tool) => tool !== "") })}
          />
        </Field>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-[14px] text-text">Shared skills</span>
        {skillChoices.length === 0 ? (
          <span className="text-[12px] text-text-muted">No shared skills on this installation yet.</span>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {skillChoices.map((skill) => (
              <Checkbox key={skill} checked={draft.skills.includes(skill)} disabled={readOnly} label={skill} onChange={(on) => update({ skills: toggle(draft.skills, skill, on) })} />
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr]">
        <Field label="Thinking" hint="Default level; a model binding can override it.">
          <Select
            value={draft.thinking ?? ""}
            options={THINKING_OPTIONS}
            disabled={readOnly}
            onChange={(value) => update({ thinking: value === "" ? undefined : (value as ThinkingLevel) })}
          />
        </Field>
        <Field label="Deny command patterns" hint="Regular expressions, one per line; matching tool commands are blocked.">
          <Textarea
            mono
            rows={2}
            value={(draft.denyCommandPatterns ?? []).join("\n")}
            disabled={readOnly}
            onChange={(event) => update({ denyCommandPatterns: event.target.value.split("\n").filter((line) => line.trim() !== "") })}
          />
        </Field>
      </div>

      <Field label="Instructions" hint="The system prompt, used verbatim.">
        <Textarea mono rows={18} value={draft.instructions} disabled={readOnly} onChange={(event) => update({ instructions: event.target.value })} />
      </Field>
    </div>
  );
}

function LocalSkills({ skills, readOnly, onChange }: { skills: SkillPackage[]; readOnly: boolean; onChange: (skills: SkillPackage[]) => void }): React.JSX.Element {
  const set = (index: number, patch: Partial<SkillPackage>): void => onChange(skills.map((skill, i) => (i === index ? { ...skill, ...patch } : skill)));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-text-muted">Skills packaged with this agent only (skills/&lt;name&gt;/SKILL.md). They are appended to the system prompt after the shared skills.</p>
      {skills.length === 0 ? <p className="text-[13px] text-text-secondary">No local skills.</p> : null}
      {skills.map((skill, index) => (
        <div key={index} className="flex flex-col gap-2 rounded-[var(--geist-radius)] p-3 shadow-border">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <Input aria-label="Skill name" placeholder="skill-name" value={skill.name} disabled={readOnly} onChange={(event) => set(index, { name: event.target.value })} />
            <Input aria-label="Skill description" placeholder="When to use it" value={skill.description} disabled={readOnly} onChange={(event) => set(index, { description: event.target.value })} />
            {readOnly ? null : (
              <Button size="icon" variant="danger" aria-label={`Remove ${skill.name}`} onClick={() => onChange(skills.filter((_, i) => i !== index))}>
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
          <Textarea mono rows={6} aria-label="Skill instructions" value={skill.content} disabled={readOnly} onChange={(event) => set(index, { content: event.target.value })} />
        </div>
      ))}
      {readOnly ? null : (
        <div>
          <Button size="small" variant="ghost" onClick={() => onChange([...skills, { name: "", description: "", content: "" }])}>
            <Plus className="size-4" />
            Add skill
          </Button>
        </div>
      )}
    </div>
  );
}

function History({ versions, onExport, onRestore }: { versions: AgentVersionView[]; onExport: (version: string) => void; onRestore: ((version: string) => void) | undefined }): React.JSX.Element {
  return (
    <div className="flex flex-col">
      {versions.map((version) => (
        <div key={version.version} className="flex items-center gap-3 py-2 [box-shadow:0_-1px_0_rgba(0,0,0,0.06)]">
          <span className="font-mono text-[13px] text-text">{version.version}</span>
          {version.current ? <Badge>current</Badge> : null}
          <span className="flex-1 truncate text-[12px] text-text-muted">
            {new Date(version.createdAt).toLocaleString()}
            {version.createdBy === undefined ? "" : ` · ${version.createdBy}`}
          </span>
          <Button size="icon" variant="ghost" aria-label={`Export ${version.version}`} title="Export this version" onClick={() => onExport(version.version)}>
            <Download className="size-4" />
          </Button>
          {onRestore === undefined || version.current ? null : (
            <Button size="small" variant="ghost" onClick={() => onRestore(version.version)}>
              <RotateCcw className="size-4" />
              Restore
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

function DefinitionPreview({ audience, definition, problems }: { audience: AgentDraft["audience"]; definition: AgentDefinition | null; problems: string[] }): React.JSX.Element {
  if (audience === "member") return <p className="text-[13px] text-text-secondary">Member agents run in members&apos; harnesses; the Kintsugi runtime never builds a job definition for them.</p>;
  if (definition === null) {
    return <p className="text-[13px] text-text-secondary">{problems.length > 0 ? "Fix the problems above to see the job definition." : "Validating…"}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] text-text-muted">The AgentDefinition a job embeds (dry run): shared skills first, then local skills.</p>
      <pre className="max-h-[50vh] overflow-auto rounded-[var(--geist-radius)] bg-recessed p-3 font-mono text-[12px] leading-5 whitespace-pre-wrap text-text">{JSON.stringify(definition, null, 2)}</pre>
    </div>
  );
}

function ModelBinding({ agent, detail, onSaved }: { agent: string; detail: AgentDetail; onSaved: () => Promise<void> }): React.JSX.Element {
  const { can } = useAuth();
  const allowed = can("providers.manage");
  const toast = useToast();
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [supported, setSupported] = useState<SupportedProviders | undefined>(undefined);
  const [all, setAll] = useState<AgentModelBindingInput[]>([]);
  const [provider, setProvider] = useState(detail.binding?.provider ?? "");
  const [model, setModel] = useState(detail.binding?.model ?? "");
  const [thinking, setThinking] = useState<string>(detail.binding?.thinking ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    Promise.all([providersApi.list(), providersApi.listBindings(), providersApi.supported()])
      .then(([list, bindings, catalog]) => {
        setProviders(list);
        setAll(bindings);
        setSupported(catalog);
      })
      .catch((failure: unknown) => setError(errorText(failure)));
  }, [allowed]);

  async function save(remove: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const others = all.filter((binding) => !(binding.agent === agent && binding.projectId === undefined));
      const next = remove ? others : [...others, { agent, provider, model: model.trim(), ...(thinking === "" ? {} : { thinking: thinking as ThinkingLevel }) }];
      setAll(await providersApi.replaceBindings(next));
      toast.success(remove ? `Model binding of ${agent} cleared` : `Model binding of ${agent} saved`, remove ? "Jobs use the installation default." : `${provider} / ${model.trim()}`);
      await onSaved();
    } catch (failure) {
      setError(errorText(failure));
      toast.error("Could not save the model binding", failure);
    } finally {
      setBusy(false);
    }
  }

  const perProject = detail.bindings.filter((binding) => binding.projectId !== undefined);
  return (
    <div className="flex flex-col gap-2 rounded-[var(--geist-radius)] p-3 shadow-border">
      <span className="text-[14px] text-text">Model binding</span>
      {!allowed ? (
        <p className="text-[13px] text-text-secondary">
          {detail.binding === undefined ? "No installation-default model is bound." : `${detail.binding.provider} / ${detail.binding.model}${detail.binding.thinking === undefined ? "" : ` · thinking ${detail.binding.thinking}`}`}
          <span className="text-text-muted"> · bindings are managed with providers.manage</span>
        </p>
      ) : (
        <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_1fr_0.8fr_auto_auto]">
          <Select
            value={provider}
            placeholder="Provider"
            options={providers.map((entry) => ({ value: entry.id, label: entry.id, ...(entry.enabled ? {} : { hint: "disabled" }) }))}
            onChange={(value) => {
              setProvider(value);
              setModel("");
            }}
          />
          <Select value={model} placeholder="Model" options={modelOptions(providers.find((entry) => entry.id === provider), supported, model)} disabled={provider === ""} onChange={setModel} />
          <Select value={thinking} options={THINKING_OPTIONS} onChange={setThinking} />
          <Button size="small" variant="solid" disabled={busy || provider === "" || model.trim() === ""} onClick={() => void save(false)}>
            Save binding
          </Button>
          <Button size="small" variant="ghost" disabled={busy || detail.binding === undefined} onClick={() => void save(true)}>
            Clear
          </Button>
        </div>
      )}
      {perProject.length === 0 ? null : (
        <p className="text-[12px] text-text-muted">Per project: {perProject.map((binding) => `${binding.projectId}: ${binding.provider} / ${binding.model}`).join(" · ")}</p>
      )}
      {error === null ? null : <p role="alert" className="text-[13px] text-[var(--ds-status-red)]">{error}</p>}
    </div>
  );
}
