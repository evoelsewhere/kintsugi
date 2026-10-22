// Overview — the installation at a glance, from real data only (GET /api/monitoring/overview):
// key figures, what needs attention now (failed or stuck runs, failed document writes,
// repositories that do not sync, gates waiting for a decision, no worker running) and the
// recent activity. Refreshes itself, faster while
// runs are active.

import { AlertTriangle, CircleCheck, Clock, FolderKanban, FolderGit2, GitPullRequestArrow, Play, PowerOff, RefreshCw, ShieldQuestion } from "lucide-react";
import { Link } from "react-router-dom";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Loaded } from "@/components/loaded";
import { PageHeading } from "@/components/page-heading";
import { RunStatusBadge, WriteStatusBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import { type ActivityItem, type AttentionItem, monitoringApi, type MonitoringOverview, type OverviewCounts } from "@/lib/api/monitoring";
import { APP_VERSION } from "@/lib/app-info";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatRelative } from "@/lib/format";
import { deliveryLink, governanceLink, monitoringLink } from "@/lib/links";
import { useHealth } from "@/lib/use-health";
import { useLoader } from "@/lib/use-loader";
import { workerVerdict } from "@/lib/worker-health";
import { Portfolio } from "./overview-portfolio";


export function OverviewPage(): React.JSX.Element {
  const overview = useLoader("overview", monitoringApi.overview, { refresh: (data) => (data.counts.activeRuns > 0 ? 5000 : 20000) });
  const counts = overview.data?.counts;
  const { can } = useAuth();

  return (
    <div className="flex flex-col gap-5">
      <Breadcrumbs items={["Overview"]} />
      <PageHeading
        title="Overview"
        description="The modernization portfolio: what was found, how much is understood and how far each application is."
        actions={
          <Button size="small" variant="ghost" onClick={() => void overview.reload()}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        }
      />

      <Portfolio />

      <Operations counts={counts} />

      {counts?.projects === 0 ? (
        <Card>
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description="A project groups the applications to modernize, their legacy and target repositories and the document repo that receives Kintsugi's output."
            action={
              can("projects.manage") ? (
                <Link to="/projects" className="text-[13px] text-accent hover:underline">
                  Create the first project in Administration → Projects
                </Link>
              ) : (
                <span className="text-[12px] text-text-muted">Ask an administrator to create one.</span>
              )
            }
          />
        </Card>
      ) : null}

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Needs attention</CardTitle>
              <CardDescription>Failed and stuck runs, failed document writes, repositories that do not sync, pending gates and a stopped worker.</CardDescription>
            </div>
          </CardHeader>
          <div className="mt-3">
            <Loaded loader={overview} rows={3}>
              {(data) => <AttentionList items={data.attention} />}
            </Loaded>
          </div>
        </Card>
        <SystemCard overview={overview.data} />
      </section>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Job runs and writes to document repos, newest first.</CardDescription>
          </div>
          <Link to={monitoringLink("runs")} className="shrink-0 text-[12px] text-accent hover:underline">
            All job runs
          </Link>
        </CardHeader>
        <div className="mt-3">
          <Loaded loader={overview} rows={5}>
            {(data) => <ActivityList items={data.activity} />}
          </Loaded>
        </div>
      </Card>
    </div>
  );
}

const ATTENTION: Record<AttentionItem["kind"], { icon: typeof AlertTriangle; tone: StatusTone; label: string }> = {
  "run-failed": { icon: AlertTriangle, tone: "red", label: "Run failed" },
  "run-stuck": { icon: Clock, tone: "orange", label: "Run waiting" },
  "write-failed": { icon: GitPullRequestArrow, tone: "red", label: "Write failed" },
  "repository-error": { icon: FolderGit2, tone: "red", label: "Sync failed" },
  "gate-pending": { icon: ShieldQuestion, tone: "orange", label: "Gate pending" },
  "worker-down": { icon: PowerOff, tone: "red", label: "Worker down" },
};

function attentionLink(item: AttentionItem): string {
  switch (item.kind) {
    case "run-failed":
      return deliveryLink({ projectId: item.projectId, applicationId: item.applicationId, runId: item.jobRunId });
    case "run-stuck":
      return monitoringLink("runtime");
    case "write-failed":
      return deliveryLink({ projectId: item.projectId, section: "writes" });
    case "repository-error":
      return monitoringLink("repositories");
    case "gate-pending":
      return governanceLink("gates", "pending");
    case "worker-down":
      return monitoringLink("runtime");
  }
}

