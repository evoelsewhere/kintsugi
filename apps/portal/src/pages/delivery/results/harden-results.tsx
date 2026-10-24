// Results of harden: the severity scorecard with the review coverage, the findings (with their
// confidence) and a detail drawer, the assessment carry-over, coverage gaps and the tools that did
// not run, the remediation patch as a diff, and the number of restricted records the run stored
// (a link to Governance, never their content). Older documents lack confidence, review coverage
// and the carry-over: those parts are left out.

import { AlertTriangle, CheckCircle2, Lock, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CitationChip, InlineText } from "@/components/results/inline-text";
import { useDocumentLinkHandler } from "@/components/results/use-document-links";
import { Markdown } from "@/components/results/lazy-markdown";
import { StatusBadge } from "@/components/status-badges";
import { type Column, DataTable } from "@/components/ui/data-table";
import { DetailPage } from "@/components/detail-page";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import type { CarryOverItem, Finding, HardenResults, Severity } from "@/lib/api/documents";
import { idOfAnchor } from "@/lib/document-links";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { HardenOverview } from "./harden-overview";
import { SEVERITY_RANK, SEVERITY_TONE } from "./results-format";
import { ConfidenceMark, CountChip, Field, Kpi, KpiRow, MarkdownTableView, Section, SeverityMark, SubTabs } from "./results-parts";

type Tab = "overview" | "findings" | "carryover" | "patch" | "coverage" | "document";

type Report = NonNullable<HardenResults["report"]>;

const CONFIDENCE_RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

const VERDICT_BADGE: Record<CarryOverItem["verdict"], { tone: "red" | "green" | "orange"; label: string }> = {
  confirmed: { tone: "red", label: "Confirmed" },
  refuted: { tone: "green", label: "Refuted" },
  "not judged": { tone: "orange", label: "Not judged" },
};

/** What the report says about a scan without findings: its review coverage, else whether every class was scanned. */
const noFindingsStatement = (report: Report): string =>
  report.reviewCoverage ?? (report.coverageComplete ? "All finder classes returned and every candidate was judged." : "Some classes were not scanned or some findings not judged: see Coverage & tools.");

const LEVELS: Severity[] = ["Critical", "High", "Medium", "Low"];

export function HardenResultsView({ results, compare }: { results: HardenResults; compare: boolean }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("overview");
  const [open, setOpen] = useState<string | undefined>(undefined);
  const report = results.report;
  const previous = compare ? results.previous?.counts : undefined;
  const carryOver = report?.carryOverItems ?? [];
  const noFindings = report !== null && report.scorecard.total === 0;
  const openFinding = (id: string) => {
    setOpen(id);
    setTab("findings");
  };
  // A SEC-xxx anchor into SECURITY_FINDINGS.md opens the finding's drawer.
  useDocumentLinkHandler((target) => {
    if (results.document === undefined || target.path !== results.document.path) return false;
    const id = idOfAnchor(target.anchor, report?.findings.map((finding) => finding.id) ?? []);
    if (id === undefined) return false;
    openFinding(id);
    return true;
  });
  return (
    <div className="flex flex-col gap-4">
      <KpiRow>
        {LEVELS.map((level) => (
          <Kpi key={level} label={level} value={report?.scorecard[level]} previous={previous?.[level.toLowerCase()]} tone={SEVERITY_TONE[level]} higherIsWorse />
        ))}
        <Kpi
          label="Total findings"
          value={report?.scorecard.total}
          display={noFindings ? "None confirmed" : undefined}
          previous={previous?.["findings"]}
          hint={noFindings ? noFindingsStatement(report) : report?.topCwes === undefined ? undefined : `Top CWE: ${report.topCwes}`}
          higherIsWorse
        />
        <Kpi label="Refuted" value={report?.refutedCount ?? undefined} display={report === null ? "—" : String(report.refutedCount ?? 0)} hint="False positives removed by verification" />
      </KpiRow>

      {report?.reviewCoverage === undefined ? null : (
        <p className="-mt-1 text-[12px] leading-5 text-text-secondary">
          <span className="font-medium text-text">Review coverage:</span> <InlineText text={report.reviewCoverage} />
        </p>
      )}

      <StatusStrip results={results} />

      <SubTabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "findings", label: "Findings", count: report?.findings.length },
          { id: "carryover", label: "Assessment carry-over", count: carryOver.length, hidden: carryOver.length === 0 && (report?.carryOver ?? null) === null },
          { id: "patch", label: "Remediation patch", count: results.patch?.hunks },
          { id: "coverage", label: "Coverage & tools", count: report === null ? undefined : coverageCount(report) },
          { id: "document", label: "SECURITY_FINDINGS.md", hidden: results.document === undefined },
        ]}
      />

      {tab === "overview" ? <HardenOverview results={results} onFindings={() => setTab("findings")} onCoverage={() => setTab("coverage")} /> : null}
      {tab === "findings" ? <FindingsTab results={results} open={open} setOpen={setOpen} /> : null}
      {tab === "carryover" && report !== null ? <CarryOverTab report={report} onOpenFinding={openFinding} /> : null}
      {tab === "patch" ? <PatchTab results={results} /> : null}
      {tab === "coverage" ? <CoverageTab results={results} /> : null}
      {tab === "document" && results.document !== undefined ? (
        <Section title="SECURITY_FINDINGS.md" description={results.document.path}>
          <Markdown text={results.document.markdown} path={results.document.path} />
        </Section>
      ) : null}
    </div>
  );
}

