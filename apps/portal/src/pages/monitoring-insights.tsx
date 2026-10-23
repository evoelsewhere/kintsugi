// The charts above each Monitoring tab: job runs (figures, a bar per recent run, outcome and
// run time per stage), repositories (sync state and age of the last sync), document writes
// (outcome, kind and project) and the worker (state and queue depth). Each reads what it needs
// itself, independent of the list filters below it, and refreshes on its own.

import { BarList, Histogram, ShareBar, StackedColumns } from "@/components/results/charts";
import { CHART_COLOR } from "@/components/results/chart-colors";
import { RUN_COLOR, SYNC_COLOR, WRITE_COLOR } from "@/components/results/status-colors";
import { jobRunsApi } from "@/lib/api/job-runs";
import { monitoringApi } from "@/lib/api/monitoring";
import { formatRelative } from "@/lib/format";
import { averageMs, formatMs, percent, successRate } from "@/lib/run-stats";
import { isActiveStatus } from "@/lib/status";
import { stageLabel } from "@/lib/stages";
import { OVERVIEW_TOPICS, WORKER_AGES } from "@/lib/live";
import { useLoader } from "@/lib/use-loader";
import { useNow } from "@/lib/use-now";
import { workerVerdict } from "@/lib/worker-health";
import { MiniRunBars } from "./delivery/overview-parts";
import { countBy, formatCount, segmentsOf } from "./delivery/results/results-format";
import { Kpi, KpiRow, Section } from "./delivery/results/results-parts";

export function MonitoringInsights({ tab }: { tab: "runs" | "repositories" | "writes" | "runtime" }): React.JSX.Element {
  switch (tab) {
    case "runs":
      return <RunsInsights />;
    case "repositories":
      return <RepositoriesInsights />;
    case "writes":
      return <WritesInsights />;
    case "runtime":
      return <WorkerInsights />;
  }
}

function RunsInsights(): React.JSX.Element | null {
  const runs = useLoader("monitoring-insight-runs", async () => (await jobRunsApi.listAll({ limit: 200 })).items, {
    live: ["job-runs", "document-writes"],
  });
  if (runs.data === undefined) return null;
  const top = runs.data.filter((run) => run.kind === "stage");
  const active = top.filter((run) => isActiveStatus(run.status)).length;
  const failed = top.filter((run) => run.status === "failed").length;
  const stages = countBy(top, (run) => run.name).slice(0, 8);
  const projects = countBy(top, (run) => run.projectId).slice(0, 8);
  return (
    <div className="flex flex-col gap-4">
      <KpiRow>
        <Kpi label="Runs sampled" value={top.length} hint="the latest stage runs" />
        <Kpi label="Active" value={active} tone={active > 0 ? "blue" : undefined} hint="queued or running" />
        <Kpi label="Failed" value={failed} tone={failed > 0 ? "red" : "green"} hint={`of ${top.length} sampled`} higherIsWorse />
        <Kpi label="Success rate" value={undefined} display={percent(successRate(top))} hint="of the finished runs" />
        <Kpi label="Average run time" value={undefined} display={formatMs(averageMs(top))} hint="succeeded runs" />
        <Kpi label="Projects" value={projects.length} hint="with runs in the sample" />
      </KpiRow>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Section title="Recent runs" description="One bar per run, oldest to newest: height is the run time, colour the outcome." className="xl:col-span-3">
          {top.length === 0 ? <p className="text-[12px] text-text-muted">No stage run yet.</p> : <MiniRunBars runs={top} limit={48} height={96} width={11} />}
          <div className="mt-3">
            <ShareBar segments={segmentsOf(countBy(top, (run) => run.status), (key) => RUN_COLOR[key])} format={formatCount} />
          </div>
        </Section>
        <Section title="By stage" description="Runs per stage; the note is the mean run time of the succeeded ones." className="xl:col-span-2">
          {stages.length === 0 ? (
            <p className="text-[12px] text-text-muted">Nothing to count.</p>
          ) : (
            <BarList format={formatCount} rows={stages.map((entry) => ({ key: entry.key, label: stageLabel(entry.key), value: entry.count, note: formatMs(averageMs(top.filter((run) => run.name === entry.key))) }))} />
          )}
        </Section>
      </div>
      {projects.length < 2 ? null : (
        <Section title="By project" description="Runs per project in the sample.">
          <BarList format={formatCount} color={CHART_COLOR.teal} rows={projects.map((entry) => ({ key: entry.key, label: entry.key, value: entry.count, note: `${top.filter((run) => run.projectId === entry.key && run.status === "failed").length} failed` }))} />
        </Section>
      )}
    </div>
  );
}

