// A runtime stage of one application (ADR-0027): the header (status, Run), then three tabs —
// Results (what the stage produced, read from the document repo; the default once any output
// exists), Runs & logs (its job runs with steps, live log, artifacts, cancel, and the latest
// output) and Inputs & agents (paths it reads and writes, agents and bindings, decision points).
// URL: …&tab=results|runs|inputs (&run=<id> opens Runs & logs on that run).

import { FileText, Play } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { JobRunList } from "@/components/job-runs/job-run-list";
import { Loaded } from "@/components/loaded";
import { RunStatusBadge, StatusBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { agentsApi } from "@/lib/api/agents";
import { hasResultsView } from "@/lib/api/documents";
import { type JobRunDetail, type JobRunView, jobRunsApi, type StageView } from "@/lib/api/job-runs";
import { type ApplicationView, type DocumentWriteView, type ProjectDetail, projectsApi } from "@/lib/api/projects";
import { useAuth } from "@/lib/auth";
import { formatBytes, formatDateTime, formatDuration, formatRelative, shortSha } from "@/lib/format";
import { isActiveStatus } from "@/lib/status";
import { agentProblems, runBlocker, runsOfStage, stageLabel } from "@/lib/stages";
import { type Loader, useLoader } from "@/lib/use-loader";
import { ApplicationFacts } from "./delivery-shell";
import { DecisionPoints, StageAgents, StagePaths } from "./stage-parts";

const RUN_LIMIT = 100;

// The result views and their libraries (Markdown, Mermaid) load with the Results tab.
const StageResults = lazy(() => import("./results/stage-results"));
// The item catalog of the assess stage (ADR-0033).
const CatalogTab = lazy(() => import("./results/catalog-tab"));

type StageTab = "results" | "catalog" | "runs" | "inputs";

export function RuntimeStage({ project, application, stage }: { project: ProjectDetail; application: ApplicationView; stage: StageView }): React.JSX.Element {
  const { can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [confirming, setConfirming] = useState(false);
  // The run list has no stage filter: the application's recent runs are filtered here.
  const runs = useLoader(`runs/${project.id}/${application.id}`, async () => (await jobRunsApi.list(project.id, application.id, RUN_LIMIT)).items, {
    refresh: (list) => (list.some((run) => isActiveStatus(run.status) || run.documentWrite?.status === "queued") ? 3000 : 30000),
  });
  const writes = useLoader(`writes/${project.id}`, async () => (await projectsApi.documentWrites(project.id, 30)).items, {
    refresh: (list) => (list.some((write) => write.status === "queued") ? 3000 : 30000),
  });
  const agents = useLoader("agents", agentsApi.list);

  const stageRuns = runs.data === undefined ? undefined : runsOfStage(runs.data, stage.id);
  const latest = stageRuns?.[0];
  const latestSucceeded = stageRuns?.find((run) => run.status === "succeeded");
  const latestDetail = useLoader(`latest/${project.id}/${latestSucceeded?.id ?? "none"}/${latestSucceeded?.documentWrite?.status ?? ""}`, () =>
    latestSucceeded === undefined ? Promise.resolve(null) : jobRunsApi.get(project.id, latestSucceeded.id),
  );

  const withResults = hasResultsView(stage.id);
  const withCatalog = stage.id === "assess";
  const requested = params.get("tab");
  const tab: StageTab =
    requested === "runs" || requested === "inputs" || (requested === "results" && withResults) || (requested === "catalog" && withCatalog)
      ? requested
      : params.get("run") !== null
        ? "runs"
        : withResults && (stageRuns === undefined || latestSucceeded !== undefined)
          ? "results"
          : "runs";
  const chooseTab = (next: StageTab): void =>
    setParams(
      (previous) => {
        const query = new URLSearchParams(previous);
        query.set("tab", next);
        return query;
      },
      { replace: true },
    );

  const active = latest !== undefined && isActiveStatus(latest.status);
  const blocked = runBlocker(project, application);
  const disabledReason = !stage.runnable
    ? "This stage is not wired in the orchestrator yet."
    : !can("jobs.run")
      ? "Starting a stage needs the jobs.run permission."
      : (blocked ?? (active ? "A run of this stage is active: wait for it or cancel it below." : undefined));
  const problems = agentProblems(stage, agents.data);

  async function run(): Promise<void> {
    const queued = await jobRunsApi.runStage(project.id, application.id, stage.id);
    toast.success(`Stage ${stage.id} queued`, `${application.name} · the worker starts it shortly.`);
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("run", queued.id);
        next.set("tab", "runs");
        return next;
      },
      { replace: true },
    );
    await runs.reload();
  }

  const initialRun = params.get("run") ?? undefined;

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[15px] font-medium text-text">{stageLabel(stage.id)}</p>
              <span className="font-mono text-[11px] text-text-muted">/{stage.command}</span>
              {stage.runnable ? null : <StatusBadge tone="muted" label="Coming soon" />}
            </div>
            <p className="mt-1 text-[13px] text-text-secondary">{stage.description}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              {latest === undefined ? (
                <span className="text-[12px] text-text-muted">{runs.data === undefined ? "" : "Never run"}</span>
              ) : (
                <span className="flex items-center gap-1.5" title={formatDateTime(latest.createdAt)}>
                  <RunStatusBadge status={latest.status} cancelling={latest.cancelRequestedAt !== undefined && latest.status === "running"} />
                  <span className="text-[12px] text-text-muted">
                    {formatRelative(latest.createdAt)}
                    {latest.startedAt === undefined ? "" : ` · ${isActiveStatus(latest.status) ? "running for " : "took "}${formatDuration(latest.startedAt, latest.finishedAt)}`}
                  </span>
                </span>
              )}
              <Button size="small" variant="solid" disabled={disabledReason !== undefined || runs.data === undefined} onClick={() => setConfirming(true)}>
                <Play className="size-3.5" />
                Run
              </Button>
            </div>
            {disabledReason === undefined ? null : <p className="max-w-xs text-right text-[11px] text-text-muted">{disabledReason}</p>}
          </div>
        </div>
        <div className="mt-4 [box-shadow:0_-1px_0_rgba(0,0,0,0.06)] pt-3">
          <ApplicationFacts project={project} application={application} />
        </div>
        {problems.length === 0 ? null : <p className="mt-3 text-[12px] text-text-secondary">Check the agents below before running: {problems.join("; ")}. Their jobs fail until this is fixed.</p>}
      </Card>

      <Tabs<StageTab>
        label={`${stage.id} sections`}
        value={tab}
        onChange={chooseTab}
        tabs={[
          ...(withResults ? [{ id: "results" as const, label: "Results" }] : []),
          ...(withCatalog ? [{ id: "catalog" as const, label: "Catalog" }] : []),
          { id: "runs" as const, label: "Runs & logs", count: stageRuns?.length },
          { id: "inputs" as const, label: "Inputs & agents" },
        ]}
      />

      {tab === "results" && hasResultsView(stage.id) ? (
        <Suspense fallback={<Card><SkeletonRows rows={6} /></Card>}>
          <StageResults
            project={project}
            application={application}
            stage={stage.id}
            version={`${latestSucceeded?.id ?? "none"}/${latestSucceeded?.documentWrite?.status ?? ""}`}
            runBlocked={disabledReason}
            runs={stageRuns}
          />
        </Suspense>
      ) : null}

      {tab === "catalog" && withCatalog ? (
        <Suspense fallback={<Card><SkeletonRows rows={6} /></Card>}>
          <CatalogTab project={project} application={application} version={`${latestSucceeded?.id ?? "none"}/${latestSucceeded?.documentWrite?.status ?? ""}/${latest?.id ?? ""}`} />
        </Suspense>
      ) : null}

      {tab === "inputs" ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <StagePaths
            stage={stage}
            applicationId={application.id}
            documentRepository={project.documentRepository?.repositoryId}
            produced={latestDetail.data?.artifacts.map((artifact) => artifact.path)}
            write={latestSucceeded?.documentWrite}
          />
          <div className="flex flex-col gap-5">
            <StageAgents stage={stage} agents={agents} />
            <DecisionPoints stage={stage} />
          </div>
        </div>
      ) : null}

      {tab === "runs" ? (
        <>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Job runs</CardTitle>
                <CardDescription>Runs of {stage.id} for {application.name}: open one for its steps, artifacts and live log. Active runs refresh on their own.</CardDescription>
              </div>
            </CardHeader>
            <div className="mt-2">
              <Loaded loader={runs} rows={3}>
                {() =>
                  stageRuns === undefined || stageRuns.length === 0 ? (
                    <EmptyState
                      icon={Play}
                      title={`${stage.id} has not run for ${application.name}`}
                      description={disabledReason ?? "Run the stage above; its jobs, live log and outputs appear here."}
                    />
                  ) : (
                    <JobRunList
                      key={initialRun ?? "none"}
                      runs={stageRuns}
                      canCancel={can("jobs.run")}
                      initialOpen={initialRun}
                      onChanged={() => {
                        void runs.reload();
                        void writes.reload();
                      }}
                    />
                  )
                }
              </Loaded>
            </div>
          </Card>

          {latestSucceeded === undefined ? null : <LatestOutput run={latestSucceeded} detail={latestDetail} writes={writes.data} />}
        </>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title={`Run ${stage.id} for ${application.name}?`}
        confirmLabel="Run stage"
        busyLabel="Queuing…"
        confirmVariant="solid"
        onConfirm={run}
        onClose={() => setConfirming(false)}
      >
        <p>
          The worker reads {application.asIs.legacy[0]?.repositoryId ?? "the legacy repo"} read-only at its current commit and proposes the outputs to{" "}
          {project.documentRepository?.repositoryId ?? "the document repo"}
          {stage.agents.length === 0 ? "." : `, starting ${stage.agents.join(", ")}.`}
        </p>
        {problems.length === 0 ? null : <p className="mt-2 text-text">Warning: {problems.join("; ")}. Jobs of these agents fail.</p>}
      </ConfirmDialog>
    </div>
  );
}

