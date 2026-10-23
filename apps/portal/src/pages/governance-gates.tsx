// Governance → Gates: quality gates (G0–G4) and stage gates waiting for a decision or decided,
// with status and project filters. Holders of gates.decide approve, reject or waive a pending
// gate with a note (required to reject or waive); holders of gates.request ask for a pipeline
// gate. Every request and decision is recorded in the audit log.

import { GATE_IDS, type GateDecision } from "@kintsugi/domain";
import { History, Plus, RefreshCw, ShieldQuestion } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { GateStatusBadge } from "@/components/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Chips } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type { Page } from "@/lib/api";
import { type Gate, type GateStatus, governanceApi } from "@/lib/api/governance";
import { projectsApi } from "@/lib/api/projects";
import { useAuth } from "@/lib/auth";
import { errorText, formatDateTime, formatRelative } from "@/lib/format";
import { deliveryLink } from "@/lib/links";
import { useLoader } from "@/lib/use-loader";
import { cn } from "@/lib/utils";
import { GatePublicationList } from "./agent-context/gate-publication";

const PAGE_SIZE = 25;

const GATE_FILTERS: { id: string; label: string; statuses: GateStatus[] }[] = [
  { id: "pending", label: "Pending", statuses: ["pending"] },
  { id: "approved,rejected,waived", label: "Decided", statuses: ["approved", "rejected", "waived"] },
  { id: "", label: "All", statuses: [] },
];

const DECISIONS: { id: GateDecision; label: string; verb: string }[] = [
  { id: "approve", label: "Approve", verb: "approved" },
  { id: "reject", label: "Reject", verb: "rejected" },
  { id: "waive", label: "Waive", verb: "waived" },
];

export function GatesView({ status, onStatus, projectOptions }: { status: string; onStatus: (value: string) => void; projectOptions: { value: string; label: string; hint?: string }[] }): React.JSX.Element {
  const { can } = useAuth();
  const [projectId, setProjectId] = useState("");
  const [offset, setOffset] = useState(0);
  const [deciding, setDeciding] = useState<Gate | null>(null);
  const [history, setHistory] = useState<Gate | null>(null);
  const [requesting, setRequesting] = useState(false);
  const filter = GATE_FILTERS.find((entry) => entry.id === status) ?? GATE_FILTERS[0]!;
  const gates = useLoader<Page<Gate>>(
    `gates/${filter.id}/${projectId}/${offset}`,
    () => governanceApi.gates({ status: filter.statuses, ...(projectId === "" ? {} : { projectId }), limit: PAGE_SIZE, offset }),
    { live: ["gates"] },
  );
  const canDecide = can("gates.decide");
  const canRequest = canDecide || can("gates.request");

  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div>
          <CardTitle>Gates</CardTitle>
          <CardDescription>Pipeline gates (G0–G4) and stage gates. A gate waits for a person to approve, reject or waive it; each request and decision is audited.</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chips
            label="Gate status"
            options={GATE_FILTERS.map((entry) => ({ id: entry.id, label: entry.label }))}
            value={filter.id}
            onChange={(value) => {
              setOffset(0);
              onStatus(value);
            }}
          />
          <div className="w-52">
            <Select
              value={projectId}
              options={projectOptions}
              onChange={(value) => {
                setOffset(0);
                setProjectId(value);
              }}
            />
          </div>
          {canRequest ? (
            <Button size="small" variant="ghost" onClick={() => setRequesting(true)}>
              <Plus className="size-4" />
              Request gate
            </Button>
          ) : null}
          <Button size="icon" variant="ghost" aria-label="Refresh gates" onClick={() => void gates.reload()}>
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <div className="mt-3">
        <Loaded loader={gates} rows={4}>
          {(page) =>
            page.items.length === 0 ? (
              <EmptyState
                icon={ShieldQuestion}
                title={filter.id === "pending" ? "No gates waiting" : "No gates"}
                description={filter.id === "pending" ? "Gates appear here when a stage reaches one or someone requests a pipeline gate." : "No gate matches these filters."}
              />
            ) : (
              <>
                <ul className="flex flex-col">
                  {page.items.map((gate, index) => (
                    <GateRow
                      key={gate.id}
                      gate={gate}
                      first={index === 0}
                      canDecide={canDecide}
                      onDecide={() => setDeciding(gate)}
                      onHistory={() => setHistory(gate)}
                    />
                  ))}
                </ul>
                <GatePager page={page} offset={offset} onOffset={setOffset} />
              </>
            )
          }
        </Loaded>
      </div>
      {projectId === "" ? <p className="mt-5 border-t border-[var(--color-border)] pt-4 text-[12px] text-text-muted">Select a project above to see its Coding Agent Workflow gate-publication and Git effectiveness status.</p> : <GatePublicationList projectId={projectId} />}

      <DecideGateDialog gate={deciding} onClose={() => setDeciding(null)} onDecided={() => void gates.reload()} />
      <GateHistoryDialog gate={history} onClose={() => setHistory(null)} />
      {requesting ? <RequestGateDialog projectOptions={projectOptions.filter((option) => option.value !== "")} onClose={() => setRequesting(false)} onRequested={() => void gates.reload()} /> : null}
    </Card>
  );
}