const AGE_BUCKETS: Array<{ label: string; below: number }> = [
  { label: "<1 h", below: 3600e3 },
  { label: "<6 h", below: 6 * 3600e3 },
  { label: "<1 d", below: 86400e3 },
  { label: "<7 d", below: 7 * 86400e3 },
  { label: "older", below: Number.POSITIVE_INFINITY },
];

function RepositoriesInsights(): React.JSX.Element | null {
  const repositories = useLoader("monitoring-insight-repositories", monitoringApi.repositories, { live: ["repositories"] });
  const now = useNow(false);
  if (repositories.data === undefined) return null;
  const list = repositories.data;
  const errors = list.filter((repository) => repository.syncStatus === "error");
  const counts = AGE_BUCKETS.map(() => 0);
  let never = 0;
  for (const repository of list) {
    if (repository.lastSyncedAt === undefined) never += 1;
    else {
      const index = AGE_BUCKETS.findIndex((bucket) => now - new Date(repository.lastSyncedAt ?? 0).getTime() < bucket.below);
      counts[index] = (counts[index] ?? 0) + 1;
    }
  }
  const buckets = [...AGE_BUCKETS.map((bucket, index) => ({ label: bucket.label, value: counts[index] ?? 0 })), { label: "never", value: never }];
  const roles = countBy(list.flatMap((repository) => repository.projects.map((link) => link.role)), (role) => role);
  const servers = countBy(list, (repository) => repository.serverId);
  return (
    <div className="flex flex-col gap-4">
      <KpiRow>
        <Kpi label="Repositories" value={list.length} hint={`${servers.length} server${servers.length === 1 ? "" : "s"}`} />
        <Kpi label="Ready" value={list.filter((repository) => repository.syncStatus === "ready").length} tone="green" hint="cloned and in sync" />
        <Kpi label="Syncing" value={list.filter((repository) => repository.syncStatus === "cloning" || repository.syncStatus === "pending").length} tone="blue" hint="pending or cloning" />
        <Kpi label="Sync errors" value={errors.length} tone={errors.length > 0 ? "red" : "green"} higherIsWorse hint={errors[0]?.lastError ?? "none"} />
        <Kpi label="Linked to projects" value={list.filter((repository) => repository.projects.length > 0).length} hint={`${list.filter((repository) => repository.projects.length === 0).length} unused`} />
        <Kpi label="Last sync" value={undefined} display={formatNewest(list.flatMap((repository) => repository.lastSyncedAt ?? []))} hint="newest of all" />
      </KpiRow>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Section title="Sync state" description="Every registered repository.">
          <ShareBar segments={segmentsOf(countBy(list, (repository) => repository.syncStatus), (key) => SYNC_COLOR[key])} format={formatCount} />
        </Section>
        <Section title="Time since the last sync" description="How fresh the clones are." >
          <Histogram buckets={buckets} format={formatCount} color={CHART_COLOR.teal} height={72} />
        </Section>
        <Section title="Roles in projects" description="How projects use the repositories.">
          {roles.length === 0 ? <p className="text-[12px] text-text-muted">No repository is linked yet.</p> : <BarList format={formatCount} rows={roles.map((entry) => ({ key: entry.key, label: entry.key, value: entry.count }))} />}
        </Section>
      </div>
    </div>
  );
}

const formatNewest = (dates: string[]): string => (dates.length === 0 ? "Never" : formatRelative([...dates].sort().at(-1)));