/** Coverage, injection flags and restricted records at a glance. */
function StatusStrip({ results }: { results: HardenResults }): React.JSX.Element | null {
  const { can } = useAuth();
  const report = results.report;
  if (report === null) return null;
  const injection = report.injectionFlags !== undefined && !/^none\b/i.test(report.injectionFlags);
  const items: Array<{ icon: typeof ShieldCheck; tone: string; text: React.ReactNode }> = [
    report.coverageComplete || report.coverageGaps.length === 0
      ? { icon: CheckCircle2, tone: "var(--ds-status-green)", text: "Every finder class returned and every finding was judged." }
      : { icon: AlertTriangle, tone: "var(--ds-status-orange)", text: `${report.coverageGaps.length} coverage gap${report.coverageGaps.length === 1 ? "" : "s"}: the counts cover judged findings only.` },
    injection
      ? { icon: AlertTriangle, tone: "var(--ds-status-red)", text: "Instruction-shaped text was found in the source: see Coverage & tools." }
      : { icon: ShieldCheck, tone: "var(--ds-status-green)", text: "No instruction-shaped text in the source." },
    {
      icon: Lock,
      tone: "var(--ds-text-muted)",
      text: (
        <>
          {results.restrictedRecords === 0 ? "No restricted records" : `${results.restrictedRecords} restricted record${results.restrictedRecords === 1 ? "" : "s"}`} stored by this run (never committed).
          {results.restrictedRecords === 0 || results.runId === undefined || !can("restricted.read") ? null : (
            <>
              {" "}
              <Link to={`/governance?tab=restricted&run=${encodeURIComponent(results.runId)}`} className="text-accent hover:underline">
                Open in Governance
              </Link>
            </>
          )}
        </>
      ),
    },
  ];
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
      {items.map((item, index) => (
        <div key={index} className="flex items-start gap-2 rounded-lg bg-recessed/60 px-3 py-2 text-[12px] leading-5 text-text-secondary">
          <item.icon className="mt-0.5 size-4 shrink-0" style={{ color: item.tone }} strokeWidth={1.75} />
          <span>{item.text}</span>
        </div>
      ))}
    </div>
  );
}

