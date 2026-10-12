// Results of extract-rules: summary chips by category and priority, the rule catalog with
// search, filters and a detail drawer (plain English, Given/When/Then, parameters, citations,
// verification notes), likely duplicates flagged, the data objects and the coverage gaps.

import { AlertTriangle, Copy, HelpCircle, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { CitationChip, InlineText } from "@/components/results/inline-text";
import { useDocumentLinkHandler } from "@/components/results/use-document-links";
import { Markdown } from "@/components/results/lazy-markdown";
import { StatusBadge } from "@/components/status-badges";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import type { CatalogRule, DataObject, RulesResults } from "@/lib/api/documents";
import { idOfAnchor } from "@/lib/document-links";
import { ConfidenceMark, CountChip, Field, Kpi, KpiRow, PriorityMark, Section, SubTabs } from "./results-parts";

type Tab = "rules" | "data" | "coverage" | "document";

const needsReview = (rule: CatalogRule): boolean => rule.smeQuestion !== undefined || rule.suspectedDefect !== undefined || (rule.confidence !== undefined && rule.confidence !== "High");

export function RulesResultsView({ results, compare }: { results: RulesResults; compare: boolean }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("rules");
  const [open, setOpen] = useState<string | undefined>(undefined);
  // A RULE-xxx anchor into BUSINESS_RULES.md opens the rule's drawer.
  useDocumentLinkHandler((target) => {
    if (results.document === undefined || target.path !== results.document.path) return false;
    const id = idOfAnchor(target.anchor, results.rules.map((rule) => rule.id));
    if (id === undefined) return false;
    setOpen(id);
    setTab("rules");
    return true;
  });
  const previous = compare ? results.previous?.counts : undefined;
  const counts = results.counts;
  return (
    <div className="flex flex-col gap-4">
      <KpiRow>
        <Kpi label="Confirmed rules" value={counts["rules"]} previous={previous?.["rules"]} />
        <Kpi label="P0 rules" value={counts["p0"]} previous={previous?.["p0"]} tone="red" />
        <Kpi label="Need review" value={counts["needsReview"]} previous={previous?.["needsReview"]} hint="SME question, suspected defect or < High confidence" higherIsWorse />
        <Kpi label="Possible duplicates" value={counts["possibleDuplicates"]} previous={previous?.["possibleDuplicates"]} hint="Same source lines or near-identical names" higherIsWorse />
        <Kpi label="Refuted" value={counts["refuted"]} previous={previous?.["refuted"]} hint="Candidates a verifier rejected" />
        <Kpi label="Data objects" value={counts["dataObjects"]} previous={previous?.["dataObjects"]} />
      </KpiRow>

      <SubTabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "rules", label: "Rules", count: results.rules.filter((rule) => rule.status !== "refuted").length },
          { id: "data", label: "Data objects", count: results.dataObjects.length },
          { id: "coverage", label: "Coverage", count: results.coverageGaps.length },
          { id: "document", label: "BUSINESS_RULES.md", hidden: results.document === undefined },
        ]}
      />

      {tab === "rules" ? <RulesTab results={results} open={open} setOpen={setOpen} /> : null}
      {tab === "data" ? <DataObjectsTab objects={results.dataObjects} rules={results.rules} /> : null}
      {tab === "coverage" ? <CoverageTab results={results} /> : null}
      {tab === "document" && results.document !== undefined ? (
        <Section title="BUSINESS_RULES.md" description={results.document.path}>
          <Markdown text={results.document.markdown} path={results.document.path} />
        </Section>
      ) : null}
    </div>
  );
}

interface Filters {
  category: string;
  priority: string;
  confidence: string;
  status: "active" | "refuted" | "all";
  review: boolean;
  duplicates: boolean;
}

const NO_FILTERS: Filters = { category: "", priority: "", confidence: "", status: "active", review: false, duplicates: false };

