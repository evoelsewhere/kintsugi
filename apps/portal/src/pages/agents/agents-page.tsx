// Agents — the Agent Builder catalog (Administration → Agents, ADR-0026). Built-in agents ship
// with the release and are read-only; admins copy them or create, import and version their
// own. An agent opens on its own page (/plugins/builder/:name). Shared skills are listed below.
// Reading needs a session; changes need agents.manage.

import { Bot, Copy, Download, FileText, Plus, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/page-header";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusDot } from "@/components/ui/status-dot";
import { agentsApi, type AgentImport, type AgentSummary, type SharedSkillView } from "@/lib/api/agents";
import { useAuth } from "@/lib/auth";
import { CopyAgentDialog, SharedSkillDialog } from "./agent-dialogs";

type RemoveTarget = { kind: "agent"; name: string } | { kind: "skill"; name: string };

/** Reads an import file: a ZIP (sent as base64), a single `<name>.md`, or `{ files }` JSON. */
async function readImport(file: File): Promise<AgentImport> {
  if (file.name.endsWith(".zip")) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return { zip: btoa(binary) };
  }
  const text = await file.text();
  if (file.name.endsWith(".json")) {
    const parsed = JSON.parse(text) as { files?: Record<string, string> };
    if (parsed.files === undefined) throw new Error("The JSON file must hold { \"files\": { \"<name>.md\": \"…\" } }");
    return { files: parsed.files };
  }
  return { files: { [file.name]: text } };
}

