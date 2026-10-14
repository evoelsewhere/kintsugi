// Results of assess, in six views over one header of KPIs:
//   Overview    — code composition, signals, the summary and recommendation, risk and run health
//   Code        — complexity hotspots, directories, size and complexity distributions, languages
//   Risk & debt — security highlights and technical debt with their distributions, gaps
//   Inventory   — every measured file, filterable by language
//   Monitoring  — the stage's runs: health, the latest run's steps, every run
//   ASSESSMENT.md — the full document

import { useMemo, useState } from "react";
import { BarList, Donut, Histogram, Scatter, type Segment, ShareBar } from "@/components/results/charts";
import { CHART_COLOR } from "@/components/results/chart-colors";
import { ClampedText, InlineText } from "@/components/results/inline-text";
import { Markdown } from "@/components/results/lazy-markdown";
import { MermaidDiagram } from "@/components/results/mermaid-diagram";
import { type Column, DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import type { AssessResults, Finding, Inventory, InventoryFile, InventoryLanguage } from "@/lib/api/documents";
import type { JobRunView } from "@/lib/api/job-runs";
import { shortSha } from "@/lib/format";
import { directoryRollup, inventorySignals, sizeDistribution, tableColumnCounts } from "./assess-analytics";
import { LatestRunNotice, MonitoringTab, RunSnapshot } from "./run-monitoring";
import { domainColors, formatCount, PRIORITY_COLOR, percentOf, SEVERITY_COLOR, SEVERITY_RANK } from "./results-format";
import { CountChip, Kpi, KpiRow, MarkdownTableView, MoreLink, Section, Signal, SignalList, SeverityMark, SubTabs } from "./results-parts";

type Tab = "overview" | "code" | "risk" | "inventory" | "monitoring" | "document";

/** The last two segments of a path, the rest in the tooltip. */
const shortPath = (path: string): string => path.split("/").slice(-2).join("/");

export function AssessResultsView({ results, compare, projectId, runs }: { results: AssessResults; compare: boolean; projectId: string; runs: JobRunView[] | undefined }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("overview");
  const { inventory, highlights } = results;
  const previous = compare ? results.previous?.counts : undefined;
  return (
    <div className="flex flex-col gap-4">
      <LatestRunNotice runs={runs} />
      <KpiRow>
        <Kpi label="Source files" value={inventory?.sourceFileCount} previous={previous?.["files"]} hint={inventory === null ? undefined : `${formatCount(inventory.fileCount)} files in total`} />
        <Kpi label="SLOC" value={inventory?.sloc} previous={previous?.["sloc"]} hint={inventory === null ? undefined : `${formatCount(inventory.totalLines)} lines`} />
        <Kpi label="KSLOC" value={inventory?.ksloc} previous={previous?.["ksloc"]} />
        <Kpi label="Complexity index" value={inventory?.complexityIndex} previous={previous?.["complexityIndex"]} hint={inventory?.complexityIndexFormula} higherIsWorse />
        <Kpi label="Languages" value={inventory?.languages.length} previous={previous?.["languages"]} hint={inventory?.languages.slice(0, 3).map((language) => language.language).join(", ")} />
        <Kpi label="Security findings" value={highlights.security.length} hint={highlights.debt === null ? undefined : `${highlights.debt.rows.length} debt items`} higherIsWorse tone={highlights.security.some((finding) => finding.severity === "Critical" || finding.severity === "High") ? "red" : undefined} />
      </KpiRow>

      <SubTabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "code", label: "Code analysis", hidden: inventory === null },
          { id: "risk", label: "Risk & debt", count: highlights.security.length + (highlights.debt?.rows.length ?? 0) },
          { id: "inventory", label: "Inventory", count: inventory?.files.length },
          { id: "monitoring", label: "Monitoring", count: runs?.length },
          { id: "document", label: "ASSESSMENT.md", hidden: results.document === undefined },
        ]}
      />

      {tab === "overview" ? <Overview results={results} runs={runs} onTab={setTab} /> : null}
      {tab === "code" && inventory !== null ? <CodeTab inventory={inventory} /> : null}
      {tab === "risk" ? <RiskTab results={results} /> : null}
      {tab === "inventory" ? <InventoryTab results={results} /> : null}
      {tab === "monitoring" ? <MonitoringTab projectId={projectId} runs={runs} /> : null}
      {tab === "document" && results.document !== undefined ? (
        <Section title="ASSESSMENT.md" description={results.document.path}>
          <Markdown text={results.document.markdown} path={results.document.path} />
        </Section>
      ) : null}
    </div>
  );
}

