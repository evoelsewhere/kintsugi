// Delivery → Overview: every application of the selected project with a compact pipeline
// strip — each stage's latest status and age plus one or two headline numbers of its results
// ("52 SLOC · 6 files"), linked to its stage page — and the project's document writes. Active
// runs refresh on their own.
// URL: /delivery?project=<id>&section=writes. An old deep link with &run=<id> forwards to the
// run's stage page.

import { ChevronRight } from "lucide-react";
import { useEffect } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import { documentsApi, type StageHeadline } from "@/lib/api/documents";
import { type JobRunView, jobRunsApi, type StageView } from "@/lib/api/job-runs";
import { type ApplicationView, type ProjectDetail, projectsApi } from "@/lib/api/projects";
import { formatDateTime, formatRelative } from "@/lib/format";
import { deliveryLink } from "@/lib/links";
import { isActiveStatus, RUN_STATUS, styleOf } from "@/lib/status";
import { AUDIENCE_SHORT, latestRun, runBlocker, stagesByAudience } from "@/lib/stages";
import { useLoader } from "@/lib/use-loader";
import { cn } from "@/lib/utils";
import { DeliveryShell, NoApplications, WithProject } from "./delivery-shell";
import { DocumentWritesCard } from "./document-writes-card";

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
    refresh: (list) => (list.some((run) => isActiveStatus(run.status) || run.documentWrite?.status === "queued") ? 3000 : 30000),
  });
  const writes = useLoader(`writes/${projectId}`, async () => (await projectsApi.documentWrites(projectId, 15)).items, {
    refresh: (list) => (list.some((write) => write.status === "queued") ? 3000 : 30000),
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
              {(list) => (
                <div className="flex flex-col gap-3">
                  {project.applications.map((application) => (
                    <ApplicationStrip key={application.id} project={project} application={application} stages={list} runs={runs.data?.filter((run) => run.applicationId === application.id)} />
                  ))}
                </div>
              )}
            </Loaded>
          )}
          <DocumentWritesCard loader={writes} documentRepository={project.documentRepository?.repositoryId} />
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
            {application.id} · {application.disposition}
            {application.pipeline === undefined ? "" : ` · pipeline ${application.pipeline}`}
            {active === 0 ? "" : ` · ${active} active run${active === 1 ? "" : "s"}`}
            {blocked === undefined ? "" : ` · ${blocked}`}
          </CardDescription>
        </div>
      </CardHeader>
      <div className="mt-3 flex flex-col gap-2">
        {stagesByAudience(stages).map((group) => (
          <div key={group.audience} className="flex flex-col gap-1 sm:flex-row sm:items-stretch sm:gap-3">
            <p className="w-20 shrink-0 pt-2 text-[11px] font-medium tracking-wide text-text-muted uppercase">{AUDIENCE_SHORT[group.audience]}</p>
            <ol className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              {group.stages.map((stage, index) => (
                <li key={stage.id} className="flex items-center gap-1">
                  {index === 0 ? null : <ChevronRight className="size-3 shrink-0 text-text-muted" strokeWidth={1.75} />}
                  <StageChip
                    stage={stage}
                    last={runs === undefined ? undefined : latestRun(runs, stage.id)}
                    loading={runs === undefined}
                    headline={headlines.data?.find((entry) => entry.stage === stage.id)?.headline}
                    to={deliveryLink({ projectId: project.id, applicationId: application.id, stage: stage.id })}
                  />
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** One stage in a strip: a status dot, its id, the latest run's status and age, and its headline numbers. */
function StageChip({ stage, last, loading, headline, to }: { stage: StageView; last: JobRunView | undefined; loading: boolean; headline: string[] | undefined; to: string }): React.JSX.Element {
  let tone: StatusTone = "muted";
  let status: string;
  if (stage.audience === "member") status = "In members' harnesses";
  else if (stage.audience === "portal") status = "Planned";
  else if (loading) status = "…";
  else if (last !== undefined) {
    const style = styleOf(RUN_STATUS, last.status);
    tone = style.tone;
    status = `${style.label} · ${formatRelative(last.createdAt)}`;
  } else status = stage.runnable ? "Not run yet" : "Not wired yet";

  return (
    <Link
      to={to}
      title={last === undefined ? stage.description : `${stage.description}\nLatest run: ${formatDateTime(last.createdAt)}`}
      className={cn(
        "flex min-w-[8.5rem] flex-col gap-0.5 rounded-[10px] px-2.5 py-1.5 shadow-border hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]",
        stage.audience !== "runtime" && "bg-recessed/50",
      )}
    >
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-text">
        <StatusDot tone={tone} className={cn("size-2", last !== undefined && isActiveStatus(last.status) && "animate-pulse")} />
        {stage.id}
      </span>
      <span className="truncate text-[11px] text-text-muted">{status}</span>
      {headline === undefined || headline.length === 0 ? null : <span className="truncate text-[11px] font-medium text-text-secondary tabular-nums">{headline.join(" · ")}</span>}
    </Link>
  );
}
