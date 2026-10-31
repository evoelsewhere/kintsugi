// Monitoring — live state across all projects, refreshing on its own: job runs (status and
// project filters, durations, the agent or script that ran), the sync status of every
// registered repository, document writes, and the runtime: the workers (heartbeats) with their queues and the
// job workspaces on disk (ADR-0058).
// URL: /monitoring?tab=runs|repositories|writes|runtime&status=<filter>

import { Activity, FolderGit2, GitCommitHorizontal, Play, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DocumentWriteList } from "@/components/document-write-list";
import { JobRunList } from "@/components/job-runs/job-run-list";
import { RunListControls } from "@/components/job-runs/run-list-controls";
import { filterJobRuns, RUN_FILTERS } from "@/components/job-runs/run-model";
import { Loaded } from "@/components/loaded";
import { PageHeader } from "@/components/page-header";
import { SyncStatusBadge, WorkerStateBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { StatusDot } from "@/components/ui/status-dot";
import { Chips, Tabs } from "@/components/ui/tabs";
import type { Page } from "@/lib/api";
import { type JobRunView, jobRunsApi } from "@/lib/api/job-runs";
import { type DocumentWriteStatus, type MonitoredRepository, monitoringApi, type WorkerStatus } from "@/lib/api/monitoring";
import { projectsApi } from "@/lib/api/projects";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatRelative, shortSha } from "@/lib/format";
import { type MonitoringTab } from "@/lib/links";
import { OVERVIEW_TOPICS, WORKER_AGES } from "@/lib/live";
import { useLoader } from "@/lib/use-loader";
import { splitWorkers, workerVerdict } from "@/lib/worker-health";
import { MonitoringInsights } from "./monitoring-insights";
import { MembersView } from "./monitoring-members";
import { SandboxView } from "./monitoring-sandbox";

const TABS: { id: MonitoringTab; label: string }[] = [
  { id: "runs", label: "Job runs" },
  { id: "repositories", label: "Repositories" },
  { id: "writes", label: "Document writes" },
  { id: "runtime", label: "Runtime" },
];

const PAGE_SIZE = 25;

export function MonitoringPage(): React.JSX.Element {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs = can("member.activity.view") ? [...TABS, { id: "members" as const, label: "Members" }] : TABS;
  const tab = (tabs.find((entry) => entry.id === params.get("tab"))?.id ?? "runs") satisfies MonitoringTab;
  const status = params.get("status") ?? "";
  const setQuery = (patch: Record<string, string | null>): void =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(patch)) {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        crumbs={["Monitoring"]}
        title="Monitoring"
        description="Live job runs, repository sync, document writes, the worker and the job workspaces across all projects. Lists refresh on their own."
      />
      <Tabs label="Monitoring views" tabs={tabs} value={tab} onChange={(id) => setQuery({ tab: id, status: null })} />
      <MonitoringInsights tab={tab} />
      {tab === "runs" ? <RunsView status={status} /> : null}
      {tab === "repositories" ? <RepositoriesView /> : null}
      {tab === "writes" ? <WritesView status={status} onStatus={(value) => setQuery({ status: value })} /> : null}
      {tab === "members" ? <MembersView /> : null}
      {tab === "runtime" ? (
        <>
          <WorkerView />
          <SandboxView />
        </>
      ) : null}
    </div>
  );
}

function ProjectFilter({ value, onChange }: { value: string; onChange: (value: string) => void }): React.JSX.Element {
  const projects = useLoader("projects", projectsApi.list);
  return (
    <div className="w-56">
      <Select
        size="small"
        value={value}
        options={[
          { value: "", label: "All projects" },
          ...(projects.data ?? []).map((project) => ({ value: project.id, label: project.name, hint: project.id })),
        ]}
        onChange={onChange}
      />
    </div>
  );
}