function RulesTab({ results, open, setOpen }: { results: RulesResults; open: string | undefined; setOpen: (id: string | undefined) => void }): React.JSX.Element {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const set = (patch: Partial<Filters>): void => setFilters((previous) => ({ ...previous, ...patch }));
  const active = results.rules.filter((rule) => rule.status !== "refuted");
  const categories = useMemo(() => [...new Set(results.rules.map((rule) => rule.category).filter((value): value is string => value !== undefined))].sort(), [results.rules]);
  const priorities = useMemo(() => [...new Set(results.rules.map((rule) => rule.priority).filter((value) => value !== ""))].sort(), [results.rules]);
  const confidences = useMemo(() => [...new Set(results.rules.map((rule) => rule.confidence).filter((value): value is string => value !== undefined))], [results.rules]);

  const rows = results.rules.filter(
    (rule) =>
      (filters.status === "all" || (filters.status === "refuted" ? rule.status === "refuted" : rule.status !== "refuted")) &&
      (filters.category === "" || rule.category === filters.category) &&
      (filters.priority === "" || rule.priority === filters.priority) &&
      (filters.confidence === "" || rule.confidence === filters.confidence) &&
      (!filters.review || needsReview(rule)) &&
      (!filters.duplicates || rule.duplicateGroup !== undefined),
  );
  const rule = results.rules.find((entry) => entry.id === open);

  const columns: Column<CatalogRule>[] = [
    { id: "id", header: "ID", cell: (row) => <span className="font-mono text-[12px] whitespace-nowrap text-text">{row.id}</span>, sort: (row) => row.id },
    {
      id: "name",
      header: "Rule",
      cell: (row) => (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-text">{row.name}</span>
          <span className="flex flex-wrap gap-1">
            {row.duplicateGroup === undefined ? null : <StatusBadge tone="purple-light" label={`Possible duplicate · group ${row.duplicateGroup}`} title="Same source lines or a near-identical name as another rule" />}
            {row.status === "refuted" ? <StatusBadge tone="red" label="Refuted" /> : null}
            {row.smeQuestion === undefined ? null : <StatusBadge tone="orange" label="SME question" />}
            {row.suspectedDefect === undefined ? null : <StatusBadge tone="red" label="Suspected defect" />}
          </span>
        </div>
      ),
      sort: (row) => row.name,
      search: (row) => `${row.id} ${row.name} ${row.plainEnglish ?? ""} ${row.source ?? ""}`,
      className: "min-w-[280px]",
    },
    { id: "category", header: "Category", cell: (row) => <span className="text-text-secondary">{row.category ?? "—"}</span>, sort: (row) => row.category },
    { id: "priority", header: "Priority", cell: (row) => <PriorityMark priority={row.priority} />, sort: (row) => row.priority || "P9" },
    { id: "confidence", header: "Confidence", cell: (row) => <ConfidenceMark confidence={row.confidence} />, sort: (row) => ({ High: 0, Medium: 1, Low: 2 })[row.confidence ?? ""] ?? 3 },
    {
      id: "source",
      header: "Source",
      cell: (row) => {
        const first = row.citations[0];
        return first === undefined ? <InlineText text={row.source ?? "—"} className="text-[12px] text-text-muted" /> : <CitationChip path={first.path} from={first.from} to={first.to} className="max-w-[260px]" />;
      },
      sort: (row) => row.source,
    },
  ];

  const toggle = (key: "category" | "priority", value: string): void => set({ [key]: filters[key] === value ? "" : value });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-20 text-[11px] tracking-wide text-text-muted uppercase">Category</span>
          {categories.map((category) => {
            const count = active.filter((entry) => entry.category === category).length;
            return count === 0 && filters.category !== category ? null : (
              <CountChip key={category} label={category} count={count} active={filters.category === category} onClick={() => toggle("category", category)} />
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-20 text-[11px] tracking-wide text-text-muted uppercase">Priority</span>
          {priorities.map((priority) => (
            <CountChip
              key={priority}
              label={priority}
              count={active.filter((entry) => entry.priority === priority).length}
              active={filters.priority === priority}
              onClick={() => toggle("priority", priority)}
              tone={priority === "P0" ? "red" : priority === "P1" ? "orange" : "blue"}
            />
          ))}
          <CountChip label="Need review" count={active.filter(needsReview).length} active={filters.review} onClick={() => set({ review: !filters.review })} tone="orange" />
          <CountChip label="Possible duplicates" count={active.filter((entry) => entry.duplicateGroup !== undefined).length} active={filters.duplicates} onClick={() => set({ duplicates: !filters.duplicates })} tone="purple-light" />
          <CountChip label="Refuted" count={results.rules.length - active.length} active={filters.status === "refuted"} onClick={() => set({ status: filters.status === "refuted" ? "active" : "refuted" })} tone="muted" />
        </div>
      </div>
      <Section title="Rule catalog" description="Each citation was checked by a second agent. Open a rule for its specification and evidence.">
        <DataTable
          label="Business rules"
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          onRowClick={(row) => setOpen(row.id)}
          selectedKey={open}
          searchPlaceholder="Search rules, statements, sources"
          initialSort={{ id: "id" }}
          rowClassName={(row) => (row.status === "refuted" ? "opacity-60" : undefined)}
          minWidth={820}
          toolbar={
            <div className="flex flex-wrap items-center gap-2">
              {confidences.length < 2 ? null : (
                <Select
                  className="h-8 w-40 text-[13px]"
                  value={filters.confidence}
                  onChange={(value) => set({ confidence: value })}
                  options={[{ value: "", label: "Any confidence" }, ...confidences.map((value) => ({ value, label: `${value} confidence` }))]}
                />
              )}
              <Select
                className="h-8 w-40 text-[13px]"
                value={filters.status}
                onChange={(value) => set({ status: value as Filters["status"] })}
                options={[
                  { value: "active", label: "Confirmed rules" },
                  { value: "refuted", label: "Refuted only" },
                  { value: "all", label: "All candidates" },
                ]}
              />
            </div>
          }
          empty="No rule matches these filters."
        />
      </Section>
      <Drawer open={rule !== undefined} title={rule?.name ?? ""} subtitle={rule === undefined ? undefined : <RuleSubtitle rule={rule} />} onClose={() => setOpen(undefined)}>
        {rule === undefined ? null : <RuleDetail rule={rule} rules={results.rules} onOpen={setOpen} />}
      </Drawer>
    </div>
  );
}

function RuleSubtitle({ rule }: { rule: CatalogRule }): React.JSX.Element {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-mono">{rule.id}</span>
      <PriorityMark priority={rule.priority} />
      {rule.category === undefined ? null : <span>{rule.category}</span>}
      <ConfidenceMark confidence={rule.confidence} />
    </span>
  );
}

function RuleDetail({ rule, rules, onOpen }: { rule: CatalogRule; rules: CatalogRule[]; onOpen: (id: string) => void }): React.JSX.Element {
  const twins = rule.duplicateGroup === undefined ? [] : rules.filter((other) => other.duplicateGroup === rule.duplicateGroup && other.id !== rule.id);
  const hasSpec = rule.given !== undefined || rule.when !== undefined || rule.then !== undefined;
  return (
    <div className="flex flex-col gap-5">
      {rule.status === "refuted" ? (
        <Notice icon={XCircle} tone="red" title="Refuted by a verifier">
          <InlineText text={rule.rejectionReason ?? "The cited lines do not support this rule."} />
        </Notice>
      ) : null}
      {twins.length === 0 ? null : (
        <Notice icon={Copy} tone="purple" title="Possible duplicate">
          Shares source lines or a near-identical name with{" "}
          {twins.map((twin, index) => (
            <span key={twin.id}>
              {index === 0 ? "" : ", "}
              <button type="button" className="font-mono text-accent hover:underline" onClick={() => onOpen(twin.id)}>
                {twin.id}
              </button>
            </span>
          ))}
          . Review whether they state the same rule.
        </Notice>
      )}
      <Field label="Plain English">{rule.plainEnglish === undefined ? undefined : <InlineText text={rule.plainEnglish} />}</Field>
      {hasSpec ? (
        <Field label="Specification">
          <dl className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-lg bg-recessed/70 p-3 text-[13px]">
            {(["given", "when", "then", "and"] as const).map((key) =>
              rule[key] === undefined ? null : (
                <div key={key} className="contents">
                  <dt className="font-mono text-[11px] font-semibold tracking-wide text-text-muted uppercase leading-6">{key}</dt>
                  <dd className="text-text">
                    <InlineText text={rule[key]} />
                  </dd>
                </div>
              ),
            )}
          </dl>
        </Field>
      ) : null}
      <Field label="Parameters">{rule.parameters === undefined ? undefined : <InlineText text={rule.parameters} />}</Field>
      <Field label="Edge cases">
        {rule.edgeCases.length === 0 ? undefined : (
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {rule.edgeCases.map((edge) => (
              <li key={edge}>
                <InlineText text={edge} />
              </li>
            ))}
          </ul>
        )}
      </Field>
      <Field label="Citations">
        {rule.citations.length === 0 ? (
          <InlineText text={rule.source} />
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {rule.citations.map((citation) => (
              <CitationChip key={`${citation.path}:${citation.from}-${citation.to}`} path={citation.path} from={citation.from} to={citation.to} />
            ))}
          </span>
        )}
      </Field>
      <Field label="Verification notes">
        {rule.suspectedDefect === undefined && rule.smeQuestion === undefined ? (
          <span>Confidence {rule.confidence ?? "not stated"}; the citation was confirmed by a second agent.</span>
        ) : (
          <div className="flex flex-col gap-2">
            {rule.suspectedDefect === undefined ? null : (
              <Notice icon={AlertTriangle} tone="red" title="Suspected defect">
                <InlineText text={rule.suspectedDefect} />
              </Notice>
            )}
            {rule.smeQuestion === undefined ? null : (
              <Notice icon={HelpCircle} tone="orange" title="Question for a subject-matter expert">
                <InlineText text={rule.smeQuestion} />
              </Notice>
            )}
          </div>
        )}
      </Field>
    </div>
  );
}

const NOTICE_COLOR = { red: "var(--ds-status-red)", orange: "var(--ds-status-orange)", purple: "var(--ds-status-purple-light)" };

function Notice({ icon: Icon, tone, title, children }: { icon: typeof AlertTriangle; tone: keyof typeof NOTICE_COLOR; title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex gap-2.5 rounded-lg bg-recessed/70 p-3 text-[13px] leading-6 text-text-secondary" style={{ boxShadow: `inset 3px 0 0 0 ${NOTICE_COLOR[tone]}` }}>
      <Icon className="mt-1 size-4 shrink-0" style={{ color: NOTICE_COLOR[tone] }} strokeWidth={1.75} />
      <div className="min-w-0">
        <p className="font-medium text-text">{title}</p>
        <div>{children}</div>
      </div>
    </div>
  );
}

function DataObjectsTab({ objects, rules }: { objects: DataObject[]; rules: CatalogRule[] }): React.JSX.Element {
  // "Used by" names rules by name (sometimes cut short with …): show their ids.
  const idOf = (name: string): string | undefined => rules.find((rule) => rule.name === name || (name.endsWith("…") && rule.name.startsWith(name.slice(0, -1))))?.id;
  if (objects.length === 0) return <EmptyState title="No data objects at this ref" description="extract-rules lists the core records the rules read and write in DATA_OBJECTS.md." />;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {objects.map((object) => (
        <Section key={object.name} title={object.name} description={object.source === undefined ? undefined : <InlineText text={object.source} className="font-mono" />}>
          <div className="flex flex-col gap-3">
            <DataTable
              label={`Fields of ${object.name}`}
              rows={object.fields}
              rowKey={(row) => row.name}
              pageSize={0}
              minWidth={420}
              columns={[
                { id: "name", header: "Field", cell: (row) => <span className="font-mono text-[12px] text-text">{row.name}</span>, sort: (row) => row.name },
                { id: "type", header: "Type", cell: (row) => <span className="font-mono text-[12px] text-text-secondary">{row.type ?? "—"}</span>, sort: (row) => row.type },
                { id: "note", header: "Note", cell: (row) => <InlineText text={row.note ?? "—"} className="text-[12px] text-text-secondary" /> },
              ]}
            />
            {object.consumedBy.length === 0 ? null : (
              <div className="flex flex-wrap items-center gap-1 text-[12px] text-text-muted">
                <span className="mr-1">
                  Used by {object.consumedBy.length} {object.consumedBy.length === 1 ? "rule" : "rules"}:
                </span>
                {object.consumedBy.map((name) => (
                  <span key={name} title={name} className="rounded-[4px] bg-hover px-1.5 py-px font-mono text-[11px] text-text-secondary">
                    {idOf(name) ?? name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </Section>
      ))}
    </div>
  );
}

function CoverageTab({ results }: { results: RulesResults }): React.JSX.Element {
  const stats = Object.entries(results.stats).filter(([, value]) => value > 0);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Section title="Coverage gaps" description="Parts of the code that were not fully mined; re-run the stage to cover them.">
        {results.coverageGaps.length === 0 ? (
          <p className="text-[12px] text-text-muted">The extraction reports no coverage gaps.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-[13px] leading-6 text-text-secondary">
            {results.coverageGaps.map((gap) => (
              <li key={gap} className="flex gap-2">
                <AlertTriangle className="mt-1 size-4 shrink-0 text-[var(--ds-status-orange)]" strokeWidth={1.75} />
                <InlineText text={gap} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Extraction stats" description={results.source === "result" ? "From rules_result.json." : "rules_result.json is missing; the rules come from BUSINESS_RULES.md."}>
        {stats.length === 0 ? (
          <p className="text-[12px] text-text-muted">No stats at this ref.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-3">
            {stats.map(([key, value]) => (
              <div key={key} className="flex items-baseline justify-between gap-2 [box-shadow:0_1px_0_rgba(0,0,0,0.06)] pb-1">
                <dt className="text-text-secondary">{key.replace(/([A-Z])/g, " $1").toLowerCase()}</dt>
                <dd className="font-medium text-text tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Section>
    </div>
  );
}
