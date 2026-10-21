import type { GatePublication } from "@/lib/api/agent-context";
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { gatePublicationsApi } from "@/lib/api/agent-context";
import { errorText, formatDateTime } from "@/lib/format";

const PUBLICATION_LABEL: Record<GatePublication["state"], string> = {
  "pending-publication": "Decision recorded · publication pending",
  "awaiting-merge": "Decision recorded · awaiting Git merge",
  effective: "Effective in Git",
  stale: "Stale · new evidence is required",
  failed: "Publication failed · needs repair",
  rejected: "Decision rejected",
};

export function GatePublicationList({ projectId }: { projectId: string }): React.JSX.Element {
  const [items, setItems] = useState<GatePublication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (): Promise<void> => {
    try {
      const page = await gatePublicationsApi.list(projectId, { limit: 10 });
      setItems(page.items);
      setError(null);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setLoading(false);
    }
  }, [projectId]);
// load() updates state only after its API request settles.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  return <section aria-labelledby="gate-publication-heading" className="mt-5 border-t border-[var(--color-border)] pt-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 id="gate-publication-heading" className="text-[13px] font-medium text-text">Coding Agent Workflow gate publications</h3><p className="mt-0.5 text-[12px] text-text-muted">A recorded decision becomes effective only after its evidence record merges and validates in Git.</p></div>
      <Button size="icon" variant="ghost" aria-label="Refresh gate publications" onClick={() => { setLoading(true); void load(); }}><RefreshCw className="size-4" /></Button>
    </div>
    {error === null ? null : <p role="alert" className="mt-2 text-[12px] text-[var(--ds-status-red)]">{error}</p>}
    {loading ? <p className="mt-2 text-[12px] text-text-muted">Loading gate publications…</p> : items.length === 0 ? <EmptyState icon={AlertTriangle} title="No evidence publications" description="Authorized G2/G4 decisions and their Git publication state appear here." className="py-3" /> : <ul className="mt-2 flex flex-col">
      {items.map((item, index) => <li key={item.decisionId} className={`flex flex-wrap items-center gap-2 py-2.5 text-[12px] ${index > 0 ? "[box-shadow:0_-1px_0_rgba(0,0,0,0.06)]" : ""}`}>
        <span className="min-w-0 flex-1"><span className="font-mono text-text">{item.unitId} · {item.gateId}</span><span className="ml-2 text-text-muted">{formatDateTime(item.updatedAt)}</span><span className="block font-mono text-[10px] text-text-muted">{item.recordPath}</span></span>
        <Badge>{PUBLICATION_LABEL[item.state]}</Badge>
        {item.prUrl === undefined ? null : <a href={item.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">Open record PR <ExternalLink className="size-3" /></a>}
      </li>)}
    </ul>}
  </section>;
}