/** Languages as chart segments: the largest few, the rest as one "Other". */
function languageSegments(languages: InventoryLanguage[], pick: (language: InventoryLanguage) => number, keep = 6): Segment[] {
  const colors = domainColors(languages.map((language) => language.language));
  const sorted = [...languages].sort((a, b) => pick(b) - pick(a));
  const head: Segment[] = sorted.slice(0, keep).map((language) => ({ label: language.language, value: pick(language), color: colors.get(language.language) ?? CHART_COLOR.muted }));
  const rest = sorted.slice(keep);
  return rest.length === 0 ? head : [...head, { label: `${rest.length} others`, value: rest.reduce((sum, language) => sum + pick(language), 0), color: CHART_COLOR.muted, detail: rest.map((language) => language.language).join(", ") }];
}

function severitySegments(findings: Finding[]): Segment[] {
  return (["Critical", "High", "Medium", "Low", "Info", "Unknown"] as const).map((severity) => ({
    label: severity,
    value: findings.filter((finding) => finding.severity === severity).length,
    color: SEVERITY_COLOR[severity],
  }));
}

function Overview({ results, runs, onTab }: { results: AssessResults; runs: JobRunView[] | undefined; onTab: (tab: Tab) => void }): React.JSX.Element {
  const { highlights, inventory } = results;
  const signals = useMemo(() => (inventory === null ? undefined : inventorySignals(inventory)), [inventory]);
  const priorities = tableColumnCounts(highlights.debt, /priority/i);
  const topLanguage = inventory === null ? undefined : [...inventory.languages].sort((a, b) => b.sloc - a.sloc)[0];
  return (
    <div className="flex flex-col gap-4">
      {inventory === null ? null : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <Section title="Code composition" description="SLOC by language." className="lg:col-span-3">
            <Donut segments={languageSegments(inventory.languages, (language) => language.sloc)} format={formatCount} center={formatCount(inventory.sloc)} caption="SLOC" />
          </Section>
          <Section title="Signals" description="Figures derived from the inventory." className="lg:col-span-2">
            <SignalList>
              <Signal label="Dominant language" value={topLanguage === undefined ? "—" : topLanguage.language} note={topLanguage === undefined ? undefined : `${percentOf(topLanguage.sloc, inventory.sloc)} of the code`} />
              <Signal label="Complexity per KSLOC" value={formatCount(inventory.complexityPerKsloc ?? (inventory.ksloc === 0 ? 0 : Math.round((inventory.complexity / inventory.ksloc) * 10) / 10))} note="decision keywords" />
              <Signal label="Median file size" value={`${formatCount(signals?.medianSloc)} SLOC`} note={`over ${formatCount(signals?.codeFiles)} source files`} />
              <Signal label="Largest file" value={signals?.largest === undefined ? "—" : `${formatCount(signals.largest.sloc)} SLOC`} note={signals?.largest === undefined ? undefined : shortPath(signals.largest.path)} title={signals?.largest?.path} />
              <Signal label="Files over 1,000 SLOC" value={formatCount(signals?.oversized)} note={signals === undefined ? undefined : percentOf(signals.oversized, signals.codeFiles)} />
              <Signal label="Complexity concentration" value={signals === undefined ? "—" : `${percentOf(signals.topTenShare * 100, 100)} in 10 files`} note={signals === undefined ? undefined : `${formatCount(signals.halfComplexityFiles)} files hold half`} />
            </SignalList>
          </Section>
        </div>
      )}

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
        <Section title="Risk snapshot" description="Security findings and technical debt, from the assessment." actions={<MoreLink label="Risk & debt" onClick={() => onTab("risk")} />}>
          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-text">Security findings · {highlights.security.length}</p>
              {highlights.security.length === 0 ? <p className="text-[12px] text-text-muted">The assessment lists no security findings.</p> : <ShareBar segments={severitySegments(highlights.security)} format={formatCount} />}
            </div>
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-text">Technical debt · {highlights.debt?.rows.length ?? 0}</p>
              {highlights.debt === null ? (
                <p className="text-[12px] text-text-muted">The assessment has no debt table.</p>
              ) : priorities.length === 0 ? (
                <p className="text-[12px] text-text-muted">{highlights.debt.rows.length} items, ranked by remediation value.</p>
              ) : (
                <ShareBar segments={priorities.map((entry) => ({ label: entry.value, value: entry.count, color: PRIORITY_COLOR[entry.value] ?? CHART_COLOR.teal }))} format={formatCount} />
              )}
            </div>
            <p className="text-[12px] text-text-secondary">{highlights.gaps.length} documentation gaps, confidence notes and open questions.</p>
          </div>
        </Section>
        <RunSnapshot runs={runs} onMore={() => onTab("monitoring")} />
      </div>

      {results.architecture === undefined ? null : (
        <Section title="Architecture" description="ARCHITECTURE.mmd: the domains and how they depend on each other.">
          <MermaidDiagram source={results.architecture} title="Domain diagram" />
        </Section>
      )}
    </div>
  );
}

