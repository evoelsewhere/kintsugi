// Telemetry export (Settings → Telemetry export, ADR-0074): besides the portal, the worker can send the spans of every job
// run to an OpenTelemetry backend over OTLP/HTTP. Off by default. The spans carry counts, sizes and names, never prompts
// or tool output. The headers (an API key) are write-only: once saved, only their names are shown.

import { Radio } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { type TelemetryExportView, telemetryExportApi } from "@/lib/api/telemetry-export";
import { errorText } from "@/lib/format";
import { type TelemetryExportForm, formProblems, isUnchanged, toForm, toInput } from "@/lib/telemetry-export-form";

export function TelemetryExportSection(): React.JSX.Element {
  const [stored, setStored] = useState<TelemetryExportView | null>(null);
  const [form, setForm] = useState<TelemetryExportForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async (): Promise<void> => {
    try {
      const view = await telemetryExportApi.get();
      setStored(view);
      setForm(toForm(view));
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
  const update = (patch: Partial<TelemetryExportForm>): void => setForm((current) => (current === null ? current : { ...current, ...patch }));

  async function save(): Promise<void> {
    const input = form === null ? undefined : toInput(form);
    if (input === undefined) return;
    setBusy(true);
    try {
      const saved = await telemetryExportApi.save(input);
      setStored(saved);
      setForm(toForm(saved));
      toast.success("Telemetry export saved", saved.enabled ? "The next spans are sent to the endpoint." : "Export is off.");
    } catch (error) {
      toast.error("Could not save the telemetry export", error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h2 className="flex items-center gap-2 text-[16px] font-semibold text-text">
          <Radio className="size-4 text-text-secondary" strokeWidth={1.5} />
          Telemetry export
        </h2>
        <p className="mt-1 text-[13px] text-text-secondary">
          Governance → Telemetry always shows the spans of the jobs. Here the worker can also send them to an OpenTelemetry backend (a collector, Tempo, Langfuse) over OTLP/HTTP, one trace per run. Spans carry counts, sizes and names, never prompts or
          tool output. A slow or unreachable backend never fails a job.
        </p>
      </div>

      <Card className="overflow-hidden p-0">
        <CardHeader className="px-4 pt-3">
          <div>
            <CardTitle>OTLP endpoint</CardTitle>
            <CardDescription>Off until you turn it on. The worker applies a change to the next batch of spans, without a restart.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-4 pb-4">
          <Checkbox id="telemetry-export-enabled" label="Send job spans to the endpoint" checked={form?.enabled ?? false} disabled={form === null} onChange={(checked) => update({ enabled: checked })} />
          <Field label="Endpoint" hint="The collector's base URL (https://collector:4318) or the backend's full traces URL (…/v1/traces). Credentials go in a header, not in the URL." htmlFor="telemetry-export-endpoint">
            <Input id="telemetry-export-endpoint" type="url" placeholder="https://collector.example.com:4318" value={form?.endpoint ?? ""} disabled={form === null} onChange={(event) => update({ endpoint: event.target.value })} />
          </Field>
          <Field label="Service name" hint="Shown as service.name on every span." htmlFor="telemetry-export-service">
            <Input id="telemetry-export-service" value={form?.serviceName ?? ""} disabled={form === null} onChange={(event) => update({ serviceName: event.target.value })} />
          </Field>
          <Field
            label="Headers"
            hint={
              stored !== null && stored.headerNames.length > 0
                ? `Stored: ${stored.headerNames.join(", ")} (values are not shown). Type new headers to replace them, or leave empty to keep them.`
                : "One per line, as Name: value — for example Authorization: Basic …. Stored encrypted; never shown again."
            }
            htmlFor="telemetry-export-headers"
          >
            <Textarea
              id="telemetry-export-headers"
              mono
              autoComplete="off"
              spellCheck={false}
              placeholder="Authorization: Basic …"
              value={form?.headers ?? ""}
              disabled={form === null}
              onChange={(event) => update({ headers: event.target.value })}
            />
          </Field>
          {stored !== null && stored.headerNames.length > 0 ? (
            <Checkbox id="telemetry-export-clear" label="Remove the stored headers" checked={form?.clearHeaders ?? false} disabled={form === null || form.headers.trim() !== ""} onChange={(checked) => update({ clearHeaders: checked })} />
          ) : null}
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
          Could not load the telemetry export: {loadError}
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
              ? "Off (not set yet)."
              : `Set by ${stored.updatedBy ?? "an admin"}${stored.updatedAt === undefined ? "" : ` on ${new Date(stored.updatedAt).toLocaleString()}`}.`}
        </p>
        <Button size="small" variant="solid" disabled={busy || !changed || problems.length > 0} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
