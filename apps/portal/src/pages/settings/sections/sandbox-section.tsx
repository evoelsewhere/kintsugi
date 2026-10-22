// Sandbox (Settings → Sandbox, ADR-0055): the environment every job runs in. A job has one workspace, kept across its
// attempts: its checkouts can be made again from the pinned commits and go first; its results cannot and stay for the
// retries of a failed job. The limits are those of the processes in it. The worker reads these settings when a job
// starts and in each sweep: a change applies to the next job, without a restart.

import { Box, Clock, HardDrive } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { type SandboxSettingsView, sandboxApi } from "@/lib/api/sandbox";
import { errorText } from "@/lib/format";
import { type SandboxForm, formProblems, isUnchanged, toForm, toSettings } from "@/lib/sandbox-form";

type NumericField = Exclude<keyof SandboxForm, "markReadOnly">;

interface FieldSpec {
  id: NumericField;
  label: string;
  hint: string;
  step?: string;
}

const WORKSPACE_FIELDS: FieldSpec[] = [
  { id: "checkoutHours", label: "Keep the checkouts of a failed job (hours)", hint: "A retry makes them again from the pinned commits, so this only saves it the time. Disk is freed after it." },
  { id: "retentionDays", label: "Keep the results of a failed job (days)", hint: "Its results and what its steps wrote stay for a retry, an inspection or a new document write; then the workspace is removed." },
];

const LIMIT_FIELDS: FieldSpec[] = [
  { id: "scriptTimeoutMin", label: "Script timeout (minutes)", hint: "A script step that runs longer is killed with its processes.", step: "any" },
  { id: "agentTimeoutMin", label: "Agent job timeout (minutes)", hint: "0 = no limit. A stalled provider is still caught by the idle limit.", step: "any" },
  { id: "agentIdleTimeoutMin", label: "Agent idle limit (minutes)", hint: "No sign of life from the model for this long and the job is stopped as stalled and tried once more. 0 turns it off.", step: "any" },
  { id: "maxOutputMib", label: "Output limit (MB)", hint: "What a step may write to its output folder; a script that exceeds it is killed.", step: "any" },
  { id: "maxTurns", label: "Turns per agent job", hint: "0 = no limit." },
  { id: "maxCostUsd", label: "Cost per agent job (USD)", hint: "0 = no limit.", step: "any" },
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
      toast.success("Sandbox settings saved", "The next job and the next sweep use them.");
    } catch (error) {
      toast.error("Could not save the sandbox settings", error);
    } finally {
      setBusy(false);
    }
  }

  const input = (spec: FieldSpec): React.JSX.Element => (
    <Field key={spec.id} label={spec.label} hint={spec.hint} htmlFor={`sandbox-${spec.id}`}>
      <Input
        id={`sandbox-${spec.id}`}
        type="number"
        inputMode="decimal"
        min={0}
        {...(spec.step === undefined ? {} : { step: spec.step })}
        value={form?.[spec.id] ?? ""}
        disabled={form === null}
        onChange={(event) => setForm((current) => (current === null ? current : { ...current, [spec.id]: event.target.value }))}
      />
    </Field>
  );

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h2 className="flex items-center gap-2 text-[16px] font-semibold text-text">
          <Box className="size-4 text-text-secondary" strokeWidth={1.5} />
          Sandbox
        </h2>
        <p className="mt-1 text-[13px] text-text-secondary">
          The environment every job runs in: one workspace per job, kept across its attempts, with the old and the new code read-only inside it. Nothing here weakens the isolation: agents are confined to their workspace by the kernel
          whatever these settings say.
        </p>
      </div>

      <Card className="overflow-hidden p-0">
        <CardHeader className="px-4 pt-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock className="size-4 text-text-secondary" strokeWidth={1.5} />
              Workspaces
            </CardTitle>
            <CardDescription>How long a failed job keeps what it can be retried from.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 px-4 pb-4 sm:grid-cols-2">{WORKSPACE_FIELDS.map(input)}</CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <CardHeader className="px-4 pt-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="size-4 text-text-secondary" strokeWidth={1.5} />
              Processes and files
            </CardTitle>
            <CardDescription>The limits of the scripts and agent jobs that run in a workspace, and how its files are protected.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-4 pb-4">
          <div className="grid gap-3 sm:grid-cols-2">{LIMIT_FIELDS.map(input)}</div>
          <div className="flex flex-col gap-1">
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
        </CardContent>
      </Card>

      {problems.length > 0 && changed ? (
        <ul className="list-disc pl-5 text-[12px] text-[var(--ds-status-red)]">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
      {loadError === null ? null : (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--ds-status-red)]">
          Could not load the sandbox settings: {loadError}
          <Button size="small" variant="ghost" onClick={() => void load()}>
            Retry
          </Button>
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] text-text-muted">
          {stored === null
            ? loadError !== null
              ? "Not loaded."
              : "Loading…"
            : stored.isDefault
              ? "Default settings (not set yet)."
              : `Set by ${stored.updatedBy ?? "an admin"}${stored.updatedAt === undefined ? "" : ` on ${new Date(stored.updatedAt).toLocaleString()}`}.`}
        </p>
        <Button size="small" variant="solid" disabled={busy || !changed || problems.length > 0} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
