// Results of the gaps view (ADR-0057): what the legacy understanding could not settle. The application's gaps
// (the units' `Gaps and questions` tables joined) or one unit's own: a count per impact and per kind that filter the
// table, and the question, where it shows and which unit it belongs to. Who or what can settle each gap, with the step
// that would (ADR-0087), filters it too, so the open questions read as work for the right people. A specification
// written before the table existed has none: the view says so instead of showing an empty list as a clean bill.

import { DEFAULT_GAP_SETTLER, GAP_SETTLERS, type GapSettler, gapIsResolved } from "@kintsugi/domain";
import { CircleHelp } from "lucide-react";
import { useState } from "react";
import { InlineText } from "@/components/results/inline-text";
import { StatusBadge } from "@/components/status-badges";
import { type Column, DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import type { StatusTone } from "@/components/ui/status-dot";
import { type Gap, type GapImpact, type GapKind, type GapsResults, GAP_IMPACTS, GAP_KINDS } from "@/lib/api/documents";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { documentsApi } from "@/lib/api/documents";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/ui/toast";
import { CountChip, Section } from "./results-parts";

const IMPACT_TONE: Record<GapImpact, StatusTone> = { blocking: "red", risk: "orange", note: "muted" };
const IMPACT_NOTE: Record<GapImpact, string> = {
  blocking: "A design or a rebuild cannot be right without the answer",
  risk: "Work can go on with a stated assumption that may prove wrong",
  note: "Good to know",
};
const KIND_LABEL: Record<GapKind, string> = {
  "missing-source": "Missing source",
  unresolved: "Unresolved",
  ambiguous: "Ambiguous",
  unverified: "Unverified",
};
const KIND_NOTE: Record<GapKind, string> = {
  "missing-source": "The code names something that is not in the repositories provided",
  unresolved: "What happens depends on something the code does not settle",
  ambiguous: "The code runs but its intent is unclear: needs an expert",
  unverified: "A check could not be run here",
};

const SETTLER_LABEL: Record<GapSettler, string> = {
  "source-owner": "Source owner",
  expert: "Expert",
  data: "Production data",
  check: "A check",
};
const SETTLER_NOTE: Record<GapSettler, string> = {
  "source-owner": "Whoever can provide the missing source, configuration or job description",
  expert: "A person who knows the business: intent, a suspected defect, a comment that contradicts the code",
  data: "Records, logs or a run of the system: what the code reads at run time",
  check: "A tool or a test that could not be run here",
};
const settlerOf = (gap: Gap): GapSettler => gap.settledBy ?? DEFAULT_GAP_SETTLER[gap.kind];

export function GapsResultsView({ results, projectId, onOpenItem }: { results: GapsResults; projectId?: string; onOpenItem?: ((item: string) => void) | undefined }): React.JSX.Element {
  const { can } = useAuth();
  const [editing, setEditing] = useState<Gap | undefined>();
  const [answer, setAnswer] = useState("");
  const [evidence, setEvidence] = useState("");
  const [resolved, setResolved] = useState(true);
  const toast = useToast();
  const [status, setStatus] = useState<"all" | "open" | "resolved">("open");
  const isResolved = gapIsResolved;
  const edit = (gap: Gap): void => { setEditing(gap); setAnswer(gap.answer ?? ""); setEvidence(gap.evidence ?? ""); setResolved(!isResolved(gap)); };
  const propose = async (): Promise<void> => {
    if (editing?.item === undefined || projectId === undefined) throw new Error("Open the gap in its unit's specification first.");
    if (answer.trim() === "" || evidence.trim() === "") throw new Error("Provide the answer (or reason to reopen) and its evidence.");
    await documentsApi.answerGap(projectId, results.applicationId, { item: editing.item, gap: editing.id, commit: results.ref.commit, answer, evidence, status: resolved ? "resolved" : "open" });
    toast.success("Specification correction queued", "The writer proposes the answer in the original specification. Review and merge its pull request under Document writes; the gap remains open until then.");
  };
  const [impact, setImpact] = useState<GapImpact | "">("");
  const [kind, setKind] = useState<GapKind | "">("");
  const [settler, setSettler] = useState<GapSettler | "">("");
  const { gaps } = results;
  const scopedGaps = gaps.filter((gap) => status === "all" || isResolved(gap) === (status === "resolved"));
  const bySettler = Object.fromEntries(GAP_SETTLERS.map((entry) => [entry, scopedGaps.filter((gap) => settlerOf(gap) === entry).length])) as Record<GapSettler, number>;
  const gapCounts = { total: scopedGaps.length, byKind: Object.fromEntries(GAP_KINDS.map((entry) => [entry, scopedGaps.filter((gap) => gap.kind === entry).length])) as Record<GapKind, number>, byImpact: Object.fromEntries(GAP_IMPACTS.map((entry) => [entry, scopedGaps.filter((gap) => gap.impact === entry).length])) as Record<GapImpact, number> };

  if (results.noSection === true) {
    return (
      <Section title="Gaps and questions">
        <EmptyState
          icon={CircleHelp}
          title="This specification has no gaps table"
          description="It was written before specifications ended with a Gaps and questions table. Run understand on the item again to get one."
        />
      </Section>
    );
  }

  const rows = scopedGaps.filter((gap) => (impact === "" || gap.impact === impact) && (kind === "" || gap.kind === kind) && (settler === "" || settlerOf(gap) === settler));
  const columns: Column<Gap>[] = [
    { id: "id", header: "ID", cell: (row) => <span className="font-mono text-[12px] whitespace-nowrap text-text">{row.id}</span>, sort: (row) => row.id },
    { id: "impact", header: "Impact", cell: (row) => <StatusBadge tone={IMPACT_TONE[row.impact]} label={row.impact} title={IMPACT_NOTE[row.impact]} />, sort: (row) => GAP_IMPACTS.indexOf(row.impact) },
    { id: "status", header: "Status", cell: (row) => <StatusBadge tone={isResolved(row) ? "green" : "orange"} label={isResolved(row) ? "Resolved" : "Open"} />, sort: (row) => Number(isResolved(row)) },
    { id: "kind", header: "Kind", cell: (row) => <span className="text-[12px] whitespace-nowrap text-text-secondary" title={KIND_NOTE[row.kind]}>{KIND_LABEL[row.kind]}</span>, sort: (row) => GAP_KINDS.indexOf(row.kind) },
    { id: "question", header: "Question", cell: (row) => <InlineText text={row.question} className="text-text" />, sort: (row) => row.question, search: (row) => `${row.id} ${row.question} ${row.where} ${row.item ?? ""} ${row.probe ?? ""}`, className: "min-w-[280px]" },
    {
      id: "settler",
      header: "Settled by",
      cell: (row) => (
        <span className="flex flex-col gap-1">
          <span className="text-[12px] whitespace-nowrap text-text-secondary" title={SETTLER_NOTE[settlerOf(row)]}>{SETTLER_LABEL[settlerOf(row)]}</span>
          {row.probe === undefined ? null : <InlineText text={row.probe} className="text-[12px] text-text-muted" />}
        </span>
      ),
      sort: (row) => GAP_SETTLERS.indexOf(settlerOf(row)),
    },
    { id: "where", header: "Where", cell: (row) => <InlineText text={row.where === "" ? "—" : row.where} className="font-mono text-[12px] text-text-muted" />, sort: (row) => row.where },
    { id: "answer", header: "Answer / evidence", cell: (row) => <span className="flex flex-col gap-1"><InlineText text={row.answer ?? "—"} className="text-text" />{row.evidence === undefined ? null : <InlineText text={row.evidence} className="text-[12px] text-text-muted" />}</span> },
    ...(projectId !== undefined && can("documents.resolve") ? [{ id: "resolve", header: "", cell: (row: Gap) => <Button size="small" variant="ghost" disabled={row.item === undefined} onClick={() => edit(row)}>{isResolved(row) ? "Reopen / edit" : "Answer"}</Button> } satisfies Column<Gap>] : []),
    ...(gaps.some((gap) => gap.item !== undefined) && results.applicationId !== ""
      ? [
          {
            id: "item",
            header: "Unit",
            cell: (row: Gap) =>
              row.item === undefined ? (
                <span className="text-text-muted">—</span>
              ) : onOpenItem === undefined ? (
                <span className="font-mono text-[12px] text-text-secondary">{row.item}</span>
              ) : (
                <button type="button" className="font-mono text-[12px] text-text-secondary underline-offset-2 hover:underline" onClick={() => onOpenItem(row.item ?? "")}>
                  {row.item}
                </button>
              ),
            sort: (row: Gap) => row.item,
          } satisfies Column<Gap>,
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Gaps and questions"
        description="Answer questions in the original specification, with evidence. Review and merge the correction in Git to resolve them. Open blocking gaps prevent a final design; Generate draft can carry them explicitly as unresolved questions."
      >
        {(results.problems?.length ?? 0) > 0 ? <p role="alert" className="mb-3 text-[13px] text-[var(--ds-status-orange)]">Repair the original specification before generating a final design: {results.problems!.join(" ")}</p> : null}
        <div className="mb-3 flex gap-2">{(["open", "resolved", "all"] as const).map((value) => <Button key={value} size="small" variant={status === value ? "solid" : "ghost"} onClick={() => setStatus(value)}>{value === "open" ? "Open" : value === "resolved" ? "Resolved" : "All statuses"}</Button>)}</div>
        <div className="flex flex-wrap items-center gap-2">
          <CountChip label="All" count={gapCounts.total} active={impact === "" && kind === "" && settler === ""} onClick={() => (setImpact(""), setKind(""), setSettler(""))} />
          {GAP_IMPACTS.map((level) => (
            <CountChip key={level} label={level} count={gapCounts.byImpact[level]} tone={IMPACT_TONE[level]} active={impact === level} onClick={() => setImpact(impact === level ? "" : level)} />
          ))}
          <span className="mx-1 h-4 w-px bg-[var(--color-border)]" aria-hidden />
          {GAP_KINDS.map((entry) => (
            <CountChip key={entry} label={KIND_LABEL[entry]} count={gapCounts.byKind[entry]} active={kind === entry} onClick={() => setKind(kind === entry ? "" : entry)} />
          ))}
          <span className="mx-1 h-4 w-px bg-[var(--color-border)]" aria-hidden />
          {GAP_SETTLERS.map((entry) => (
            <CountChip key={entry} label={SETTLER_LABEL[entry]} count={bySettler[entry]} active={settler === entry} onClick={() => setSettler(settler === entry ? "" : entry)} />
          ))}
        </div>
        {gaps.length === 0 ? (
          <EmptyState icon={CircleHelp} title={results.problems?.length ? "The gaps register needs repair" : "No gaps recorded"} description="Read the original specifications to confirm their evidence and gaps. A missing or malformed register does not prove there are no questions." />
        ) : (
          <DataTable label="Gaps and questions" rows={rows} columns={columns} rowKey={(row) => `${row.item ?? ""}|${row.id}`} searchPlaceholder="Search questions, ids, places, probes" initialSort={{ id: "impact" }} minWidth={820} empty="No gap matches this filter." />
        )}
      </Section>
      <ConfirmDialog open={editing !== undefined} title={`Answer ${editing?.id ?? ""} in its specification`} confirmLabel="Propose specification correction" busyLabel="Queuing…" confirmVariant="solid" onConfirm={propose} onClose={() => setEditing(undefined)}>
        <p className="mb-3 text-text">{editing?.question}</p>
        <p className="mb-3">This changes the question's row in the original specification. It becomes effective after review and merge. An assumption without evidence leaves the gap open.</p>
        <div className="flex flex-col gap-3">
          <Field label="Answer or reason to reopen"><Input value={answer} maxLength={2000} onChange={(event) => setAnswer(event.target.value)} /></Field>
          <Field label="Evidence" hint="A source location, reviewed requirement, decision or confirmation from a named expert."><Input value={evidence} maxLength={2000} onChange={(event) => setEvidence(event.target.value)} /></Field>
          <label className="flex items-center gap-2"><input type="checkbox" checked={resolved} onChange={(event) => setResolved(event.target.checked)} />Mark resolved after this correction is merged</label>
        </div>
      </ConfirmDialog>
    </div>
  );
}