function FindingsTab({ results, open, setOpen }: { results: HardenResults; open: string | undefined; setOpen: (id: string | undefined) => void }): React.JSX.Element {
  const [confidence, setConfidence] = useState("");
  const report = results.report;
  const confidences = useMemo(() => ["High", "Medium", "Low"].filter((level) => report?.findings.some((finding) => finding.confidence === level) === true), [report]);
  if (report === null) return <EmptyState title="No SECURITY_FINDINGS.md at this ref" description="The understand stage writes it; pick another ref above." />;
  if (report.findings.length === 0) {
    return (
      <Section title="Findings">
        <EmptyState
          icon={ShieldCheck}
          title={report.coverageComplete ? "No findings survived refutation" : "No findings among the judged candidates"}
          description={report.reviewCoverage ?? (report.coverageComplete ? "All finder classes returned and every candidate was judged; none was confirmed as a real vulnerability." : noFindingsStatement(report))}
        />
      </Section>
    );
  }
  const finding = report.findings.find((entry) => entry.id === open);
  const rows = confidence === "" ? report.findings : report.findings.filter((entry) => entry.confidence === confidence);
  const columns: Column<Finding>[] = [
    { id: "id", header: "ID", cell: (row) => <span className="font-mono text-[12px] whitespace-nowrap text-text">{row.id}</span>, sort: (row) => row.id },
    { id: "title", header: "Finding", cell: (row) => <InlineText text={row.title} className="text-text" />, sort: (row) => row.title, search: (row) => `${row.id} ${row.title} ${row.cwe ?? ""} ${row.location ?? ""}`, className: "min-w-[260px]" },
    { id: "severity", header: "Severity", cell: (row) => <SeverityMark severity={row.severity} />, sort: (row) => SEVERITY_RANK[row.severity] },
    ...(confidences.length === 0
      ? []
      : [{ id: "confidence", header: "Confidence", cell: (row: Finding) => <ConfidenceMark confidence={row.confidence} />, sort: (row: Finding) => CONFIDENCE_RANK[row.confidence ?? ""] ?? 3 } satisfies Column<Finding>]),
    { id: "cwe", header: "CWE", cell: (row) => <span className="text-[12px] whitespace-nowrap text-text-secondary">{row.cwe ?? "—"}</span>, sort: (row) => row.cwe },
    {
      id: "location",
      header: "Location",
      cell: (row) => {
        const first = row.citations[0];
        return first === undefined ? <InlineText text={row.location ?? "—"} className="text-[12px] text-text-muted" /> : <CitationChip path={first.path} from={first.from} to={first.to} className="max-w-[240px]" />;
      },
      sort: (row) => row.location,
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => <StatusBadge tone={row.status === "confirmed" ? "red" : row.status === "refuted" ? "green" : "orange"} label={row.status === "confirmed" ? "Confirmed" : row.status === "refuted" ? "Refuted" : "Not judged"} />,
      sort: (row) => row.status,
    },
  ];
  return (
    <Section title="Findings" description="Confirmed by adversarial refutation; Critical and High ones were judged twice.">
      <DataTable
        label="Security findings"
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        onRowClick={(row) => setOpen(row.id)}
        selectedKey={open}
        searchPlaceholder="Search findings, CWE, files"
        initialSort={{ id: "severity" }}
        minWidth={780}
        toolbar={
          confidences.length < 2 ? undefined : (
            <Select
              className="h-8 w-40 text-[13px]"
              value={confidence}
              onChange={setConfidence}
              options={[{ value: "", label: "Any confidence" }, ...confidences.map((value) => ({ value, label: `${value} confidence` }))]}
            />
          )
        }
        empty="No finding matches this filter."
      />
      <DetailPage
        open={finding !== undefined}
        title={finding?.title ?? ""}
        subtitle={
          finding === undefined ? undefined : (
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{finding.id}</span>
              <SeverityMark severity={finding.severity} />
              {finding.confidence === undefined ? null : <span>{finding.confidence} confidence</span>}
              {finding.cwe === undefined ? null : <span>{finding.cwe}</span>}
            </span>
          )
        }
        onClose={() => setOpen(undefined)}
      >
        {finding === undefined ? null : (
          <div className="flex flex-col gap-5">
            <Field label="Location">
              {finding.citations.length === 0 ? (
                <InlineText text={finding.location} />
              ) : (
                <span className="flex flex-wrap gap-1.5">
                  {finding.citations.map((citation) => (
                    <CitationChip key={`${citation.path}:${citation.from}`} path={citation.path} from={citation.from} to={citation.to} />
                  ))}
                </span>
              )}
            </Field>
            <Field label="Confidence">
              {finding.confidence === undefined ? undefined : (
                <span className="flex items-center gap-2">
                  <ConfidenceMark confidence={finding.confidence} />
                  <span className="text-text-muted">{finding.confidence === "Low" ? "A latent weakness, or a pattern the review could not trace to a caller." : finding.confidence === "Medium" ? "Likely, with part of the path unconfirmed." : "Traced from an entry point to the flaw."}</span>
                </span>
              )}
            </Field>
            <Field label="Status">{finding.status === "confirmed" ? "Confirmed by the refuters." : finding.status === "refuted" ? "Refuted as a false positive." : "Not judged: no refuter returned a verdict."}</Field>
            <Field label="Details">{finding.detail === undefined ? undefined : <InlineText text={finding.detail} />}</Field>
            <Field label="Remediation">
              {results.patch?.findings.includes(finding.id) === true ? "The remediation patch carries a hunk for this finding (Remediation patch tab)." : "No hunk in the remediation patch: only Critical and High findings get one, credentials are changed by hand."}
            </Field>
          </div>
        )}
      </DetailPage>
    </Section>
  );
}

