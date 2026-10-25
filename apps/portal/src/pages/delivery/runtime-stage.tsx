// A runtime stage of one application (ADR-0027): the header (status, Run), then the tabs —
// Overview (what the stage produced, read from the document repo; always the default, with a
// first-run panel while there is no output), Runs & logs (its job runs with steps, live log,
// output and attempt history) and Inputs & agents (paths it reads and writes, agents and bindings, decision points).
// URL: …&tab=results|runs|inputs (&run=<id> opens Runs & logs on that run).

import { Play, RefreshCw } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { JobRunList } from "@/components/job-runs/job-run-list";
import { RunListControls } from "@/components/job-runs/run-list-controls";
import { filterJobRuns } from "@/components/job-runs/run-model";
import { Loaded } from "@/components/loaded";
import { RunStatusBadge, StatusBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { agentsApi } from "@/lib/api/agents";
import { hasResultsView } from "@/lib/api/documents";
import { jobRunsApi, type StageView } from "@/lib/api/job-runs";
import { type ApplicationView, type ProjectDetail } from "@/lib/api/projects";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatDuration, formatRelative } from "@/lib/format";
import { isActiveStatus } from "@/lib/status";
import { agentProblems, runBlocker, runsOfStage, stageLabel } from "@/lib/stages";
import { useLoader } from "@/lib/use-loader";
import { CompactFacts, StageHeader } from "./delivery-shell";
import { FirstRun } from "./results/first-run";
import { DecisionPoints, StageAgents, StagePaths } from "./stage-parts";

const RUN_LIMIT = 100;

// The result views and their libraries (Markdown, Mermaid) load with the Results tab.
const StageResults = lazy(() => import("./results/stage-results"));
// The item catalog of the assess stage (ADR-0033).
const CatalogTab = lazy(() => import("./results/catalog-tab"));

type StageTab = "results" | "catalog" | "runs" | "inputs";

