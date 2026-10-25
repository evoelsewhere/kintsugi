import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectMemoryView } from "@kintsugi/domain";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { projectMemoryApi } from "@/lib/api/project-memory";
import { monitoringLink } from "@/lib/links";
import { errorText } from "@/lib/format";

export function ProjectMemoryPanel({ projectId }: { projectId: string }): React.JSX.Element {
  const [view, setView] = useState<ProjectMemoryView | null>(null);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const request = useRef(0);
  const load = useCallback(async (page = offset) => {
    const current = ++request.current;
    setLoading(true);
    try {
      const next = await projectMemoryApi.get(projectId, page);
      if (current === request.current) { setView(next); setError(null); }
    }
    catch (failure) { if (current === request.current) setError(errorText(failure)); }
    finally { if (current === request.current) setLoading(false); }
  }, [projectId, offset]);
  // API state is set after the request settles.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function change(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    try { await action(); await load(); }
    catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="project-memory-heading" className="flex flex-col gap-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-2xl">
        <h2 id="project-memory-heading" className="text-[15px] font-medium">Project memory</h2>
        <p className="mt-1 text-[13px] text-text-secondary">Agents remember facts, lessons, decisions and navigation across Assess, Understand and Design. Writes are available immediately as learned memory. Reviewers read only reviewed notes.</p>
      </div>
      <Button size="icon" variant="ghost" aria-label="Refresh project memory" disabled={busy || loading} onClick={() => void load()}><RefreshCw className="size-4" /></Button>
    </div>
    {error === null ? null : <p role="alert" className="text-[13px] text-[var(--ds-status-red)]">{error}</p>}
    {view === null ? <p className="text-[13px] text-text-muted">{loading ? "Loading project memory…" : "Project memory could not be loaded."}</p> : <>
      <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div><p className="text-[14px] font-medium">{view.enabled ? "Memory enabled" : "Memory disabled"}</p><p className="mt-1 text-[12px] text-text-muted">{view.total} notes · Agents search and read current memory through tools. Disabling stops subsequent lookups and collection.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button size="small" variant={view.enabled ? "ghost" : "solid"} disabled={busy || loading} onClick={() => void change(() => projectMemoryApi.configure(projectId, !view.enabled))}>{view.enabled ? "Disable memory" : "Enable memory"}</Button>
          <Button size="small" variant="danger" disabled={busy || loading} onClick={() => setResetOpen(true)}>Reset memory</Button>
        </div>
      </Card>
      <p className="text-[12px] text-text-muted">Learned notes are unverified and can come from running or failed jobs. Mark a note reviewed after checking it; this changes its trust, not whether it can be saved. Reject or forget misleading notes. Project documents remain authoritative.</p>
      {loading ? <p className="text-[13px] text-text-muted">Loading notes…</p> : view.entries.length === 0 ? <div className="rounded-lg border border-border p-6 text-[13px] text-text-muted">{view.enabled ? "Agents can save useful knowledge during a run and read it back immediately. Daily logs and long-term notes will appear here." : "Enable memory to let project agents remember and retrieve knowledge."}</div> : <ul className="flex flex-col gap-3">
        {view.entries.map((entry) => <li key={entry.id}><Card className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0"><p className="break-words text-[14px] font-medium">{entry.summary}</p><p className="mt-1 text-[12px] text-text-muted">{entry.applicationId === null ? "Project-wide" : entry.applicationId} · {entry.kind} · {entry.target === "daily" ? `Daily log ${entry.day}` : "Long-term memory"}</p></div>
            <div className="flex gap-1"><Badge>{entry.state === "approved" ? "reviewed" : entry.state}</Badge>{entry.deletedAt === null ? null : <Badge>forgotten</Badge>}</div>
          </div>
          <div className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-hover p-3 text-[13px]">{entry.content}</div>
          {entry.tags.length === 0 ? null : <p className="flex flex-wrap gap-2 text-[12px] text-text-muted">{entry.tags.map((tag)=><span key={tag}>#{tag}</span>)}</p>}
          {entry.evidence === null ? null : <details className="text-[12px] text-text-secondary"><summary className="cursor-pointer break-all">Source: {entry.evidence.repositoryId}/{entry.evidence.path} @ {entry.evidence.commit.slice(0,12)}</summary>{entry.evidence.quote === undefined ? null : <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded bg-hover p-2">{entry.evidence.quote}</pre>}</details>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[12px] text-text-muted"><p>{entry.sourceStage} · {entry.agent} · producer {entry.producerStatus}</p>
              {entry.sourceRunId === null ? null : <Link className="text-text-secondary underline" to={`${monitoringLink("runs")}&run=${encodeURIComponent(entry.sourceRunId)}&runProject=${encodeURIComponent(projectId)}`}>View originating run</Link>}
            </div>
            <div className="flex flex-wrap gap-2">{entry.deletedAt !== null
              ? entry.recoveryId === null ? null : <Button size="small" variant="ghost" disabled={busy} onClick={() => void change(() => projectMemoryApi.restore(projectId,entry.recoveryId!))}>Restore</Button>
              : <>
                {entry.state === "approved" ? null : <Button size="small" variant="solid" disabled={busy} onClick={() => void change(() => projectMemoryApi.review(projectId,entry.id,"approved"))}>Mark reviewed</Button>}
                {entry.state === "rejected" ? null : <Button size="small" variant="ghost" disabled={busy} onClick={() => void change(() => projectMemoryApi.review(projectId,entry.id,"rejected"))}>Reject</Button>}
                <Button size="small" variant="ghost" disabled={busy} onClick={() => void change(() => projectMemoryApi.forget(projectId,entry.id))}>Forget</Button>
              </>}
            </div>
          </div>
        </Card></li>)}
      </ul>}
      <div className="flex items-center justify-between gap-2 text-[12px] text-text-muted"><span>{view.total === 0 ? "0 notes" : `${offset + 1}–${Math.min(offset + 20, view.total)} of ${view.total}`}</span><div className="flex gap-2"><Button size="small" variant="ghost" disabled={busy || loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</Button><Button size="small" variant="ghost" disabled={busy || loading || offset + 20 >= view.total} onClick={() => setOffset(offset + 20)}>Next</Button></div></div>
    </>}
    <ConfirmDialog open={resetOpen} title="Reset project memory?" confirmLabel="Reset memory" onClose={() => setResetOpen(false)} onConfirm={async () => { await projectMemoryApi.reset(projectId); setOffset(0); await load(0); }}>
      Delete all notes, deletion recovery records and run scratchpads for this project. This cannot be undone. Subsequent tool calls see the reset immediately; agents may write new notes afterward. Content already returned to an agent remains in its conversation.
    </ConfirmDialog>
  </section>;
}