function PatchTab({ results }: { results: HardenResults }): React.JSX.Element {
  const patch = results.patch;
  if (patch === undefined) return <EmptyState title="No remediation patch at this ref" description="harden writes security_remediation.patch with a hunk per Critical or High finding." />;
  return (
    <Section
      title="Remediation patch"
      description={`${patch.path} · ${patch.hunks} hunk${patch.hunks === 1 ? "" : "s"}${patch.files.length === 0 ? "" : ` in ${patch.files.length} file${patch.files.length === 1 ? "" : "s"}`}. A member decides whether it is applied; Kintsugi never applies it.`}
    >
      {patch.hunks === 0 ? <p className="mb-3 text-[12px] text-text-muted">The patch carries no hunks: there was nothing to fix in code.</p> : null}
      <DiffView text={patch.text} />
    </Section>
  );
}

/** A unified diff, line by line: additions green, removals red, hunk headers and comments muted. */
export function DiffView({ text }: { text: string }): React.JSX.Element {
  const lines = text.replace(/\n$/, "").split("\n");
  return (
    <div className="overflow-x-auto rounded-lg bg-recessed/60 py-2 font-mono text-[12px] leading-5">
      {lines.map((line, index) => {
        const kind = line.startsWith("+++") || line.startsWith("---") ? "file" : line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "remove" : line.startsWith("#") ? "comment" : "context";
        return (
          <div
            key={index}
            className={cn(
              "flex min-w-max px-3 whitespace-pre",
              kind === "add" && "bg-[color-mix(in_srgb,var(--ds-status-green)_14%,transparent)] text-text",
              kind === "remove" && "bg-[color-mix(in_srgb,var(--ds-status-red)_14%,transparent)] text-text",
              kind === "hunk" && "text-[var(--ds-status-purple-dark)]",
              kind === "file" && "font-semibold text-text",
              kind === "comment" && "text-text-muted italic",
              kind === "context" && "text-text-secondary",
            )}
          >
            <span className="mr-3 w-8 shrink-0 text-right text-text-muted select-none">{index + 1}</span>
            {line === "" ? " " : line}
          </div>
        );
      })}
    </div>
  );
}

/** The assessment's security highlights, each with how it ended and a link to its finding. */
function CarryOverTab({ report, onOpenFinding }: { report: Report; onOpenFinding: (id: string) => void }): React.JSX.Element {
  const items = report.carryOverItems ?? [];
  const known = new Set(report.findings.map((finding) => finding.id));
  if (items.length === 0) {
    return (
      <Section title="Assessment carry-over">
        {report.carryOver === null || report.carryOver === undefined ? <p className="text-[12px] text-text-muted">No assessment highlight was carried over.</p> : <MarkdownTableView table={report.carryOver} label="Assessment carry-over" pageSize={0} />}
      </Section>
    );
  }
  const columns: Column<CarryOverItem>[] = [
    {
      id: "highlight",
      header: "Highlight",
      cell: (row) => (
        <span className="flex flex-col">
          <InlineText text={row.highlight} className="text-text" />
          {row.id === undefined && row.location === undefined ? null : <InlineText text={[row.id, row.location].filter((part) => part !== undefined).join(" · ")} className="text-[12px] text-text-muted" />}
        </span>
      ),
      sort: (row) => row.highlight,
      search: (row) => `${row.id ?? ""} ${row.highlight} ${row.location ?? ""} ${row.reason ?? ""}`,
      className: "min-w-[240px]",
    },
    { id: "severity", header: "Severity", cell: (row) => (row.severity === undefined ? <span className="text-text-muted">—</span> : <SeverityMark severity={row.severity} />), sort: (row) => SEVERITY_RANK[row.severity ?? "Unknown"] },
    { id: "verdict", header: "Verdict", cell: (row) => <StatusBadge tone={VERDICT_BADGE[row.verdict].tone} label={VERDICT_BADGE[row.verdict].label} />, sort: (row) => row.verdict },
    {
      id: "finding",
      header: "Finding",
      cell: (row) => {
        const id = row.findingId;
        if (id === undefined) return <span className="text-text-muted">—</span>;
        return known.has(id) ? (
          <button
            type="button"
            className="font-mono text-[12px] whitespace-nowrap text-accent hover:underline"
            onClick={(event) => {
              event.stopPropagation();
              onOpenFinding(id);
            }}
          >
            {id}
          </button>
        ) : (
          <span className="font-mono text-[12px] whitespace-nowrap text-text-secondary">{id}</span>
        );
      },
      sort: (row) => row.findingId,
    },
    { id: "reason", header: "Reason", cell: (row) => <InlineText text={row.reason ?? "—"} className="text-[12px] text-text-secondary" />, className: "min-w-[240px]" },
  ];
  const count = (verdict: CarryOverItem["verdict"]) => items.filter((item) => item.verdict === verdict).length;
  return (
    <Section title="Assessment carry-over" description="Every security highlight of the assessment, settled against the code: confirmed as a finding, refuted with the reason, or not judged.">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <CountChip label="Confirmed" count={count("confirmed")} tone="red" />
        <CountChip label="Refuted" count={count("refuted")} tone="green" />
        <CountChip label="Not judged" count={count("not judged")} tone="orange" />
      </div>
      <DataTable label="Assessment carry-over" rows={items} columns={columns} rowKey={(row) => `${row.id ?? ""}|${row.highlight}`} searchPlaceholder="Search highlights, reasons" minWidth={780} />
    </Section>
  );
}