export function RuntimeStage({
  project,
  application,
  stage,
}: {
  project: ProjectDetail;
  application: ApplicationView;
  stage: StageView;
}): React.JSX.Element {
  const { can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [confirming, setConfirming] = useState(false);
  const [runFilter, setRunFilter] = useState("");
  const [runSearch, setRunSearch] = useState("");
  // The run list has no stage filter: the application's recent runs are filtered here.
  const runs = useLoader(
    `runs/${project.id}/${application.id}`,
    async () => (await jobRunsApi.list(project.id, application.id, RUN_LIMIT)).items,
    {
      live: [`job-runs:${project.id}`, `document-writes:${project.id}`],
    },
  );
  const agents = useLoader("agents", agentsApi.list);

  const stageRuns = runs.data === undefined ? undefined : runsOfStage(runs.data, stage.id);
  const visibleStageRuns = filterJobRuns(stageRuns ?? [], runFilter, runSearch);
  const latest = stageRuns?.[0];
  const latestSucceeded = stageRuns?.find((run) => run.status === "succeeded");
  const latestDetail = useLoader(
    `latest/${project.id}/${latestSucceeded?.id ?? "none"}/${latestSucceeded?.documentWrite?.status ?? ""}`,
    () => (latestSucceeded === undefined ? Promise.resolve(null) : jobRunsApi.get(project.id, latestSucceeded.id)),
  );

  const withResults = hasResultsView(stage.id);
  const withCatalog = stage.id === "assess";
  const requested = params.get("tab");
  const tab: StageTab =
    requested === "runs" || requested === "inputs" || (requested === "results" && withResults) || (requested === "catalog" && withCatalog)
      ? requested
      : params.get("run") !== null
        ? "runs"
        : withResults
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
    <div className="flex flex-col gap-4">
      <StageHeader
        title={stageLabel(stage.id)}
        command={stage.command}
        application={application}
        description={stage.description}
        badge={stage.runnable ? null : <StatusBadge tone="muted" label="Coming soon" />}
        facts={<CompactFacts project={project} application={application} />}
        actions={
          <>
            {latest === undefined ? (
              <span className="text-[12px] text-text-muted">{runs.data === undefined ? "" : "Never run"}</span>
            ) : (
              <span className="flex items-center gap-1.5" title={formatDateTime(latest.createdAt)}>
                <RunStatusBadge status={latest.status} cancelling={latest.cancelRequestedAt !== undefined && latest.status === "running"} />
                <span className="text-[12px] tabular-nums text-text-muted">
                  {formatRelative(latest.createdAt)}
                  {latest.startedAt === undefined
                    ? ""
                    : ` · ${isActiveStatus(latest.status) ? "running for " : "took "}${formatDuration(latest.startedAt, latest.finishedAt)}`}
                </span>
              </span>
            )}
            <span title={disabledReason}>
              <Button
                size="small"
                variant="solid"
                disabled={disabledReason !== undefined || runs.data === undefined}
                onClick={() => setConfirming(true)}
              >
                <Play className="size-3.5" />
                Run
              </Button>
            </span>
          </>
        }
      >
        {disabledReason === undefined || active ? null : <p className="mt-1.5 text-[12px] text-text-muted">{disabledReason}</p>}
        {problems.length === 0 ? null : (
          <p className="mt-1.5 text-[12px] text-text-secondary">
            Check the agents under Inputs &amp; agents before running: {problems.join("; ")}. Their jobs fail until this is fixed.
          </p>
        )}
      </StageHeader>

      <Tabs<StageTab>
        sticky
        label={`${stage.id} sections`}
        value={tab}
        onChange={chooseTab}
        tabs={[
          ...(withResults ? [{ id: "results" as const, label: "Overview" }] : []),
          ...(withCatalog ? [{ id: "catalog" as const, label: "Catalog" }] : []),
          { id: "runs" as const, label: "Runs & logs", count: stageRuns?.length },
          { id: "inputs" as const, label: "Inputs & agents" },
        ]}
      />

      {tab === "results" && hasResultsView(stage.id) ? (
        <Suspense
          fallback={
            <Card>
              <SkeletonRows rows={6} />
            </Card>
          }
        >
          <StageResults
            project={project}
            application={application}
            stage={stage.id}
            version={`${latestSucceeded?.id ?? "none"}/${latestSucceeded?.documentWrite?.status ?? ""}`}
            runBlocked={disabledReason}
            runs={stageRuns}
            firstRun={
              <FirstRun
                stage={stage.id}
                applicationName={application.name}
                latest={latest}
                blocked={disabledReason}
                onRun={() => setConfirming(true)}
                onOpenRun={(id) => setParams({ tab: "runs", run: id }, { replace: true })}
              />
            }
          />
        </Suspense>
      ) : null}

      {tab === "catalog" && withCatalog ? (
        <Suspense
          fallback={
            <Card>
              <SkeletonRows rows={6} />
            </Card>
          }
        >
          <CatalogTab
            project={project}
            application={application}
            version={`${latestSucceeded?.id ?? "none"}/${latestSucceeded?.documentWrite?.status ?? ""}/${latest?.id ?? ""}`}
          />
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
        <section className="flex min-w-0 flex-col gap-4">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[16px] font-medium text-text">{stageLabel(stage.id)} runs</h2>
              <p className="mt-1 text-[13px] text-text-secondary">Select a run for its summary, console, output and attempt history.</p>
            </div>
            <Button size="small" className="shadow-border" onClick={() => void runs.reload()}>
              <RefreshCw />
              Refresh
            </Button>
          </header>
          <RunListControls
            filter={runFilter}
            onFilter={setRunFilter}
            search={runSearch}
            onSearch={setRunSearch}
            searchLabel={`Search ${stageLabel(stage.id)} runs`}
            placeholder="Search run ID, actor or error…"
          />
          <Loaded loader={runs} rows={5}>
            {() => (
              <>
                {stageRuns?.length === 0 ? (
                  <EmptyState
                    icon={Play}
                    title={`${stage.id} has not run for ${application.name}`}
                    description={disabledReason ?? "Start the stage to see its execution here."}
                  />
                ) : visibleStageRuns.length === 0 ? (
                  <EmptyState icon={Play} title="No matching runs" description="Clear the search or choose another status." />
                ) : null}
                <JobRunList
                  projectId={project.id}
                  runs={visibleStageRuns}
                  canCancel={can("jobs.run")}
                  canRetry={can("jobs.run")}
                  initialOpen={initialRun}
                  onChanged={() => void runs.reload()}
                />
                <p className="text-[12px] text-text-secondary">
                  {visibleStageRuns.length} of {stageRuns?.length ?? 0} recent runs
                </p>
              </>
            )}
          </Loaded>
        </section>
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
          The worker reads{" "}
          {application.asIs.legacy.length === 0 ? "the legacy repo" : application.asIs.legacy.map((repo) => repo.repositoryId).join(", ")}{" "}
          read-only at their current commits and proposes the outputs to {project.documentRepository?.repositoryId ?? "the document repo"}
          {stage.agents.length === 0 ? "." : `, starting ${stage.agents.join(", ")}.`}
        </p>
        {problems.length === 0 ? null : <p className="mt-2 text-text">Warning: {problems.join("; ")}. Jobs of these agents fail.</p>}
      </ConfirmDialog>
    </div>
  );
}