function CodeTab({ inventory }: { inventory: Inventory }): React.JSX.Element {
  const colors = useMemo(() => domainColors(inventory.languages.map((language) => language.language)), [inventory]);
  const code = useMemo(() => inventory.files.filter((file) => file.sloc > 0), [inventory]);
  const hotspots = useMemo(() => [...code].sort((a, b) => b.complexity - a.complexity).slice(0, 12), [code]);
  const rollup = useMemo(() => directoryRollup(code), [code]);
  const sizes = useMemo(() => sizeDistribution(code), [code]);
  const density = useMemo(
    () =>
      [...inventory.languages]
        .filter((language) => language.sloc >= 100)
        .map((language) => ({ language: language.language, value: Math.round((language.complexity / (language.sloc / 1000)) * 10) / 10 }))
        .sort((a, b) => b.value - a.value),
    [inventory],
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="Complexity hotspots" description="The twelve files with the most decision keywords — where changes are hardest to reason about.">
          <BarList
            format={formatCount}
            rows={hotspots.map((file) => ({ key: file.path, label: shortPath(file.path), title: file.path, value: file.complexity, note: `${formatCount(file.sloc)} SLOC`, color: colors.get(file.language) ?? CHART_COLOR.blue, mono: true }))}
          />
        </Section>
        <Section title="Where the code lives" description={`SLOC by directory (${rollup.depth === 1 ? "top level" : `first ${rollup.depth} levels`}); the note is complexity per KSLOC.`}>
          <BarList
            format={formatCount}
            color={CHART_COLOR.teal}
            rows={rollup.rows.slice(0, 12).map((stat) => ({ key: stat.dir, label: stat.dir, value: stat.sloc, note: `${formatCount(stat.sloc === 0 ? 0 : Math.round(stat.complexity / (stat.sloc / 1000)))} /KSLOC`, mono: true }))}
          />
          {rollup.rows.length > 12 ? <p className="mt-2 text-[11.5px] text-text-muted">{rollup.rows.length - 12} more directories in the inventory.</p> : null}
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Section title="Size against complexity" description="One dot per file, coloured by language; both axes are logarithmic. Top-right dots are large and branchy." className="xl:col-span-3">
          <Scatter
            xLabel="SLOC"
            yLabel="Complexity"
            points={code.map((file) => ({ key: file.path, x: file.sloc, y: file.complexity, color: colors.get(file.language) ?? CHART_COLOR.blue, title: `${file.path}\n${file.language} · ${formatCount(file.sloc)} SLOC · complexity ${formatCount(file.complexity)}` }))}
          />
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-text-secondary">
            {inventory.languages.slice(0, 8).map((language) => (
              <li key={language.language} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ backgroundColor: colors.get(language.language) }} />
                {language.language}
              </li>
            ))}
          </ul>
        </Section>
        <Section title="File size distribution" description="Source files by SLOC." className="xl:col-span-2">
          <Histogram buckets={sizes} format={formatCount} color={CHART_COLOR.blue} />
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Section title="Complexity density" description="Decision keywords per KSLOC, by language (languages under 100 SLOC left out)." className="xl:col-span-2">
          <BarList format={formatCount} rows={density.map((entry) => ({ key: entry.language, label: entry.language, value: entry.value, color: colors.get(entry.language) ?? CHART_COLOR.blue }))} />
        </Section>
        <Section title="Languages" description={inventory.method} className="xl:col-span-3">
          <LanguagesTable languages={inventory.languages} total={inventory.sloc} colors={colors} />
        </Section>
      </div>
    </div>
  );
}