function GateRow({ gate, first, canDecide, onDecide, onHistory }: { gate: Gate; first: boolean; canDecide: boolean; onDecide: () => void; onHistory: () => void }): React.JSX.Element {
  return (
    <li className={cn("flex flex-wrap items-start gap-3 py-2.5", !first && "[box-shadow:0_-1px_0_rgba(0,0,0,0.06)]")}>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-text">
          <Badge className="font-mono">{gate.gateKey}</Badge>
          <span className="min-w-0 font-medium">{gate.title}</span>
          <GateStatusBadge status={gate.status} />
        </p>
        <p className="mt-0.5 text-[12px] text-text-secondary">
          <Link to={deliveryLink({ projectId: gate.projectId, applicationId: gate.applicationId })} className="text-accent hover:underline">
            {gate.projectId}
            {gate.applicationId === undefined ? "" : ` / ${gate.applicationId}`}
          </Link>
          {gate.subject === undefined ? "" : ` · about ${gate.subject}`}
          <span className="text-text-muted" title={formatDateTime(gate.requestedAt)}>
            {" "}
            · requested by {gate.requestedBy} {formatRelative(gate.requestedAt)}
          </span>
        </p>
        {gate.decidedAt === undefined ? null : (
          <p className="mt-0.5 text-[12px] text-text-secondary" title={formatDateTime(gate.decidedAt)}>
            {gate.status} by {gate.decidedBy} {formatRelative(gate.decidedAt)}
            {gate.note === undefined ? "" : ` — ${gate.note}`}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button size="small" variant="ghost" onClick={onHistory} aria-label={`History of ${gate.gateKey}`}>
          <History className="size-4" />
          History
        </Button>
        {gate.status === "pending" && canDecide ? (
          <Button size="small" variant="solid" onClick={onDecide}>
            Decide
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function GatePager({ page, offset, onOffset }: { page: Page<unknown>; offset: number; onOffset: (offset: number) => void }): React.JSX.Element | null {
  if (page.total <= page.limit) return null;
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-[12px] text-text-muted">
      <span>
        {offset + 1}–{Math.min(offset + page.limit, page.total)} of {page.total}
      </span>
      <Button size="small" variant="ghost" disabled={offset === 0} onClick={() => onOffset(Math.max(0, offset - page.limit))}>
        Previous
      </Button>
      <Button size="small" variant="ghost" disabled={offset + page.limit >= page.total} onClick={() => onOffset(offset + page.limit)}>
        Next
      </Button>
    </div>
  );
}

function DecideGateDialog({ gate, onClose, onDecided }: { gate: Gate | null; onClose: () => void; onDecided: () => void }): React.JSX.Element | null {
  if (gate === null) return null;
  return <DecideGateForm key={gate.id} gate={gate} onClose={onClose} onDecided={onDecided} />;
}

function DecideGateForm({ gate, onClose, onDecided }: { gate: Gate; onClose: () => void; onDecided: () => void }): React.JSX.Element {
  const toast = useToast();
  const [decision, setDecision] = useState<GateDecision>("approve");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsNote = decision !== "approve";
  const chosen = DECISIONS.find((entry) => entry.id === decision)!;

  const close = (): void => {
    if (!busy) onClose();
  };

  async function decide(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await governanceApi.decideGate(gate.id, decision, note);
      toast.success(`Gate ${chosen.verb}`, `${gate.gateKey} · ${gate.title}`);
      onClose();
      onDecided();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={`Decide ${gate.gateKey}`}
      description={`${gate.title} · ${gate.projectId}${gate.applicationId === undefined ? "" : ` / ${gate.applicationId}`}. The decision is final and recorded in the audit log.`}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button variant={decision === "reject" ? "danger" : "solid"} disabled={busy || (needsNote && note.trim() === "")} onClick={() => void decide()}>
            {busy ? "Saving…" : chosen.label}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Decision">
          <Chips label="Decision" options={DECISIONS.map((entry) => ({ id: entry.id, label: entry.label }))} value={decision} onChange={setDecision} />
        </Field>
        <Field label={needsNote ? "Note (required)" : "Note (optional)"} hint={needsNote ? "Say why, so the team knows what to change or which risk was accepted." : "For example, what was reviewed."}>
          <Textarea value={note} maxLength={4000} onChange={(event) => setNote(event.target.value)} placeholder={needsNote ? "Why this gate is rejected or waived" : ""} />
        </Field>
        {gate.subject === undefined ? null : <p className="text-[12px] text-text-muted">About {gate.subject}</p>}
        {error === null ? null : (
          <p role="alert" className="text-[13px] text-[var(--ds-status-red)]">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function GateHistoryDialog({ gate, onClose }: { gate: Gate | null; onClose: () => void }): React.JSX.Element | null {
  const history = useLoader(gate === null ? "gate-history/none" : `gate-history/${gate.id}`, () => (gate === null ? Promise.resolve([] as Gate[]) : governanceApi.gateHistory(gate.id)));
  if (gate === null) return null;
  return (
    <Modal open title={`History of ${gate.gateKey}`} description={`${gate.projectId}${gate.applicationId === undefined ? "" : ` / ${gate.applicationId}`}: every request of this gate, newest first.`} onClose={onClose}>
      <Loaded loader={history} rows={3}>
        {(entries) => (
          <ol className="flex flex-col">
            {entries.map((entry, index) => (
              <li key={entry.id} className={cn("flex flex-col gap-0.5 py-2", index > 0 && "[box-shadow:0_-1px_0_rgba(0,0,0,0.06)]")}>
                <p className="flex flex-wrap items-center gap-2 text-[13px] text-text">
                  <GateStatusBadge status={entry.status} />
                  <span>{entry.title}</span>
                </p>
                <p className="text-[12px] text-text-secondary">
                  Requested by {entry.requestedBy} · {formatDateTime(entry.requestedAt)}
                  {entry.subject === undefined ? "" : ` · about ${entry.subject}`}
                </p>
                {entry.decidedAt === undefined ? null : (
                  <p className="text-[12px] text-text-secondary">
                    {entry.status} by {entry.decidedBy} · {formatDateTime(entry.decidedAt)}
                    {entry.note === undefined ? "" : ` — ${entry.note}`}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </Loaded>
    </Modal>
  );
}

function RequestGateDialog({ projectOptions, onClose, onRequested }: { projectOptions: { value: string; label: string; hint?: string }[]; onClose: () => void; onRequested: () => void }): React.JSX.Element {
  const toast = useToast();
  const [projectId, setProjectId] = useState(projectOptions[0]?.value ?? "");
  const [applicationId, setApplicationId] = useState("");
  const [gateKey, setGateKey] = useState<string>("G0");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const project = useLoader(projectId === "" ? "project/none" : `project/${projectId}`, () => (projectId === "" ? Promise.resolve(null) : projectsApi.get(projectId)));
  const applicationOptions = [{ value: "", label: "The whole project" }, ...(project.data?.applications ?? []).map((application) => ({ value: application.id, label: application.name, hint: application.id }))];

  const close = (): void => {
    if (!busy) onClose();
  };

  async function request(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const gate = await governanceApi.requestGate({ projectId, gateKey, title: title.trim(), ...(applicationId === "" ? {} : { applicationId }) });
      toast.success("Gate requested", `${gate.gateKey} · ${gate.title}`);
      onClose();
      onRequested();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="Request a gate"
      description="Ask for a decision at a pipeline gate. It stays pending until someone with gates.decide approves, rejects or waives it."
      onClose={close}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button variant="solid" disabled={busy || projectId === "" || title.trim() === ""} onClick={() => void request()}>
            {busy ? "Requesting…" : "Request"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Project">
          <Select
            value={projectId}
            options={projectOptions}
            placeholder="Choose a project"
            onChange={(value) => {
              setProjectId(value);
              setApplicationId("");
            }}
          />
        </Field>
        <Field label="Application" hint="Leave empty for a project-wide gate.">
          <Select value={applicationId} options={applicationOptions} onChange={setApplicationId} disabled={projectId === ""} />
        </Field>
        <Field label="Gate">
          <Select value={gateKey} options={GATE_IDS.map((id) => ({ value: id, label: id }))} onChange={setGateKey} />
        </Field>
        <Field label="Title" hint="What is to be decided, for example “Portfolio decision approved”.">
          <Input value={title} maxLength={300} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        {error === null ? null : (
          <p role="alert" className="text-[13px] text-[var(--ds-status-red)]">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
