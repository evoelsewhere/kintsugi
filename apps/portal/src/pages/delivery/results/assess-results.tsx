// Results of assess: the inventory figures as KPIs, the executive summary and recommendation,
// the languages and per-file tables, the risk, debt and security highlights of ASSESSMENT.md,
// the architecture diagram, and the full document.

import { useState } from "react";
import { ClampedText, InlineText } from "@/components/results/inline-text";
import { Markdown } from "@/components/results/lazy-markdown";
import { MermaidDiagram } from "@/components/results/mermaid-diagram";
import { type Column, DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import type { AssessResults, Finding, InventoryFile, InventoryLanguage } from "@/lib/api/documents";
import { shortSha } from "@/lib/format";
import { formatCount, SEVERITY_RANK } from "./results-format";
import { Kpi, KpiRow, MarkdownTableView, Section, SeverityMark, SubTabs } from "./results-parts";

type Tab = "overview" | "inventory" | "document";

export function AssessResultsView({ results, compare }: { results: AssessResults; compare: boolean }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("overview");
  const { inventory, highlights } = results;
  const previous = compare ? results.previous?.counts : undefined;
  return (
    <div className="flex flex-col gap-4">
      <KpiRow>
        <Kpi label="Source files" value={inventory?.sourceFileCount} previous={previous?.["files"]} hint={inventory === null ? undefined : `${formatCount(inventory.fileCount)} files in total`} />
        <Kpi label="SLOC" value={inventory?.sloc} previous={previous?.["sloc"]} hint={inventory === null ? undefined : `${formatCount(inventory.totalLines)} lines`} />
        <Kpi label="KSLOC" value={inventory?.ksloc} previous={previous?.["ksloc"]} />
        <Kpi label="Complexity index" value={inventory?.complexityIndex} previous={previous?.["complexityIndex"]} hint={inventory?.complexityIndexFormula} higherIsWorse />
        <Kpi label="Languages" value={inventory?.languages.length} previous={previous?.["languages"]} hint={inventory?.languages.slice(0, 3).map((language) => language.language).join(", ")} />
        <Kpi label="Security findings" value={highlights.security.length} hint={highlights.debt === null ? undefined : `${highlights.debt.rows.length} debt items`} higherIsWorse />
      </KpiRow>

      <SubTabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "inventory", label: "Inventory", count: inventory?.files.length },
          { id: "document", label: "ASSESSMENT.md", hidden: results.document === undefined },
        ]}
      />

      {tab === "overview" ? <Overview results={results} /> : null}
      {tab === "inventory" ? <InventoryTab results={results} /> : null}
      {tab === "document" && results.document !== undefined ? (
        <Section title="ASSESSMENT.md" description={results.document.path}>
          <Markdown text={results.document.markdown} path={results.document.path} />
        </Section>
      ) : null}
    </div>
  );
}