/** Audit tools the report lists as not run, each with its reason. */
const toolsNotRunCount = (report: Report): number => report.toolsNotRunItems?.length ?? report.toolsNotRun?.rows.length ?? 0;

/** What the Coverage & tools tab counts: coverage gaps plus audit tools that were not run. */
const coverageCount = (report: Report): number => report.coverageGaps.length + toolsNotRunCount(report);

function CoverageTab({ results }: { results: HardenResults }): React.JSX.Element {
  const report = results.report;
  if (report === null) return <EmptyState title="No SECURITY_FINDINGS.md at this ref" />;
  const toolsNotRun = toolsNotRunCount(report);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <CountChip label="Coverage gaps" count={report.coverageGaps.length} tone={report.coverageGaps.length === 0 ? "green" : "orange"} />
        <CountChip label="Tools not run" count={toolsNotRun} tone={toolsNotRun === 0 ? "green" : "orange"} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title={`Coverage gaps · ${report.coverageGaps.length}`} description="Finder classes that did not return and findings no refuter judged.">
          {report.coverageGaps.length === 0 ? (
            <p className="flex items-center gap-2 text-[13px] text-text-secondary">
              <CheckCircle2 className="size-4 text-[var(--ds-status-green)]" strokeWidth={1.75} />
              Every finder class returned and every finding was judged.
            </p>
          ) : (
            <ul className="flex flex-col gap-2 text-[13px] leading-6 text-text-secondary">
              {report.coverageGaps.map((gap) => (
                <li key={gap} className="flex gap-2">
                  <AlertTriangle className="mt-1 size-4 shrink-0 text-[var(--ds-status-orange)]" strokeWidth={1.75} />
                  <InlineText text={gap} />
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Injection flags and credentials">
          <div className="flex flex-col gap-3 text-[13px] leading-6 text-text-secondary">
            <Field label="Instruction-shaped text">{report.injectionFlags === undefined ? "Not reported." : <InlineText text={report.injectionFlags} />}</Field>
            <Field label="Credentials">{report.credentials === undefined ? "Not reported." : <InlineText text={report.credentials} />}</Field>
          </div>
        </Section>
      </div>
      {report.toolsNotRun === null ? null : (
        <Section title={`Audit tools that were not run · ${toolsNotRun}`} description="Runtime jobs have no shell and no network: run these where the project builds.">
          <MarkdownTableView table={report.toolsNotRun} label="Audit tools" pageSize={0} />
        </Section>
      )}
      <Section title="Dependency CVEs">
        {report.cves === null ? <p className="text-[12px] text-text-muted">No dependency CVE is listed.</p> : <MarkdownTableView table={report.cves} label="Dependency CVEs" />}
      </Section>
      {report.remediationLog === null ? null : (
        <Section title="Remediation log">
          <MarkdownTableView table={report.remediationLog} label="Remediation log" pageSize={0} />
        </Section>
      )}
      {report.patchReview.length === 0 ? null : (
        <Section title="Patch review">
          <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] text-text-secondary">
            {report.patchReview.map((line) => (
              <li key={line}>
                <InlineText text={line} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
