// Sandbox & Agent (Settings → Sandbox & Agent, ADR-0055): how jobs run and the environment they run in. How many jobs a
// worker runs at once; the limits of the agent jobs and of the scripts in a workspace; and how long a failed job keeps what
// it can be retried from. A job has one workspace, kept across its attempts: its checkouts can be made again from the
// pinned commits and go first; its results cannot and stay for the retries of a failed job. The worker reads these
// settings when a job starts and in each sweep (the concurrency within seconds): a change applies without a restart.

import { Bot, Gauge, HardDrive, Layers, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { type SandboxSettingsView, sandboxApi } from "@/lib/api/sandbox";
import { errorText } from "@/lib/format";
import { type SandboxForm, type SandboxNumberField, defaultLabel, defaultValue, formProblems, isUnchanged, toForm, toSettings } from "@/lib/sandbox-form";

interface FieldSpec {
  id: SandboxNumberField;
  label: string;
  /** What the number counts, shown beside the input. */
  unit: string;
  hint: string;
  /** What 0 means, for a field where 0 turns the limit off. */
  zero?: string;
  step?: string;
  min?: number;
}

interface GroupSpec {
  id: "execution" | "agent" | "files" | "retention";
  title: string;
  description: string;
  icon: LucideIcon;
  fields: FieldSpec[];
}

const GROUPS: GroupSpec[] = [
  {
    id: "execution",
    title: "Job execution",
    description: "How many jobs a worker runs side by side. The others wait in the queue, oldest first.",
    icon: Layers,
    fields: [
      {
        id: "maxJobConcurrency",
        label: "Max job concurrency",
        unit: "jobs",
        min: 1,
        hint: "Runs in parallel per worker, 1 to 32. A change reaches the running worker within seconds; runs already started keep going. Every run is an agent process, so raise it only as far as the provider limits and the machine allow.",
      },
    ],
  },
  {
    id: "agent",
    title: "Agent limits",
    description: "What one agent job may use before it is stopped. 0 means no limit.",
    icon: Bot,
    fields: [
      { id: "agentTimeoutMin", label: "Job timeout", unit: "min", zero: "no limit", hint: "A stalled provider is still caught by the idle limit.", step: "any" },
      { id: "agentIdleTimeoutMin", label: "Idle limit", unit: "min", zero: "off", hint: "No sign of life from the model for this long and the job is stopped as stalled and tried once more. 0 turns it off.", step: "any" },
      { id: "maxTurns", label: "Turns per job", unit: "turns", zero: "no limit", hint: "Assistant turns before the job is stopped." },
      { id: "maxCostUsd", label: "Cost per job", unit: "USD", zero: "no limit", hint: "Spend before the job is stopped.", step: "any" },
    ],
  },
  {
    id: "files",
    title: "Scripts and files",
    description: "The limits of the processes in a workspace and how its files are protected.",
    icon: HardDrive,
    fields: [
      { id: "scriptTimeoutMin", label: "Script timeout", unit: "min", hint: "A script step that runs longer is killed with its processes.", step: "any" },
      { id: "maxOutputMib", label: "Output limit", unit: "MB", hint: "What a step may write to its output folder; a script that exceeds it is killed.", step: "any" },
    ],
  },
  {
    id: "retention",
    title: "Workspace retention",
    description: "How long a failed job keeps what it can be retried from.",
    icon: Gauge,
    fields: [
      { id: "checkoutHours", label: "Keep checkouts", unit: "hours", min: 1, hint: "A retry makes them again from the pinned commits, so this only saves it the time. Disk is freed after it." },
      { id: "retentionDays", label: "Keep results", unit: "days", min: 1, hint: "Its results and what its steps wrote stay for a retry, an inspection or a new document write; then the workspace is removed." },
    ],
  },
];

export function SandboxSection(): React.JSX.Element {
  const [stored, setStored] = useState<SandboxSettingsView | null>(null);
  const [form, setForm] = useState<SandboxForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async (): Promise<void> => {
    try {
      const settings = await sandboxApi.get();
      setStored(settings);
      setForm(toForm(settings));
      setLoadError(null);
    } catch (error) {
      setLoadError(errorText(error));
    }
  }, []);

  useEffect(() => {
    // load() sets state only after awaiting the API, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const problems = form === null ? [] : formProblems(form);
  const changed = form !== null && stored !== null && !isUnchanged(form, stored);

  async function save(): Promise<void> {
    const settings = form === null ? undefined : toSettings(form);
    if (settings === undefined) return;
    setBusy(true);
    try {
      const saved = await sandboxApi.save(settings);
      setStored(saved);
      setForm(toForm(saved));
      toast.success("Sandbox & Agent settings saved", "The next job and the next sweep use them.");
    } catch (error) {
      toast.error("Could not save the settings", error);
    } finally {
      setBusy(false);
    }
  }

  const row = (spec: FieldSpec): React.JSX.Element => (
    <div key={spec.id} className="grid items-start gap-x-6 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
      <div className="min-w-0">
        <label htmlFor={`sandbox-${spec.id}`} className="text-[13px] font-medium text-text">
          {spec.label}
        </label>
        <p className="mt-0.5 text-[12px] text-text-muted">{spec.hint}</p>
        <p className="mt-0.5 text-[12px] text-text-muted">Default: {defaultLabel(spec.id, spec.unit, spec.zero)}.</p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          id={`sandbox-${spec.id}`}
          type="number"
          inputMode="decimal"
          min={spec.min ?? 0}
          {...(spec.step === undefined ? {} : { step: spec.step })}
          placeholder={defaultValue(spec.id)}
          value={form?.[spec.id] ?? ""}
          disabled={form === null}
          onChange={(event) => setForm((current) => (current === null ? current : { ...current, [spec.id]: event.target.value }))}
        />
        <span className="w-10 shrink-0 text-[12px] text-text-muted">{spec.unit}</span>
      </div>
    </div>
  );

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h2 className="text-[16px] font-semibold text-text">Sandbox &amp; Agent</h2>
        <p className="mt-1 text-[13px] text-text-secondary">
          How jobs run and the environment they run in: one workspace per job, kept across its attempts, with the old and the new code read-only inside it. Nothing here weakens the isolation: agents are confined to their workspace by the
          kernel whatever these settings say.
        </p>
      </div>

      {GROUPS.map((group) => {
        const Icon = group.icon;
        return (
          <Card key={group.id} className="overflow-hidden p-0">
            <CardHeader className="px-4 pt-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Icon className="size-4 text-text-secondary" strokeWidth={1.5} />
                  {group.title}
                </CardTitle>
                <CardDescription>{group.description}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col divide-y divide-[rgba(0,0,0,0.08)] p-0 pb-1 dark:divide-[rgba(255,255,255,0.12)]">
              {group.fields.map(row)}
              {group.id === "files" ? (
                <div className="flex flex-col gap-1 px-4 py-3">
                  <Checkbox
                    id="sandbox-mark-read-only"
                    label="Mark checkouts and inputs read-only on disk"
                    checked={form?.markReadOnly ?? true}
                    disabled={form === null}
                    onChange={(checked) => setForm((current) => (current === null ? current : { ...current, markReadOnly: checked }))}
                  />
                  <p className="pl-6 text-[12px] text-text-muted">
                    A second line of defence beside the kernel&apos;s path guard. Switch it off on a file system where changing the permissions of thousands of files is slow: the old and the new code are still read-only for agents.
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}

      {problems.length > 0 && changed ? (
        <ul className="list-disc pl-5 text-[12px] text-[var(--ds-status-red)]">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
      {loadError === null ? null : (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--ds-status-red)]">
          Could not load the settings: {loadError}
          <Button size="small" variant="ghost" onClick={() => void load()}>
            Retry
          </Button>
        </p>
      )}
      {/* Full-bleed over the scroll area's padding and above the cards, so no heading shows through or beside it. */}
      <div className="sticky bottom-0 z-10 -mx-6 -mb-5 mt-2 flex items-center justify-between gap-2 bg-surface px-6 py-3 [box-shadow:0_-1px_0_0_rgba(0,0,0,0.08)] dark:[box-shadow:0_-1px_0_0_rgba(255,255,255,0.12)]">
        <p className="text-[12px] text-text-muted">
          {stored === null
            ? loadError !== null
              ? "Not loaded."
              : "Loading…"
            : stored.isDefault
              ? "Nothing saved yet: the defaults shown under each field apply."
              : `Set by ${stored.updatedBy ?? "an admin"}${stored.updatedAt === undefined ? "" : ` on ${new Date(stored.updatedAt).toLocaleString()}`}.`}
        </p>
        <Button size="small" variant="solid" disabled={busy || !changed || problems.length > 0} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