function Pager({
  page,
  offset,
  onOffset,
}: {
  page: Page<unknown>;
  offset: number;
  onOffset: (offset: number) => void;
}): React.JSX.Element | null {
  if (page.total <= page.limit) return null;
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-[12px] text-text-muted">
      <span>
        {offset + 1}–{Math.min(offset + page.limit, page.total)} of {page.total}
      </span>
      <Button size="small" variant="ghost" disabled={offset === 0} onClick={() => onOffset(Math.max(0, offset - page.limit))}>
        Previous
      </Button>
      <Button size="small" variant="ghost" disabled={offset + page.limit >= page.total} onClick={() => onOffset(offset + page.limit)}>
        Next
      </Button>
    </div>
  );
}

function RunsView({ status }: { status: string }): React.JSX.Element {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const projectId = params.get("project") ?? "";
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  const search = params.get("q") ?? "";
  const filter = RUN_FILTERS.find((entry) => entry.id === status) ?? RUN_FILTERS[0]!;
  const update = (patch: Record<string, string | undefined>): void =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined || value === "") next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  const runs = useLoader<Page<JobRunView>>(
    `runs/${filter.id}/${projectId}/${offset}`,
    () => jobRunsApi.listAll({ status: filter.statuses, ...(projectId === "" ? {} : { projectId }), limit: PAGE_SIZE, offset }),
    { live: ["job-runs", "document-writes"] },
  );
  const visibleRuns = filterJobRuns(runs.data?.items ?? [], filter.id, search);
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-medium text-text">Job runs</h2>
          <p className="mt-1 text-[13px] text-text-secondary">
            Compare execution status across projects. Open a run for its console and output.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ProjectFilter value={projectId} onChange={(value) => update({ project: value, offset: undefined })} />
          <Button size="icon" className="shadow-border" aria-label="Refresh job runs" onClick={() => void runs.reload()}>
            <RefreshCw />
          </Button>
        </div>
      </header>
      <RunListControls
        filter={filter.id}
        onFilter={(value) => {
          update({ status: value, offset: undefined });
        }}
        search={search}
        onSearch={(value) => update({ q: value })}
        searchLabel="Search job runs on this page"
        placeholder="Search this page by run, actor or error…"
      />
      <Loaded loader={runs} rows={6}>
        {(page) => (
          <>
            {visibleRuns.length === 0 ? (
              <EmptyState
                icon={Play}
                title={page.total === 0 && filter.id === "" ? "No job runs yet" : "No matching runs"}
                description={
                  page.total === 0 && filter.id === ""
                    ? "Start a stage in Delivery to see its runs here."
                    : "Choose another status or clear your search."
                }
                action={
                  page.total === 0 && filter.id === "" && search === "" ? (
                    <Link to="/delivery" className="text-[13px] text-accent hover:underline">
                      Open Delivery
                    </Link>
                  ) : (
                    <Button
                      size="small"
                      onClick={() => {
                        update({ q: undefined, offset: undefined, status: undefined });
                      }}
                    >
                      Clear filters
                    </Button>
                  )
                }
              />
            ) : null}
            <JobRunList
              projectId={projectId || undefined}
              runs={visibleRuns}
              canCancel={can("jobs.run")}
              canRetry={can("jobs.run")}
              showProject
              onChanged={() => void runs.reload()}
            />
            <div className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-text-secondary">
              <p>{search === "" ? `${page.total} runs` : `${visibleRuns.length} matches on this page`} · newest first</p>
              <Pager page={page} offset={offset} onOffset={(value) => update({ offset: String(value) })} />
            </div>
          </>
        )}
      </Loaded>
    </section>
  );
}

function RepositoriesView(): React.JSX.Element {
  const repositories = useLoader("monitoring/repositories", monitoringApi.repositories, {
    live: ["repositories"],
  });
  return (
    <Card className="overflow-hidden p-0">
      <CardHeader className="px-4 pt-3">
        <div>
          <CardTitle>Repositories</CardTitle>
          <CardDescription>
            Mirrors the worker keeps of every registered repository; repositories that are not ready yet refresh every few seconds.
          </CardDescription>
        </div>
        <Button size="icon" variant="ghost" aria-label="Refresh repositories" onClick={() => void repositories.reload()}>
          <RefreshCw className="size-4" />
        </Button>
      </CardHeader>
      <div className="mt-2">
        <Loaded loader={repositories} rows={4}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState
                icon={FolderGit2}
                title="No repositories registered"
                description="Repositories are registered in Settings → Git by someone with git.manage."
              />
            ) : (
              <RepositoryTable repositories={list} />
            )
          }
        </Loaded>
      </div>
    </Card>
  );
}