/** The artifacts of the stage's latest successful run and where they went in the document repo. */
function LatestOutput({ run, detail, writes }: { run: JobRunView; detail: Loader<JobRunDetail | null>; writes: DocumentWriteView[] | undefined }): React.JSX.Element {
  const write = writes?.find((entry) => entry.id === run.documentWrite?.id);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Latest output in the document repo</CardTitle>
          <CardDescription>From the run of {formatDateTime(run.finishedAt ?? run.createdAt)}.</CardDescription>
        </div>
      </CardHeader>
      <div className="mt-3 flex flex-col gap-2">
        <Loaded loader={detail} rows={2}>
          {(loaded) =>
            loaded === null || loaded.artifacts.length === 0 ? (
              <p className="text-[12px] text-text-muted">The run produced no artifacts.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {loaded.artifacts.map((artifact) => (
                  <li key={artifact.path} className="flex items-center gap-2 text-[12px]">
                    <FileText className="size-4 shrink-0 text-text-muted" strokeWidth={1.5} />
                    <span className="min-w-0 truncate font-mono text-text">{artifact.path}</span>
                    <span className="shrink-0 text-text-muted">{formatBytes(artifact.size)}</span>
                  </li>
                ))}
              </ul>
            )
          }
        </Loaded>
        <p className="text-[12px] text-text-secondary">
          {run.documentWrite === undefined
            ? "No document write recorded for this run."
            : [
                run.documentWrite.status === "pr-opened" ? "Proposed in a pull request" : run.documentWrite.status === "committed" ? "Committed" : `Document write ${run.documentWrite.status}`,
                run.documentWrite.branch === undefined ? undefined : `branch ${run.documentWrite.branch}`,
                write?.commit === undefined ? undefined : `commit ${shortSha(write.commit)}`,
                write?.branchCommit === undefined ? undefined : `branch tip ${shortSha(write.branchCommit)}`,
              ]
                .filter((part) => part !== undefined)
                .join(" · ")}
          {run.documentWrite?.prUrl === undefined ? null : (
            <>
              {" · "}
              <a href={run.documentWrite.prUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                Open the pull request
              </a>
            </>
          )}
        </p>
      </div>
    </Card>
  );
}