function AttentionList({ items }: { items: AttentionItem[] }): React.JSX.Element {
  if (items.length === 0) {
    return <EmptyState icon={CircleCheck} title="All clear" description="No failed or waiting runs, no failed document writes, every repository syncs, no gate is waiting and the worker is up." />;
  }
  return (
    <ul className="flex flex-col">
      {items.map((item, index) => {
        const style = ATTENTION[item.kind];
        const Icon = style.icon;
        return (
          <li key={`${item.kind}-${item.jobRunId ?? item.documentWriteId ?? item.repositoryId ?? item.gateId ?? index}`} className={index > 0 ? "[box-shadow:0_-1px_0_rgba(0,0,0,0.06)]" : undefined}>
            <Link to={attentionLink(item)} className="flex items-start gap-3 rounded-[var(--geist-radius)] px-2 py-2 hover:bg-hover">
              <Icon className="mt-0.5 size-4 shrink-0 text-text-secondary" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-[13px] text-text">
                  <span className="inline-flex items-center gap-1.5 text-[12px] text-text-secondary">
                    <StatusDot tone={style.tone} className="size-2" />
                    {style.label}
                  </span>
                  <span className="min-w-0 truncate font-medium">{item.title}</span>
                </p>
                {item.detail === undefined ? null : <p className="mt-0.5 line-clamp-2 break-words text-[12px] text-text-secondary">{item.detail}</p>}
                <p className="mt-0.5 text-[11px] text-text-muted" title={formatDateTime(item.at)}>
                  {formatRelative(item.at)}
                  {item.projectId === undefined ? "" : ` · ${item.projectId}`}
                  {item.applicationId === undefined ? "" : ` / ${item.applicationId}`}
                  {item.repositoryId === undefined ? "" : ` · ${item.repositoryId}`}
                </p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ActivityList({ items }: { items: ActivityItem[] }): React.JSX.Element {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Play}
        title="No activity yet"
        description="Job runs and document writes appear here. Start the assess stage of an application in Delivery."
        action={
          <Link to="/delivery" className="text-[13px] text-accent hover:underline">
            Open Delivery
          </Link>
        }
      />
    );
  }
  // Repeated runs with the same title and outcome (a cancelled batch, retries) read as one line.
  const grouped = items.reduce<Array<{ item: ActivityItem; repeats: number }>>((list, item) => {
    const last = list.at(-1);
    if (last !== undefined && item.kind === "run" && last.item.kind === "run" && last.item.title === item.title && last.item.status === item.status && last.item.projectId === item.projectId) last.repeats += 1;
    else list.push({ item, repeats: 1 });
    return list;
  }, []);
  return (
    <ol className="flex flex-col">
      {grouped.slice(0, 8).map(({ item, repeats }, index, shown) => (
        <li key={`${item.kind}-${item.jobRunId ?? item.documentWriteId ?? index}`} className="relative flex gap-3 pb-3 pl-1 last:pb-0">
          {/* Timeline rail */}
          {index < shown.length - 1 ? <span aria-hidden className="absolute top-5 bottom-0 left-[7px] w-px bg-black/10 dark:bg-white/10" /> : null}
          <span className="relative mt-1.5 flex size-3 shrink-0 items-center justify-center rounded-full bg-surface">
            <span className="size-2 rounded-full bg-text-muted" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={item.kind === "run" ? deliveryLink({ projectId: item.projectId, applicationId: item.applicationId, runId: item.jobRunId }) : deliveryLink({ projectId: item.projectId, section: "writes" })}
                className="min-w-0 truncate text-[13px] text-text hover:underline"
              >
                {item.title}
              </Link>
              {item.kind === "run" ? <RunStatusBadge status={item.status} /> : <WriteStatusBadge status={item.status} />}
              {repeats > 1 ? <span className="text-[12px] text-text-muted tabular-nums">× {repeats}</span> : null}
              {item.prUrl === undefined ? null : (
                <a href={item.prUrl} target="_blank" rel="noreferrer" className="text-[12px] text-accent hover:underline">
                  Pull request
                </a>
              )}
            </div>
            <p className="mt-0.5 truncate text-[11px] text-text-muted" title={formatDateTime(item.at)}>
              {formatRelative(item.at)} · {item.kind === "run" ? "job run" : "document write"} · {item.projectId}
              {item.applicationId === undefined ? "" : ` / ${item.applicationId}`}
              {item.actor === undefined ? "" : ` · by ${item.actor}`}
              {item.branch === undefined ? "" : ` · ${item.branch}`}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function SystemCard({ overview }: { overview: MonitoringOverview | undefined }): React.JSX.Element {
  const health = useHealth();
  const verdict = overview === undefined ? undefined : workerVerdict(overview.worker);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>System</CardTitle>
          <CardDescription>API, worker and the portal itself.</CardDescription>
        </div>
        <Link to={monitoringLink("runtime")} className="shrink-0 text-[12px] text-accent hover:underline">
          Details
        </Link>
      </CardHeader>
      <ul className="mt-3 flex flex-col gap-3 text-[13px]">
        <li className="flex items-center gap-3">
          <StatusDot tone={health === "up" ? "green" : health === "down" ? "red" : "orange"} />
          <span className="text-text">API</span>
          <span className="ml-auto text-[12px] text-text-secondary">{health === "up" ? "Reachable" : health === "down" ? "Unreachable" : "Checking…"}</span>
        </li>
        <li className="flex items-start gap-3">
          <StatusDot tone={verdict?.tone ?? "muted"} className="mt-1" />
          <span className="text-text">Worker</span>
          <span className="ml-auto text-right text-[12px] text-text-secondary">
            {verdict === undefined ? "…" : verdict.label}
            {verdict === undefined ? null : <span className="block text-[11px] text-text-muted">{verdict.detail}</span>}
          </span>
        </li>
        <li className="flex items-center gap-3">
          <StatusDot tone={overview?.worker.lastGitSyncAt === undefined ? "muted" : "green"} />
          <span className="text-text">Last repository sync</span>
          <span className="ml-auto text-[12px] text-text-secondary" title={formatDateTime(overview?.worker.lastGitSyncAt)}>
            {overview === undefined ? "…" : overview.worker.lastGitSyncAt === undefined ? "Never" : formatRelative(overview.worker.lastGitSyncAt)}
          </span>
        </li>
        <li className="flex items-center gap-3">
          <StatusDot tone="muted" />
          <span className="text-text">Portal</span>
          <span className="ml-auto text-[12px] text-text-secondary">{APP_VERSION}</span>
        </li>
      </ul>
    </Card>
  );
}

type Tone = StatusTone;

/** One line of operational health: each figure links to its Monitoring tab. Detail and charts live there. */
function Operations({ counts }: { counts: OverviewCounts | undefined }): React.JSX.Element {
  const items: Array<{ label: string; value: string; tone: Tone; to: string; busy?: "spin" }> =
    counts === undefined
      ? []
      : [
          { label: "Active runs", value: String(counts.activeRuns), tone: counts.activeRuns > 0 ? "blue" : "muted", to: monitoringLink("runs", "queued,running"), ...(counts.activeRuns > 0 ? { busy: "spin" as const } : {}) },
          { label: "Failed runs · 24 h", value: String(counts.failedRuns24h), tone: counts.failedRuns24h > 0 ? "red" : "green", to: monitoringLink("runs", "failed") },
          { label: "Pending writes", value: String(counts.pendingWrites), tone: counts.failedWrites24h > 0 ? "red" : counts.pendingWrites > 0 ? "blue" : "green", to: monitoringLink("writes") },
          { label: "Repository errors", value: String(counts.repositoriesWithErrors), tone: counts.repositoriesWithErrors > 0 ? "red" : counts.repositoriesNotReady > 0 ? "orange" : "green", to: monitoringLink("repositories") },
          { label: "Pending gates", value: String(counts.pendingGates), tone: counts.pendingGates > 0 ? "orange" : "green", to: governanceLink("gates", "pending") },
        ];
  return (
    <nav aria-label="Operations" className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-surface px-4 py-2.5 shadow-border-medium">
      <span className="text-[10px] tracking-wide text-text-muted uppercase">Operations</span>
      {items.map((item) => (
        <Link key={item.label} to={item.to} className="flex items-center gap-1.5 rounded-[6px] text-[12.5px] text-text-secondary hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
          <StatusDot tone={item.tone} busy={item.busy} className="size-2" />
          <span className="font-medium text-text tabular-nums">{item.value}</span>
          {item.label}
        </Link>
      ))}
      <Link to="/monitoring" className="ml-auto text-[12px] text-accent hover:underline">
        Monitoring →
      </Link>
    </nav>
  );
}