function RepositoryTable({ repositories }: { repositories: MonitoredRepository[] }): React.JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-[13px]">
        <thead className="text-[11px] tracking-wide text-text-muted uppercase">
          <tr>
            <th className="px-4 py-1.5 font-normal">Repository</th>
            <th className="px-2 py-1.5 font-normal">Status</th>
            <th className="px-2 py-1.5 font-normal">Last commit</th>
            <th className="px-2 py-1.5 font-normal">Last synced</th>
            <th className="px-4 py-1.5 font-normal">Used by</th>
          </tr>
        </thead>
        <tbody>
          {repositories.map((repository) => (
            <tr key={repository.id} className="align-top [box-shadow:0_-1px_0_rgba(0,0,0,0.06)]">
              <td className="px-4 py-2.5">
                <p className="text-text">{repository.id}</p>
                <p className="max-w-[320px] truncate text-[11px] text-text-muted" title={repository.url}>
                  {repository.serverId} · {repository.url}
                  {repository.defaultBranch === undefined ? "" : ` · ${repository.defaultBranch}`}
                </p>
                {repository.lastError === undefined ? null : (
                  <p className="mt-0.5 max-w-[420px] break-words text-[12px] text-[var(--ds-status-red)]">{repository.lastError}</p>
                )}
              </td>
              <td className="px-2 py-2.5">
                <SyncStatusBadge status={repository.syncStatus} />
              </td>
              <td className="px-2 py-2.5 font-mono text-[12px] text-text-secondary">{shortSha(repository.lastCommit)}</td>
              <td className="px-2 py-2.5 text-[12px] text-text-secondary" title={formatDateTime(repository.lastSyncedAt)}>
                {repository.lastSyncedAt === undefined ? "Never" : formatRelative(repository.lastSyncedAt)}
              </td>
              <td className="px-4 py-2.5 text-[12px] text-text-secondary">
                {repository.projects.length === 0 ? (
                  <span className="text-text-muted">Not linked</span>
                ) : (
                  repository.projects.map((link) => (
                    <p key={`${link.projectId}-${link.applicationId ?? ""}-${link.role}`}>
                      {link.projectId}
                      {link.applicationId === undefined ? "" : ` / ${link.applicationId}`} · {link.role}
                      {link.component === undefined ? "" : ` (${link.component})`}
                    </p>
                  ))
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const WRITE_FILTERS: { id: string; label: string; statuses: DocumentWriteStatus[] }[] = [
  { id: "", label: "All", statuses: [] },
  { id: "queued", label: "Queued", statuses: ["queued"] },
  { id: "pr-opened", label: "Open pull requests", statuses: ["pr-opened"] },
  { id: "merged", label: "Merged", statuses: ["merged"] },
  { id: "committed", label: "Committed", statuses: ["committed"] },
  { id: "failed", label: "Failed", statuses: ["failed"] },
];

function WritesView({ status, onStatus }: { status: string; onStatus: (value: string) => void }): React.JSX.Element {
  const [projectId, setProjectId] = useState("");
  const [offset, setOffset] = useState(0);
  const filter = WRITE_FILTERS.find((entry) => entry.id === status) ?? WRITE_FILTERS[0]!;
  const writes = useLoader(
    `writes/${filter.id}/${projectId}/${offset}`,
    () => monitoringApi.documentWrites({ status: filter.statuses, ...(projectId === "" ? {} : { projectId }), limit: PAGE_SIZE, offset }),
    { live: ["document-writes"] },
  );
  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div>
          <CardTitle>Document writes</CardTitle>
          <CardDescription>Commits and pull requests by kintsugi-bot to the document repos, newest first.</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chips
            label="Write status"
            options={WRITE_FILTERS.map((entry) => ({ id: entry.id, label: entry.label }))}
            value={filter.id}
            onChange={(value) => {
              setOffset(0);
              onStatus(value);
            }}
          />
          <ProjectFilter
            value={projectId}
            onChange={(value) => {
              setOffset(0);
              setProjectId(value);
            }}
          />
          <Button size="icon" variant="ghost" aria-label="Refresh document writes" onClick={() => void writes.reload()}>
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <div className="mt-2">
        <Loaded loader={writes} rows={5}>
          {(page) =>
            page.items.length === 0 ? (
              <EmptyState
                icon={GitCommitHorizontal}
                title="No document writes"
                description="Writes appear when kintsugi.yaml is published or a stage run succeeds."
              />
            ) : (
              <>
                <DocumentWriteList writes={page.items} showProject />
                <Pager page={page} offset={offset} onOffset={setOffset} />
              </>
            )
          }
        </Loaded>
      </div>
    </Card>
  );
}

const QUEUE_PURPOSE: Record<string, string> = {
  "job-run": "Runtime job runs (stages, scripts, agent jobs)",
  "document-write": "Commits and pull requests to document repos",
  "git-sync": "Clones and fetches of registered repositories",
  "workspace-cleanup": "Removal of a job workspace asked for in Monitoring → Runtime",
};

function WorkerView(): React.JSX.Element {
  const overview = useLoader("overview", monitoringApi.overview, { live: OVERVIEW_TOPICS, refresh: WORKER_AGES });
  const workers = useLoader("monitoring/workers", monitoringApi.workers, { live: ["workers"], refresh: WORKER_AGES });
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Worker</CardTitle>
          <CardDescription>
            Each worker process sends a heartbeat every 15 seconds; a worker not seen for 45 seconds is reported as not running.
          </CardDescription>
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Refresh worker state"
          onClick={() => {
            void overview.reload();
            void workers.reload();
          }}
        >
          <RefreshCw className="size-4" />
        </Button>
      </CardHeader>
      <div className="mt-3">
        <Loaded loader={overview} rows={3}>
          {(data) => {
            const verdict = workerVerdict(data.worker);
            return (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-start gap-x-10 gap-y-3 text-[13px]">
                  <div>
                    <p className="text-[12px] text-text-muted">State</p>
                    <p className="flex items-center gap-2 text-text">
                      <StatusDot tone={verdict.tone} />
                      {verdict.label}
                    </p>
                    <p className="text-[12px] text-text-secondary">{verdict.detail}</p>
                  </div>
                  <div>
                    <p className="text-[12px] text-text-muted">Oldest queued stage run</p>
                    <p className="text-text" title={formatDateTime(data.worker.oldestQueuedRunAt)}>
                      {data.worker.oldestQueuedRunAt === undefined ? "None waiting" : formatRelative(data.worker.oldestQueuedRunAt)}
                    </p>
                    <p className="text-[12px] text-text-secondary">Stage and agent runs only; the queue table counts the jobs of every queue.</p>
                  </div>
                  <div>
                    <p className="text-[12px] text-text-muted">Last repository sync</p>
                    <p className="text-text" title={formatDateTime(data.worker.lastGitSyncAt)}>
                      {data.worker.lastGitSyncAt === undefined ? "Never" : formatRelative(data.worker.lastGitSyncAt)}
                    </p>
                  </div>
                </div>
                <Loaded loader={workers} rows={2}>
                  {(list) => <Workers workers={list} />}
                </Loaded>
                {data.worker.queues === null ? (
                  <EmptyState
                    icon={Activity}
                    title="Queue counts unavailable"
                    description="The API could not read the job queue. Runs and writes are still listed in the other tabs."
                  />
                ) : (
                  <table className="w-full text-left text-[13px]">
                    <thead className="text-[11px] tracking-wide text-text-muted uppercase">
                      <tr>
                        <th className="py-1.5 font-normal">Queue</th>
                        <th className="px-2 py-1.5 text-right font-normal">Queued</th>
                        <th className="px-2 py-1.5 text-right font-normal">Active</th>
                        <th className="py-1.5 text-right font-normal">Deferred</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.worker.queues.map((queue) => (
                        <tr key={queue.name} className="[box-shadow:0_-1px_0_rgba(0,0,0,0.06)]">
                          <td className="py-2">
                            <p className="font-mono text-[12px] text-text">{queue.name}</p>
                            <p className="text-[11px] text-text-muted">{QUEUE_PURPOSE[queue.name] ?? ""}</p>
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">{queue.queued}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{queue.active}</td>
                          <td className="py-2 text-right tabular-nums">{queue.deferred}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          }}
        </Loaded>
      </div>
    </Card>
  );
}

/** The workers running or seen in the last day; the ones stopped or gone for longer behind a toggle. */
function Workers({ workers }: { workers: WorkerStatus[] }): React.JSX.Element {
  const [showStopped, setShowStopped] = useState(false);
  const { current, stopped } = splitWorkers(workers);
  return (
    <div className="flex flex-col gap-1">
      {current.length === 0 && stopped.length > 0 && !showStopped ? (
        <p className="text-[12px] text-text-muted">No worker has been seen in the last 24 hours.</p>
      ) : (
        <WorkerTable workers={showStopped ? [...current, ...stopped] : current} />
      )}
      {stopped.length === 0 ? null : (
        <Button size="small" variant="link" className="h-auto self-start px-0 text-[12px]" aria-expanded={showStopped} onClick={() => setShowStopped((shown) => !shown)}>
          {showStopped ? "Hide" : "Show"} {stopped.length} stopped worker{stopped.length === 1 ? "" : "s"} not seen for more than 24 hours
        </Button>
      )}
    </div>
  );
}

function WorkerTable({ workers }: { workers: WorkerStatus[] }): React.JSX.Element {
  if (workers.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="No worker has reported yet"
        description="Start kintsugi-worker; it appears here within 15 seconds."
      />
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-[13px]">
        <thead className="text-[11px] tracking-wide text-text-muted uppercase">
          <tr>
            <th className="py-1.5 pr-2 font-normal">Worker</th>
            <th className="px-2 py-1.5 font-normal">State</th>
            <th className="px-2 py-1.5 font-normal">Last heartbeat</th>
            <th className="px-2 py-1.5 font-normal">Started</th>
            <th className="px-2 py-1.5 text-right font-normal">Active jobs</th>
            <th className="py-1.5 pl-2 font-normal">Queues</th>
          </tr>
        </thead>
        <tbody>
          {workers.map((worker) => (
            <tr key={worker.workerId} className="align-top [box-shadow:0_-1px_0_rgba(0,0,0,0.06)]">
              <td className="py-2 pr-2">
                <p className="text-text">
                  {worker.host} <span className="text-text-muted">· pid {worker.pid}</span>
                </p>
                <p className="font-mono text-[11px] text-text-muted" title={worker.workerId}>
                  {worker.version} · {worker.workerId.slice(0, 8)}
                </p>
              </td>
              <td className="px-2 py-2">
                <WorkerStateBadge
                  state={worker.state}
                  {...(worker.stoppedAt === undefined ? {} : { title: `Stopped ${formatDateTime(worker.stoppedAt)}` })}
                />
              </td>
              <td className="px-2 py-2 text-[12px] text-text-secondary" title={formatDateTime(worker.lastSeenAt)}>
                {formatRelative(worker.lastSeenAt)}
              </td>
              <td className="px-2 py-2 text-[12px] text-text-secondary" title={formatDateTime(worker.startedAt)}>
                {formatRelative(worker.startedAt)}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">{worker.state === "up" ? worker.activeJobs : "—"}</td>
              <td className="py-2 pl-2 font-mono text-[11px] text-text-secondary">{worker.queues.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