function RiskTab({ results }: { results: AssessResults }): React.JSX.Element {
  const { highlights } = results;
  const priorities = tableColumnCounts(highlights.debt, /priority/i);
  return (
    <div className="flex flex-col gap-4">
      <Section title="Security highlights" description="From the Security Findings section; the understand stage verifies them per item.">
        {highlights.security.length === 0 ? (
          <p className="text-[12px] text-text-muted">The assessment lists no security findings.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <ShareBar segments={severitySegments(highlights.security)} format={formatCount} />
            <FindingsTable findings={highlights.security} />
          </div>
        )}
      </Section>

      {highlights.debt === null ? null : (
        <Section title="Technical debt" description="Top items by remediation value, as the assessment ranks them.">
          <div className="flex flex-col gap-4">
            {priorities.length === 0 ? null : <ShareBar segments={priorities.map((entry) => ({ label: entry.value, value: entry.count, color: PRIORITY_COLOR[entry.value] ?? CHART_COLOR.teal }))} format={formatCount} />}
            <MarkdownTableView table={highlights.debt} label="Technical debt" />
          </div>
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

function LanguagesTable({ languages, total, colors }: { languages: InventoryLanguage[]; total: number; colors?: Map<string, string> }): React.JSX.Element {
  const columns: Column<InventoryLanguage>[] = [
    {
      id: "language",
      header: "Language",
      cell: (row) => (
        <span className="flex items-center gap-2 text-text">
          {colors === undefined ? null : <span className="size-2 rounded-full" style={{ backgroundColor: colors.get(row.language) }} />}
          {row.language}
        </span>
      ),
      sort: (row) => row.language,
    },
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
  const [language, setLanguage] = useState<string | undefined>(undefined);
  if (inventory === null) return <EmptyState title="No inventory at this ref" description="inventory.json is written by the assess stage's inventory script; run assess to produce it." />;
  const columns: Column<InventoryFile>[] = [
    { id: "path", header: "Path", cell: (row) => <span className="font-mono text-[12px] break-all text-text">{row.path}</span>, sort: (row) => row.path },
    { id: "language", header: "Language", cell: (row) => <span className="text-text-secondary">{row.language}</span>, sort: (row) => row.language },
    { id: "lines", header: "Lines", cell: (row) => formatCount(row.lines), sort: (row) => row.lines, align: "right" },
    { id: "sloc", header: "SLOC", cell: (row) => formatCount(row.sloc), sort: (row) => row.sloc, align: "right" },
    { id: "complexity", header: "Complexity", cell: (row) => formatCount(row.complexity), sort: (row) => row.complexity, align: "right", title: "Decision-keyword count (a language-neutral proxy)" },
  ];
  const rows = language === undefined ? inventory.files : inventory.files.filter((file) => file.language === language);
  const languages = [...inventory.languages].sort((a, b) => b.files - a.files);
  return (
    <Section title="Files" description={`${formatCount(inventory.files.length)} files measured in ${inventory.sourceRepository ?? "the legacy repo"}${inventory.sourceCommit === undefined ? "" : ` at ${shortSha(inventory.sourceCommit)}`}.`}>
      <DataTable
        label="Files"
        rows={rows}
        columns={columns}
        rowKey={(row) => row.path}
        searchPlaceholder="Search files or languages"
        initialSort={{ id: "complexity", desc: true }}
        pageSize={50}
        toolbar={
          <div className="flex flex-wrap items-center gap-1.5">
            <CountChip label="All" count={inventory.files.length} active={language === undefined} onClick={() => setLanguage(undefined)} />
            {languages.map((entry) => (
              <CountChip key={entry.language} label={entry.language} count={entry.files} active={language === entry.language} onClick={() => setLanguage(language === entry.language ? undefined : entry.language)} />
            ))}
          </div>
        }
      />
    </Section>
  );
}
