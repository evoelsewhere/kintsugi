// The Overview of harden results: the severity split, how sure the scan is, severity against
// confidence, the weaknesses (CWE) and files the findings cluster in, what became of the
// assessment's highlights, and the coverage and patch at a glance.

import { BarList, Donut, Heatmap, ShareBar } from "@/components/results/charts";
import { CHART_COLOR } from "@/components/results/chart-colors";
import { EmptyState } from "@/components/ui/empty-state";
import type { Finding, HardenResults, Severity } from "@/lib/api/documents";
import { CONFIDENCE_COLOR, countBy, formatCount, SEVERITY_COLOR, segmentsOf } from "./results-format";
import { Distribution, MoreLink, Section, Signal, SignalList } from "./results-parts";

const LEVELS: Severity[] = ["Critical", "High", "Medium", "Low", "Info"];
const CONFIDENCES = ["High", "Medium", "Low"];
const VERDICT_COLOR: Record<string, string> = { confirmed: CHART_COLOR.red, refuted: CHART_COLOR.green, "not judged": CHART_COLOR.orange };

/** The file of a finding's location, without line numbers. */
const fileOf = (finding: Finding): string | undefined => finding.citations[0]?.path ?? finding.location?.replace(/[:#(].*$/, "").trim();

export function HardenOverview({ results, onFindings, onCoverage }: { results: HardenResults; onFindings: () => void; onCoverage: () => void }): React.JSX.Element {
  const report = results.report;
  if (report === null) return <EmptyState title="No SECURITY_FINDINGS.md at this ref" description="harden writes the report; pick another ref or run understand again." />;
  const findings = report.findings;
  const severities = LEVELS.map((level) => ({ key: level, count: report.scorecard[level] ?? 0 }));
  const confidences = countBy(findings, (finding) => finding.confidence ?? "—");
  const weaknesses = countBy(findings, (finding) => finding.cwe).slice(0, 10);
  const files = countBy(findings, fileOf).slice(0, 10);
  const carry = countBy(report.carryOverItems ?? [], (item) => item.verdict);
  const grid = LEVELS.map((level) => CONFIDENCES.map((confidence) => findings.filter((finding) => finding.severity === level && finding.confidence === confidence).length));
  const shownLevels = LEVELS.filter((_, index) => (grid[index] ?? []).some((value) => value > 0));
  const shownGrid = grid.filter((row) => row.some((value) => value > 0));
  const injection = report.injectionFlags !== undefined && !/^none\b/i.test(report.injectionFlags);
  const toolsNotRun = report.toolsNotRunItems?.length ?? report.toolsNotRun?.rows.length ?? 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Section title="Findings by severity" description="Confirmed findings of the scan." className="lg:col-span-3" actions={<MoreLink label="All findings" onClick={onFindings} />}>
          {report.scorecard.total === 0 ? (
            <p className="text-[12px] text-text-secondary">No finding was confirmed.</p>
          ) : (
            <Donut segments={segmentsOf(severities, (key) => SEVERITY_COLOR[key as Severity])} format={formatCount} center={formatCount(report.scorecard.total)} caption="findings" />
          )}
        </Section>
        <Section title="Signals" description="Coverage and side effects of the run." className="lg:col-span-2" actions={<MoreLink label="Coverage & tools" onClick={onCoverage} />}>
          <SignalList>
            <Signal label="Refuted by verification" value={formatCount(report.refutedCount ?? 0)} note="false positives" />
            <Signal label="Coverage" value={report.coverageComplete || report.coverageGaps.length === 0 ? "Complete" : `${report.coverageGaps.length} gaps`} />
            <Signal label="Tools not run" value={formatCount(toolsNotRun)} />
            <Signal label="Instruction-shaped text" value={injection ? "Found" : "None"} />
            <Signal label="Remediation patch" value={results.patch === undefined ? "None" : `${results.patch.hunks} hunks`} note={results.patch === undefined ? undefined : `${results.patch.files.length} files`} />
            <Signal label="Restricted records" value={formatCount(results.restrictedRecords)} note="never committed" />
          </SignalList>
        </Section>
      </div>

      {findings.length === 0 ? null : (
        <>
          <Section title="Mix" description="How sure the scan is, and what the highlights of the assessment became.">
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Distribution title="Confidence" count={findings.length}>
                <ShareBar segments={segmentsOf(confidences, (key) => CONFIDENCE_COLOR[key])} format={formatCount} />
              </Distribution>
              {carry.length === 0 ? null : (
                <Distribution title="Assessment highlights" count={(report.carryOverItems ?? []).length}>
                  <ShareBar segments={segmentsOf(carry, (key) => VERDICT_COLOR[key])} format={formatCount} />
                </Distribution>
              )}
            </div>
          </Section>

          {shownGrid.length === 0 || shownLevels.length === 0 ? null : (
            <Section title="Severity by confidence" description="Where the serious findings are also certain: darker cells hold more findings.">
              <Heatmap rows={shownLevels} columns={CONFIDENCES} values={shownGrid} color={CHART_COLOR.red} />
            </Section>
          )}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Section title="Weaknesses" description="Findings per CWE.">
              {weaknesses.length === 0 ? <p className="text-[12px] text-text-muted">The findings carry no CWE.</p> : <BarList format={formatCount} color={CHART_COLOR.orange} rows={weaknesses.map((entry) => ({ key: entry.key, label: entry.key, value: entry.count }))} />}
            </Section>
            <Section title="Files with the most findings" description="Where a fix pays off first.">
              {files.length === 0 ? (
                <p className="text-[12px] text-text-muted">The findings name no file.</p>
              ) : (
                <BarList format={formatCount} color={CHART_COLOR.red} rows={files.map((entry) => ({ key: entry.key, label: entry.key.split("/").slice(-2).join("/"), title: entry.key, value: entry.count, mono: true }))} />
              )}
            </Section>
          </div>
        </>
      )}
    </div>
  );
}
