// Delivery → Overview: the project's headline figures (stages completed, active runs, success
// rate, what needs attention), a card per application with its pipeline — each stage's latest
// status, run time, a bar per recent run and the headline numbers of its results ("52 SLOC · 6
// files"), linked to its stage page — then the run activity of the last two weeks, the recent
// runs and the project's document writes. Active runs refresh on their own.
// URL: /delivery?project=<id>&section=writes. An old deep link with &run=<id> forwards to the
// run's stage page.

import { useEffect } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { RunStatusBadge, StatusBadge } from "@/components/status-badges";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { catalogApi } from "@/lib/api/catalog";
import { designApi } from "@/lib/api/design";
import { documentsApi, type StageHeadline } from "@/lib/api/documents";
import { type JobRunView, jobRunsApi, type StageView } from "@/lib/api/job-runs";
import { type ApplicationView, type ProjectDetail, projectsApi } from "@/lib/api/projects";
import { formatDateTime, formatDuration, formatRelative } from "@/lib/format";
import { designHeadline } from "@/lib/design-headline";
import { deliveryLink } from "@/lib/links";
import { isActiveStatus } from "@/lib/status";
import { latestRun, pipelineStages, runBlocker, runsOfStage, runtimePipelineStages, stageLabel } from "@/lib/stages";
import { useLoader } from "@/lib/use-loader";
import { cn } from "@/lib/utils";
import { DeliveryShell, NoApplications, WithProject } from "./delivery-shell";
import { DocumentWritesCard } from "./document-writes-card";
import { ActivityChart, NeedsAttention, PipelineProgress, ProjectKpis, RecentRuns } from "./overview-parts";
import { pipelineHealth } from "./pipeline-health";

export function DeliveryOverviewPage(): React.JSX.Element {
  const [params] = useSearchParams();
  const runId = params.get("run");
  return (
    <DeliveryShell title="Delivery" description="The stage pipeline of every application at a glance: open a stage to run it and follow its jobs and outputs.">
      {(projectId) => (runId === null ? <ProjectOverview projectId={projectId} /> : <RunForward projectId={projectId} runId={runId} />)}
    </DeliveryShell>
  );
}

/** Forwards `/delivery?run=<id>` to the stage page of that run. */
function RunForward({ projectId, runId }: { projectId: string; runId: string }): React.JSX.Element {
  const run = useLoader(`forward/${projectId}/${runId}`, () => jobRunsApi.get(projectId, runId));
  if (run.data !== undefined) {
    const target = run.data;
    return (
      <Navigate
        replace
        to={deliveryLink({ projectId, applicationId: target.applicationId, stage: target.kind === "stage" ? target.name : undefined, runId: target.kind === "stage" ? target.id : undefined })}
      />
    );
  }
  if (run.error !== null) return <Navigate replace to={deliveryLink({ projectId })} />;
  return (
    <Card>
      <Loaded loader={run} rows={3}>
        {() => null}
      </Loaded>
    </Card>
  );
}