function WritesInsights(): React.JSX.Element | null {
  const writes = useLoader("monitoring-insight-writes", async () => (await monitoringApi.documentWrites({ limit: 100 })).items, {
    live: ["document-writes"],
  });
  const now = useNow(false);
  if (writes.data === undefined) return null;
  const list = writes.data;
  const failed = list.filter((write) => write.status === "failed").length;
  const kinds = countBy(list, (write) => write.kind);
  const projects = countBy(list, (write) => write.projectId).slice(0, 8);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 14 }, (_, index) => new Date(today.getTime() - (13 - index) * 86400000));
  const statuses = countBy(list, (write) => write.status).map((entry) => entry.key);
  const columns = days.map((day) => {
    const inDay = list.filter((write) => new Date(write.createdAt).getTime() >= day.getTime() && new Date(write.createdAt).getTime() < day.getTime() + 86400000);
    return { label: String(day.getDate()), title: `${day.toLocaleDateString()}: ${inDay.length} writes`, segments: statuses.map((status) => ({ label: status, value: inDay.filter((write) => write.status === status).length, color: WRITE_COLOR[status] ?? CHART_COLOR.muted })) };
  });
  return (
    <div className="flex flex-col gap-4">
      <KpiRow>
        <Kpi label="Writes sampled" value={list.length} hint="the latest document writes" />
        <Kpi label="Awaiting review" value={list.filter((write) => write.status === "pr-opened").length} tone={list.some((write) => write.status === "pr-opened") ? "orange" : undefined} hint="open pull requests" />
        <Kpi label="Merged" value={list.filter((write) => write.status === "merged").length} tone="green" hint="reviewed and merged" />
        <Kpi label="Committed" value={list.filter((write) => write.status === "committed").length} tone="green" hint="auto-commit paths" />
        <Kpi label="Queued" value={list.filter((write) => write.status === "queued").length} tone={list.some((write) => write.status === "queued") ? "blue" : undefined} hint="waiting for the worker" />
        <Kpi label="Failed" value={failed} tone={failed > 0 ? "red" : "green"} higherIsWorse hint={failed > 0 ? "see the list below" : "none"} />
        <Kpi label="No changes" value={list.filter((write) => write.status === "unchanged").length} hint="nothing to write" />
      </KpiRow>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Section title="Writes per day" description="Last 14 days, by outcome." className="xl:col-span-3">
          {list.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-text-muted">No write yet.</p>
          ) : (
            <StackedColumns columns={columns} legend={statuses.map((status) => ({ label: status, color: WRITE_COLOR[status] ?? CHART_COLOR.muted }))} />
          )}
        </Section>
        <Section title="By kind and project" description="What was written and where." className="xl:col-span-2">
          <div className="flex flex-col gap-4">
            <ShareBar segments={segmentsOf(kinds)} format={formatCount} />
            {projects.length === 0 ? null : <BarList format={formatCount} color={CHART_COLOR.teal} rows={projects.map((entry) => ({ key: entry.key, label: entry.key, value: entry.count }))} />}
          </div>
        </Section>
      </div>
    </div>
  );
}

function WorkerInsights(): React.JSX.Element | null {
  const overview = useLoader("overview", monitoringApi.overview, { live: OVERVIEW_TOPICS, refresh: WORKER_AGES });
  const workers = useLoader("monitoring/workers", monitoringApi.workers, { live: ["workers"], refresh: WORKER_AGES });
  if (overview.data === undefined) return null;
  const { worker } = overview.data;
  const verdict = workerVerdict(worker);
  const queues = worker.queues ?? [];
  const list = workers.data ?? [];
  const totals = queues.reduce((sum, queue) => ({ queued: sum.queued + queue.queued, active: sum.active + queue.active, deferred: sum.deferred + queue.deferred }), { queued: 0, active: 0, deferred: 0 });
  return (
    <div className="flex flex-col gap-4">
      <KpiRow>
        <Kpi label="Worker" value={undefined} display={verdict.label} hint={verdict.detail} tone={verdict.tone} />
        <Kpi label="Processes up" value={worker.workersUp} hint={`${list.length} seen in total`} />
        <Kpi label="Active jobs" value={list.reduce((sum, entry) => sum + entry.activeJobs, 0)} hint="across the workers" tone={totals.active > 0 ? "blue" : undefined} />
        <Kpi label="Queued" value={worker.queues === null ? undefined : totals.queued} hint={totals.deferred > 0 ? `${totals.deferred} deferred` : "waiting for a worker"} tone={totals.queued > 0 ? "orange" : undefined} />
        <Kpi label="Oldest queued run" value={undefined} display={worker.oldestQueuedRunAt === undefined ? "None" : formatRelative(worker.oldestQueuedRunAt)} hint="waiting time" />
        <Kpi label="Last repository sync" value={undefined} display={worker.lastGitSyncAt === undefined ? "Never" : formatRelative(worker.lastGitSyncAt)} />
      </KpiRow>
      {queues.length === 0 ? null : (
        <Section title="Queue depth" description="Jobs per queue: waiting, running and deferred.">
          <StackedColumns
            height={96}
            columns={queues.map((queue) => ({
              label: queue.name,
              title: `${queue.name}: ${queue.queued} queued, ${queue.active} active, ${queue.deferred} deferred`,
              segments: [
                { label: "Queued", value: queue.queued, color: CHART_COLOR.orange },
                { label: "Active", value: queue.active, color: CHART_COLOR.blue },
                { label: "Deferred", value: queue.deferred, color: CHART_COLOR.muted },
              ],
            }))}
            legend={[
              { label: "Queued", color: CHART_COLOR.orange },
              { label: "Active", color: CHART_COLOR.blue },
              { label: "Deferred", color: CHART_COLOR.muted },
            ]}
          />
        </Section>
      )}
    </div>
  );
}
