// Results of the gaps view (ADR-0057): what the legacy understanding could not settle. The application's gaps
// (the units' `Gaps and questions` tables joined) or one unit's own: a count per impact and per kind that filter the
// table, and the question, where it shows and which unit it belongs to. A specification written before the table
// existed has none: the view says so instead of showing an empty list as a clean bill.

import { CircleHelp } from "lucide-react";
import { useState } from "react";
import { InlineText } from "@/components/results/inline-text";
import { StatusBadge } from "@/components/status-badges";
import { type Column, DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import type { StatusTone } from "@/components/ui/status-dot";
import { type Gap, type GapImpact, type GapKind, type GapsResults, GAP_IMPACTS, GAP_KINDS } from "@/lib/api/documents";
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

export function GapsResultsView({ results, onOpenItem }: { results: GapsResults; onOpenItem?: ((item: string) => void) | undefined }): React.JSX.Element {
  const [impact, setImpact] = useState<GapImpact | "">("");
  const [kind, setKind] = useState<GapKind | "">("");
  const { gaps, gapCounts } = results;

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

  const rows = gaps.filter((gap) => (impact === "" || gap.impact === impact) && (kind === "" || gap.kind === kind));
  const columns: Column<Gap>[] = [
    { id: "id", header: "ID", cell: (row) => <span className="font-mono text-[12px] whitespace-nowrap text-text">{row.id}</span>, sort: (row) => row.id },
    { id: "impact", header: "Impact", cell: (row) => <StatusBadge tone={IMPACT_TONE[row.impact]} label={row.impact} title={IMPACT_NOTE[row.impact]} />, sort: (row) => GAP_IMPACTS.indexOf(row.impact) },
    { id: "kind", header: "Kind", cell: (row) => <span className="text-[12px] whitespace-nowrap text-text-secondary" title={KIND_NOTE[row.kind]}>{KIND_LABEL[row.kind]}</span>, sort: (row) => GAP_KINDS.indexOf(row.kind) },
    { id: "question", header: "Question", cell: (row) => <InlineText text={row.question} className="text-text" />, sort: (row) => row.question, search: (row) => `${row.id} ${row.question} ${row.where} ${row.item ?? ""}`, className: "min-w-[280px]" },
    { id: "where", header: "Where", cell: (row) => <InlineText text={row.where === "" ? "—" : row.where} className="font-mono text-[12px] text-text-muted" />, sort: (row) => row.where },
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
        description="What the code, as provided, does not settle: source that is missing, behavior that depends on data nobody can see, intent that needs an expert. A design carries them as questions with an assumption; it never decides them silently."
      >
        <div className="flex flex-wrap items-center gap-2">
          <CountChip label="All" count={gapCounts.total} active={impact === "" && kind === ""} onClick={() => (setImpact(""), setKind(""))} />
          {GAP_IMPACTS.map((level) => (
            <CountChip key={level} label={level} count={gapCounts.byImpact[level]} tone={IMPACT_TONE[level]} active={impact === level} onClick={() => setImpact(impact === level ? "" : level)} />
          ))}
          <span className="mx-1 h-4 w-px bg-[var(--color-border)]" aria-hidden />
          {GAP_KINDS.map((entry) => (
            <CountChip key={entry} label={KIND_LABEL[entry]} count={gapCounts.byKind[entry]} active={kind === entry} onClick={() => setKind(kind === entry ? "" : entry)} />
          ))}
        </div>
        {gaps.length === 0 ? (
          <EmptyState icon={CircleHelp} title="No gaps recorded" description="Every understood specification lists none, or none was understood with the gaps table yet." />
        ) : (
          <DataTable label="Gaps and questions" rows={rows} columns={columns} rowKey={(row) => `${row.item ?? ""}|${row.id}`} searchPlaceholder="Search questions, ids, places" initialSort={{ id: "impact" }} minWidth={820} empty="No gap matches this filter." />
        )}
      </Section>
    </div>
  );
}