export function AgentsPage(): React.JSX.Element {
  const { can } = useAuth();
  const manage = can("agents.manage");
  const navigate = useNavigate();
  const toast = useToast();
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [skills, setSkills] = useState<SharedSkillView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copySource, setCopySource] = useState<string | null>(null);
  const [skillDialog, setSkillDialog] = useState<{ open: boolean; skill: SharedSkillView | null }>({ open: false, skill: null });
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [allAgents, allSkills] = await Promise.all([agentsApi.list(), agentsApi.listSkills()]);
      setAgents(allAgents);
      setSkills(allSkills);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  useEffect(() => {
    // load() sets state only after awaiting the API, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const run = async (work: () => Promise<void>, failed: string): Promise<void> => {
    try {
      await work();
    } catch (failure) {
      toast.error(failed, failure);
    }
  };

  async function importFile(file: File): Promise<void> {
    await run(async () => {
      const result = await agentsApi.import(await readImport(file));
      toast.success(`${result.created ? "Imported" : "Saved a new version of"} ${result.agent.name}`, `Version ${result.agent.version}`);
      await load();
    }, `Could not import ${file.name}`);
  }

  async function remove(target: RemoveTarget): Promise<void> {
    if (target.kind === "agent") await agentsApi.remove(target.name);
    else await agentsApi.removeSkill(target.name);
    toast.success(`Deleted ${target.name}`);
    await load();
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        crumbs={["Administration", { label: "Plugins", to: "/plugins" }, "Agent Builder"]}
        title="Agents"
        description="Runtime agents run Kintsugi's understanding jobs; member agents are handed to members' harnesses. Built-in agents are read-only: copy one to change it."
      />

      {error === null ? null : <p role="alert" className="text-[13px] text-[var(--ds-status-red)]">{error}</p>}

      <Card className="overflow-hidden p-0">
        <CardHeader className="px-4 pt-3">
          <div>
            <CardTitle>Catalog</CardTitle>
            <CardDescription>Model bindings are set per agent; jobs run the current version of an enabled agent.</CardDescription>
          </div>
          {manage ? (
            <div className="flex items-center gap-1">
              <input
                ref={importInput}
                type="file"
                accept=".zip,.md,.json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file !== undefined) void importFile(file);
                }}
              />
              <Button size="small" variant="ghost" onClick={() => importInput.current?.click()}>
                <Upload className="size-4" />
                Import
              </Button>
              <Button size="small" variant="solid" onClick={() => navigate("/plugins/builder/new")}>
                <Plus className="size-4" />
                New agent
              </Button>
            </div>
          ) : null}
        </CardHeader>
        <div className="hidden grid-cols-[minmax(0,2.8fr)_0.8fr_0.7fr_1.1fr_0.9fr_auto] gap-3 px-4 py-1.5 text-[11px] tracking-wide text-text-muted uppercase sm:grid">
          <span>Agent</span>
          <span>Audience</span>
          <span>Version</span>
          <span>Model</span>
          <span>Status</span>
          <span className="w-[104px]" />
        </div>
        {agents === null ? (
          <div className="px-4 pb-3">
            <SkeletonRows rows={4} />
          </div>
        ) : null}
        {(agents ?? []).map((agent) => (
          <div
            key={agent.name}
            className="grid grid-cols-1 items-center gap-3 px-4 py-2.5 [box-shadow:0_-1px_0_rgba(0,0,0,0.06)] sm:grid-cols-[minmax(0,2.8fr)_0.8fr_0.7fr_1.1fr_0.9fr_auto]"
          >
            <Link to={`/plugins/builder/${encodeURIComponent(agent.name)}`} className="flex min-w-0 items-center gap-3 text-left">
              <Bot className="size-5 shrink-0 text-text-secondary" strokeWidth={1.5} />
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[14px] text-text hover:underline">{agent.name}</span>
                  {agent.source === "builtin" ? <span className="shrink-0"><Badge>Built-in</Badge></span> : null}
                </span>
                <span className="block truncate text-[12px] text-text-muted" title={agent.description}>
                  {agent.copiedFrom === undefined ? agent.description : `copy of ${agent.copiedFrom} · ${agent.description}`}
                </span>
              </span>
            </Link>
            <span className="text-[13px] text-text-secondary">{agent.audience}</span>
            <span className="font-mono text-[12px] text-text-secondary">{agent.version}</span>
            <span className="truncate text-[12px] text-text-secondary" title={agent.binding === undefined ? undefined : `${agent.binding.provider} / ${agent.binding.model}`}>
              {agent.audience === "member" ? "—" : agent.binding === undefined ? <span className="text-text-muted">not bound</span> : agent.binding.model}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[12px] text-text-secondary" title={agent.problems.join("\n") || undefined}>
              <StatusDot tone={agent.problems.length > 0 ? "red" : agent.enabled ? "green" : "muted"} />
              {agent.problems.length > 0 ? `${agent.problems.length} problem${agent.problems.length === 1 ? "" : "s"}` : agent.enabled ? "enabled" : "disabled"}
            </span>
            <div className="flex w-[104px] shrink-0 items-center justify-end gap-0.5">
              <Button size="icon" variant="ghost" aria-label={`Export ${agent.name}`} title="Export" onClick={() => void run(() => agentsApi.export(agent.name), `Could not export ${agent.name}`)}>
                <Download className="size-4" />
              </Button>
              {manage ? (
                <Button size="icon" variant="ghost" aria-label={`Copy ${agent.name}`} title="Copy to a custom agent" onClick={() => setCopySource(agent.name)}>
                  <Copy className="size-4" />
                </Button>
              ) : null}
              {manage && agent.source === "custom" ? (
                <Button size="icon" variant="danger" aria-label={`Delete ${agent.name}`} title="Delete" onClick={() => setRemoveTarget({ kind: "agent", name: agent.name })}>
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </Card>

      <Card className="overflow-hidden p-0">
        <CardHeader className="px-4 pt-3">
          <div>
            <CardTitle>Shared skills</CardTitle>
            <CardDescription>Agent Skills referenced by name from an agent&apos;s skills list; a change applies to every agent that uses the skill.</CardDescription>
          </div>
          {manage ? (
            <Button size="small" variant="solid" onClick={() => setSkillDialog({ open: true, skill: null })}>
              <Plus className="size-4" />
              New skill
            </Button>
          ) : null}
        </CardHeader>
        {skills.length === 0 ? (
          <CardContent>
            <p className="py-2 text-center text-[13px] text-text-secondary">No shared skills yet.</p>
          </CardContent>
        ) : (
          skills.map((skill) => (
            <div key={skill.name} className="flex items-center gap-3 px-4 py-2.5 [box-shadow:0_-1px_0_rgba(0,0,0,0.06)]">
              <FileText className="size-5 shrink-0 text-text-secondary" strokeWidth={1.5} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-[14px] text-text">
                  {skill.name}
                  {skill.source === "builtin" ? <Badge>Built-in</Badge> : null}
                </p>
                <p className="truncate text-[12px] text-text-muted">
                  {skill.description}
                  {skill.usedBy.length === 0 ? "" : ` · used by ${skill.usedBy.join(", ")}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button size="small" variant="ghost" onClick={() => navigate(`/plugins/builder/skills/${encodeURIComponent(skill.name)}`)}>
                  View{skill.files.length > 0 ? ` (${skill.files.length + 1} files)` : ""}
                </Button>
              </div>
              {manage && skill.source === "custom" ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="small" variant="ghost" onClick={() => setSkillDialog({ open: true, skill })}>
                    Edit
                  </Button>
                  <Button size="icon" variant="danger" aria-label={`Delete ${skill.name}`} onClick={() => setRemoveTarget({ kind: "skill", name: skill.name })}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </Card>

      <CopyAgentDialog
        source={copySource}
        onClose={() => setCopySource(null)}
        onCopied={async (name) => {
          toast.success(`Copied to ${name}`);
          navigate(`/plugins/builder/${encodeURIComponent(name)}`);
        }}
      />

      <SharedSkillDialog
        open={skillDialog.open}
        skill={skillDialog.skill}
        onClose={() => setSkillDialog({ open: false, skill: null })}
        onSaved={async () => {
          toast.success("Shared skill saved");
          await load();
        }}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        title={removeTarget?.kind === "skill" ? "Delete shared skill?" : "Delete agent?"}
        description={removeTarget === null ? undefined : `Delete "${removeTarget.name}"?`}
        confirmLabel="Delete"
        busyLabel="Deleting…"
        onConfirm={() => (removeTarget === null ? Promise.resolve() : remove(removeTarget))}
        onClose={() => setRemoveTarget(null)}
      >
        {removeTarget?.kind === "skill"
          ? "The skill must not be used by any agent. This cannot be undone."
          : "The agent and its whole version history are deleted. Export it first to keep a copy. Pipeline stages that name it will fail."}
      </ConfirmDialog>
    </div>
  );
}