function ProjectOverview({ projectId }: { projectId: string }): React.JSX.Element {
  const [params] = useSearchParams();
  const stages = useLoader("stages", jobRunsApi.stages);
  const runs = useLoader(`project-runs/${projectId}`, async () => (await jobRunsApi.listAll({ projectId, limit: 200 })).items, {
    live: [`job-runs:${projectId}`, `document-writes:${projectId}`],
  });
  const writes = useLoader(`writes/${projectId}`, async () => (await projectsApi.documentWrites(projectId, 15)).items, {
    live: [`document-writes:${projectId}`],
  });
  const section = params.get("section");

  useEffect(() => {
    if (section === "writes" && writes.data !== undefined) document.getElementById("document-writes")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [section, writes.data]);

  return (
    <WithProject projectId={projectId}>
      {(project) => (
        <div className="flex flex-col gap-5">
          {project.applications.length === 0 ? (
            <NoApplications project={project} />
          ) : (
            <Loaded loader={stages} rows={3}>
              {(list) => {
                const pipeline = runtimePipelineStages(list);
                const all = runs.data ?? [];
                const health = pipelineHealth(project.applications, pipeline, all);
                return (
                  <div className="flex flex-col gap-5">
                    <ProjectKpis applications={project.applications} stages={pipeline} runs={all} />
                    <div className="flex flex-col gap-3">
                      {project.applications.map((application) => (
                        <ApplicationStrip key={application.id} project={project} application={application} stages={list} runs={runs.data?.filter((run) => run.applicationId === application.id)} />
                      ))}
                    </div>
                    <NeedsAttention projectId={project.id} health={health} hasRuns={all.length > 0} />
                  </div>
                );
              }}
            </Loaded>
          )}
          <DocumentWritesCard loader={writes} documentRepository={project.documentRepository?.repositoryId} />
          {project.applications.length === 0 || runs.data === undefined ? null : (
            <details className="group rounded-xl bg-surface shadow-border-medium">
              <summary className="flex cursor-pointer items-center justify-between rounded-xl px-4 py-3 text-[13px] font-medium text-text hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
                Run history
                <span className="text-[12px] font-normal text-text-muted">activity of the last two weeks and the newest stage runs · full detail in Monitoring</span>
              </summary>
              <div className="flex flex-col gap-4 p-4 pt-0">
                <ActivityChart runs={runs.data} />
                <RecentRuns projectId={project.id} applications={project.applications} runs={runs.data} />
              </div>
            </details>
          )}
        </div>
      )}
    </WithProject>
  );
}

interface StripProps {
  project: ProjectDetail;
  application: ApplicationView;
  stages: StageView[];
  /** Runs of the application, newest first; undefined while loading. */
  runs: JobRunView[] | undefined;
}

function ApplicationStrip({ project, application, stages, runs }: StripProps): React.JSX.Element {
  const blocked = runBlocker(project, application);
  const active = runs?.filter((run) => isActiveStatus(run.status)).length ?? 0;
  // Read again whenever a stage of the application succeeds again.
  const succeeded = (runs ?? []).filter((run) => run.status === "succeeded" && run.kind === "stage").map((run) => `${run.id}:${run.documentWrite?.status ?? ""}`).join(",");
  const headlines = useLoader(`headlines/${project.id}/${application.id}/${succeeded}`, () =>
    project.documentRepository === null || succeeded === "" ? Promise.resolve([] as StageHeadline[]) : documentsApi.headlines(project.id, application.id),
  );
  // understand's headline is the catalog's (ADR-0033): N/M items understood.
  const catalog = useLoader(`overview-catalog/${project.id}/${application.id}/${succeeded}`, () =>
    project.documentRepository === null || succeeded === "" ? Promise.resolve(null) : catalogApi.get(project.id, application.id).catch(() => null),
  );
  const understood =
    catalog.data === undefined || catalog.data === null
      ? undefined
      : [`${catalog.data.counts.understood ?? 0}/${catalog.data.items.filter((item) => item.status !== "retired").length} items understood`];
  // The design stage is tracked by its documents (ADR-0044): per declared unit kind, how many units have their designs written.
  const design = useLoader(`overview-design/${project.id}/${application.id}`, () => (project.documentRepository === null ? Promise.resolve(null) : designApi.overview(project.id, application.id).catch(() => null)));
  const designed = design.data === undefined || design.data === null || design.data.sets.length === 0 ? undefined : designHeadline(design.data);
  const headlineOf = (stage: string): string[] | undefined => (stage === "understand" ? understood : stage === "design" ? designed : headlines.data?.find((entry) => entry.stage === stage)?.headline);

  const pipeline = pipelineStages(stages);
  const tracked = runtimePipelineStages(stages);
  const statusOf = (stage: StageView): string | undefined => (stage.audience === "runtime" && runs !== undefined ? latestRun(runs, stage.id)?.status : undefined);
  const states = tracked.map((stage) => ({ label: stageLabel(stage.id), status: statusOf(stage) }));
  const done = states.filter((state) => state.status === "succeeded").length;
  const next = runs === undefined ? undefined : tracked.find((stage) => statusOf(stage) !== "succeeded");
  const nextRun = next === undefined || runs === undefined ? undefined : latestRun(runs, next.id);
  const nextLink = next === undefined ? "" : deliveryLink({ projectId: project.id, applicationId: application.id, stage: next.id });

  let guidance: React.ReactNode = null;
  if (blocked !== undefined) guidance = blocked;
  else if (runs !== undefined && next === undefined) guidance = "Every stage of the pipeline has succeeded.";
  else if (next !== undefined && nextRun !== undefined && isActiveStatus(nextRun.status)) {
    guidance = (
      <>
        <span className="font-medium text-text">{stageLabel(next.id)}</span> is {nextRun.status === "queued" ? "queued" : "running"}.
      </>
    );
  } else if (next !== undefined) {
    guidance = (
      <>
        Next step:{" "}
        <Link to={nextLink} className="font-medium text-accent hover:underline">
          {nextRun === undefined ? `run ${stageLabel(next.id)}` : `${stageLabel(next.id)} again`}
        </Link>
        {nextRun?.status === "failed" ? " — its latest run failed." : nextRun?.status === "cancelled" ? " — its latest run was cancelled." : "."}
      </>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>
            <Link to={deliveryLink({ projectId: project.id, applicationId: application.id, stage: stages.find((stage) => stage.audience === "runtime")?.id })} className="hover:underline">
              {application.name}
            </Link>
          </CardTitle>
          <CardDescription>
            {application.id}
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {active === 0 ? null : <StatusBadge tone="blue" label={`${active} active run${active === 1 ? "" : "s"}`} />}
          <span className="text-[12px] text-text-secondary tabular-nums">
            <span className="font-medium text-text">{done}</span>/{tracked.length} stages done
          </span>
        </div>
      </CardHeader>
      <div className="mt-3 flex flex-col gap-3">
        <PipelineProgress states={states} />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-2">
          {pipeline.map((stage, index) => (
            <StageTile
              key={stage.id}
              index={index + 1}
              stage={stage}
              runs={runs === undefined ? undefined : runsOfStage(runs, stage.id)}
              headline={headlineOf(stage.id)}
              to={deliveryLink({ projectId: project.id, applicationId: application.id, stage: stage.id })}
            />
          ))}
        </div>
        {guidance === null ? null : <p className="text-[12px] text-text-secondary">{guidance}</p>}
      </div>
    </Card>
  );
}

interface TileProps {
  index: number;
  stage: StageView;
  /** The stage's runs for the application, newest first; undefined while loading. */
  runs: JobRunView[] | undefined;
  headline: string[] | undefined;
  to: string;
}

/** One stage of an application's pipeline: its latest run, the bars of its recent runs and the headline numbers of its results. */
function StageTile({ index, stage, runs, headline, to }: TileProps): React.JSX.Element {
  const last = runs?.[0];
  let badge: React.ReactNode = null;
  if (stage.audience === "member") badge = <StatusBadge tone="muted" label="In members' harnesses" />;
  else if (stage.audience === "portal") badge = <StatusBadge tone="muted" label="Planned" />;
  else if (last !== undefined) badge = <RunStatusBadge status={last.status} />;
  else if (runs !== undefined) badge = <StatusBadge tone="muted" label={stage.runnable ? "Not run yet" : "Not wired yet"} />;
  return (
    <Link
      to={to}
      title={last === undefined ? stage.description : `${stage.description}\nLatest run: ${formatDateTime(last.createdAt)}`}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-[10px] px-3 py-2.5 shadow-border hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]",
        stage.audience !== "runtime" && "bg-recessed/50",
      )}
    >
      <span className="flex items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-hover text-[11px] font-medium text-text-secondary">{index}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">{stageLabel(stage.id)}</span>
        {badge}
      </span>
      <span className="line-clamp-2 text-[12px] text-text-secondary">{stage.description}</span>
      {headline === undefined || headline.length === 0 ? null : <span className="truncate text-[13px] font-medium text-text tabular-nums">{headline.join(" · ")}</span>}
      {runs === undefined || last === undefined ? null : (
        <span className="truncate text-[11px] text-text-muted" title={formatDateTime(last.createdAt)}>
          {formatRelative(last.createdAt)}
          {last.startedAt === undefined ? "" : ` · ${isActiveStatus(last.status) ? "running for " : "took "}${formatDuration(last.startedAt, last.finishedAt)}`}
        </span>
      )}
    </Link>
  );
}
