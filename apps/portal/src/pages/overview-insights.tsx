// Charts of the Overview: run activity of the last two weeks, the outcome of the last 24 hours,
// the runs per stage with their run time, the repository sync state and the document writes.
// They read the recent runs, repositories and writes themselves and refresh with the page.

import { BarList, Donut, ShareBar } from "@/components/results/charts";
import { CHART_COLOR } from "@/components/results/chart-colors";
import { RUN_COLOR, SYNC_COLOR, WRITE_COLOR } from "@/components/results/status-colors";
import { type OverviewCounts, monitoringApi } from "@/lib/api/monitoring";
import { jobRunsApi } from "@/lib/api/job-runs";
import { isActiveStatus } from "@/lib/status";
import { averageMs, formatMs } from "@/lib/run-stats";
import { stageLabel } from "@/lib/stages";
import { useLoader } from "@/lib/use-loader";
import { ActivityChart } from "./delivery/overview-parts";
import { countBy, formatCount, segmentsOf } from "./delivery/results/results-format";
import { Section } from "./delivery/results/results-parts";

export function OverviewInsights({ counts }: { counts: OverviewCounts | undefined }): React.JSX.Element {
  const runs = useLoader("overview-runs", async () => (await jobRunsApi.listAll({ limit: 200 })).items, {
    refresh: (list) => (list.some((run) => isActiveStatus(run.status)) ? 5000 : 30000),
  });
  const repositories = useLoader("overview-repositories", monitoringApi.repositories, { refresh: () => 30000 });
  const writes = useLoader("overview-writes", async () => (await monitoringApi.documentWrites({ limit: 100 })).items, { refresh: () => 30000 });
  const top = (runs.data ?? []).filter((run) => run.kind === "stage");
  const stages = countBy(top, (run) => run.name).slice(0, 8);
  const outcome = counts === undefined ? [] : [
    { label: "Succeeded", value: counts.succeededRuns24h, color: RUN_COLOR["succeeded"] ?? CHART_COLOR.green },
    { label: "Failed", value: counts.failedRuns24h, color: RUN_COLOR["failed"] ?? CHART_COLOR.red },
    { label: "Active", value: counts.activeRuns, color: RUN_COLOR["running"] ?? CHART_COLOR.blue },
  ];
  const outcomeTotal = outcome.reduce((sum, entry) => sum + entry.value, 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <ActivityChart runs={runs.data ?? []} />
        </div>
        <Section title="Outcome · 24 h" description="Stage runs that ended in the last day, and those still going." className="xl:col-span-2">
          {outcomeTotal === 0 ? (
            <p className="py-6 text-center text-[12px] text-text-muted">No run in the last 24 hours.</p>
          ) : (
            <Donut segments={outcome} format={formatCount} center={formatCount(outcomeTotal)} caption="runs" />
          )}
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Section title="Runs by stage" description={`The ${top.length} most recent stage runs; the note is the mean run time of the succeeded ones.`}>
          {stages.length === 0 ? (
            <p className="text-[12px] text-text-muted">No stage run yet.</p>
          ) : (
            <BarList format={formatCount} rows={stages.map((entry) => ({ key: entry.key, label: stageLabel(entry.key), value: entry.count, note: formatMs(averageMs(top.filter((run) => run.name === entry.key))) }))} />
          )}
        </Section>
        <Section title="Repositories" description="Sync state of every registered repository.">
          {repositories.data === undefined ? null : repositories.data.length === 0 ? (
            <p className="text-[12px] text-text-muted">No repository is registered yet.</p>
          ) : (
            <ShareBar segments={segmentsOf(countBy(repositories.data, (repository) => repository.syncStatus), (key) => SYNC_COLOR[key])} format={formatCount} />
          )}
        </Section>
        <Section title="Document writes" description="What kintsugi-bot did to the document repos, last 100.">
          {writes.data === undefined ? null : writes.data.length === 0 ? (
            <p className="text-[12px] text-text-muted">No write yet.</p>
          ) : (
            <ShareBar segments={segmentsOf(countBy(writes.data, (write) => write.status), (key) => WRITE_COLOR[key])} format={formatCount} />
          )}
        </Section>
      </div>
    </div>
  );
}