function Overview({ results }: { results: AssessResults }): React.JSX.Element {
  const { highlights, inventory } = results;
  return (
    <div className="flex flex-col gap-4">
      {highlights.summary === undefined && highlights.recommendation === undefined ? null : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {highlights.summary === undefined ? null : (
            <Section title="Executive summary" className="lg:col-span-2" description={inventory?.sourceRepository === undefined ? undefined : `${inventory.sourceRepository} at ${shortSha(inventory.sourceCommit)}`}>
              <ClampedText text={highlights.summary} />
            </Section>
          )}
          {highlights.recommendation === undefined ? null : (
            <Section title="Recommended pattern">
              <ClampedText text={highlights.recommendation} />
            </Section>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="Security highlights" description="From the Security Findings section; the understand stage verifies them per item.">
          {highlights.security.length === 0 ? <p className="text-[12px] text-text-muted">The assessment lists no security findings.</p> : <FindingsTable findings={highlights.security} />}
        </Section>
        <Section title="Languages" description={inventory?.method}>
          {inventory === null ? <p className="text-[12px] text-text-muted">No inventory.json at this ref.</p> : <LanguagesTable languages={inventory.languages} total={inventory.sloc} />}
        </Section>
      </div>

      {highlights.debt === null ? null : (
        <Section title="Technical debt" description="Top items by remediation value, as the assessment ranks them.">
          <MarkdownTableView table={highlights.debt} label="Technical debt" />
        </Section>
      )}

      {highlights.gaps.length === 0 ? null : (
        <Section title="Gaps, risks and open questions" description="Documentation gaps, confidence notes and questions for a subject-matter expert.">
          <ul className="flex flex-col gap-2 text-[13px] leading-6 text-text-secondary">
            {highlights.gaps.map((gap) => (
              <li key={gap} className="flex gap-2">
                <span className="mt-2.5 size-1 shrink-0 rounded-full bg-text-muted" />
                <InlineText text={gap} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {results.architecture === undefined ? null : (
        <Section title="Architecture" description="ARCHITECTURE.mmd: the domains and how they depend on each other.">
          <MermaidDiagram source={results.architecture} title="Domain diagram" />
        </Section>
      )}
    </div>
  );
}

function FindingsTable({ findings }: { findings: Finding[] }): React.JSX.Element {
  const columns: Column<Finding>[] = [
    { id: "id", header: "ID", cell: (row) => <span className="font-mono text-[12px] whitespace-nowrap text-text">{row.id}</span>, sort: (row) => row.id },
    { id: "severity", header: "Severity", cell: (row) => <SeverityMark severity={row.severity} />, sort: (row) => SEVERITY_RANK[row.severity], search: (row) => row.severity },
    { id: "title", header: "Finding", cell: (row) => <InlineText text={row.title} className="text-text-secondary" />, search: (row) => `${row.title} ${row.cwe ?? ""} ${row.location ?? ""}` },
    { id: "cwe", header: "CWE", cell: (row) => <span className="whitespace-nowrap text-[12px] text-text-secondary">{row.cwe ?? "—"}</span>, sort: (row) => row.cwe },
  ];
  return <DataTable label="Security highlights" rows={findings} columns={columns} rowKey={(row) => row.id} initialSort={{ id: "severity" }} pageSize={0} minWidth={0} />;
}

function LanguagesTable({ languages, total }: { languages: InventoryLanguage[]; total: number }): React.JSX.Element {
  const columns: Column<InventoryLanguage>[] = [
    { id: "language", header: "Language", cell: (row) => <span className="text-text">{row.language}</span>, sort: (row) => row.language },
    { id: "files", header: "Files", cell: (row) => formatCount(row.files), sort: (row) => row.files, align: "right" },
    { id: "sloc", header: "SLOC", cell: (row) => formatCount(row.sloc), sort: (row) => row.sloc, align: "right" },
    {
      id: "share",
      header: "Share",
      cell: (row) => {
        const share = total === 0 ? 0 : row.sloc / total;
        return (
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-hover">
              <span className="block h-full rounded-full bg-text-secondary" style={{ width: `${Math.round(share * 100)}%` }} />
            </span>
            <span className="w-9 text-right text-[12px] text-text-muted tabular-nums">{Math.round(share * 100)}%</span>
          </span>
        );
      },
      sort: (row) => row.sloc,
    },
    { id: "complexity", header: "Complexity", cell: (row) => formatCount(row.complexity), sort: (row) => row.complexity, align: "right" },
  ];
  return <DataTable label="Languages" rows={languages} columns={columns} rowKey={(row) => row.language} initialSort={{ id: "sloc", desc: true }} pageSize={0} minWidth={440} />;
}

function InventoryTab({ results }: { results: AssessResults }): React.JSX.Element {
  const inventory = results.inventory;
  if (inventory === null) return <EmptyState title="No inventory at this ref" description="inventory.json is written by the assess stage's inventory script; run assess to produce it." />;
  const columns: Column<InventoryFile>[] = [
    { id: "path", header: "Path", cell: (row) => <span className="font-mono text-[12px] break-all text-text">{row.path}</span>, sort: (row) => row.path },
    { id: "language", header: "Language", cell: (row) => <span className="text-text-secondary">{row.language}</span>, sort: (row) => row.language },
    { id: "lines", header: "Lines", cell: (row) => formatCount(row.lines), sort: (row) => row.lines, align: "right" },
    { id: "sloc", header: "SLOC", cell: (row) => formatCount(row.sloc), sort: (row) => row.sloc, align: "right" },
    { id: "complexity", header: "Complexity", cell: (row) => formatCount(row.complexity), sort: (row) => row.complexity, align: "right", title: "Decision-keyword count (a language-neutral proxy)" },
  ];
  return (
    <div className="flex flex-col gap-4">
      <Section title="Files" description={`${formatCount(inventory.files.length)} files measured in ${inventory.sourceRepository ?? "the legacy repo"}${inventory.sourceCommit === undefined ? "" : ` at ${shortSha(inventory.sourceCommit)}`}.`}>
        <DataTable label="Files" rows={inventory.files} columns={columns} rowKey={(row) => row.path} searchPlaceholder="Search files or languages" initialSort={{ id: "complexity", desc: true }} pageSize={50} />
      </Section>
      <Section title="Languages">
        <LanguagesTable languages={inventory.languages} total={inventory.sloc} />
      </Section>
    </div>
  );
}
