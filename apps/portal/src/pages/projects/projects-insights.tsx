// The charts of the Projects pages. The list gets the installation-wide picture (applications,
// repository sync, runs per project); a project gets its own figures, the pipeline
// progress of each application and the run activity.

import { Link } from "react-router-dom";
import { BarList, ShareBar } from "@/components/results/charts";
import { CHART_COLOR } from "@/components/results/chart-colors";
import { SYNC_COLOR } from "@/components/results/status-colors";
import { type JobRunView, jobRunsApi } from "@/lib/api/job-runs";
import { type ApplicationView, type ProjectDetail, type ProjectView, projectsApi } from "@/lib/api/projects";
import { formatRelative } from "@/lib/format";
import { deliveryLink } from "@/lib/links";
import { percent, successRate } from "@/lib/run-stats";
import { isActiveStatus } from "@/lib/status";
import { latestRun, runtimePipelineStages, stageLabel } from "@/lib/stages";
import { useLoader } from "@/lib/use-loader";
import { ActivityChart, PipelineProgress } from "../delivery/overview-parts";
import { countBy, formatCount, segmentsOf } from "../delivery/results/results-format";
import { Kpi, KpiRow, Section } from "../delivery/results/results-parts";

const repositoriesOf = (project: ProjectDetail): Array<{ repositoryId: string; syncStatus: string }> => [
  ...(project.documentRepository === null ? [] : [project.documentRepository]),
  ...project.applications.flatMap((application) => [...application.asIs.legacy, ...application.asIs.legacyData, ...(application.toBe.document === null ? [] : [application.toBe.document]), ...application.toBe.targets]),
];

/** The installation-wide picture above the project list. */
export function ProjectsInsights({ projects }: { projects: ProjectView[] }): React.JSX.Element | null {
  const key = projects.map((project) => project.id).join(",");
  const details = useLoader(`projects-insight-details/${key}`, () => Promise.all(projects.map((project) => projectsApi.get(project.id))));
  const runs = useLoader("projects-insight-runs", async () => (await jobRunsApi.listAll({ limit: 200 })).items, { live: ["job-runs"] });
  if (projects.length === 0 || details.data === undefined) return null;
  const list = details.data;
  const applications = list.flatMap((project) => project.applications);
  const repositories = [...new Map(list.flatMap(repositoriesOf).map((repository) => [repository.repositoryId, repository])).values()];
  const top = (runs.data ?? []).filter((run) => run.kind === "stage");
  const notReady = repositories.filter((repository) => repository.syncStatus !== "ready").length;
  return (
    <div className="flex flex-col gap-4">
      <KpiRow>
        <Kpi label="Projects" value={projects.length} hint={`${list.filter((project) => project.documentRepository !== null).length} with a document repo`} />
        <Kpi label="Applications" value={applications.length} hint={`${applications.filter((application) => application.asIs.legacy.length === 0).length} without a legacy repo`} />
        <Kpi label="Repositories linked" value={repositories.length} hint={notReady === 0 ? "all in sync" : `${notReady} not ready`} tone={notReady > 0 ? "orange" : "green"} />
        <Kpi label="Active runs" value={top.filter((run) => isActiveStatus(run.status)).length} tone={top.some((run) => isActiveStatus(run.status)) ? "blue" : undefined} hint="across the projects" />
        <Kpi label="Success rate" value={undefined} display={percent(successRate(top))} hint={`of ${top.length} sampled runs`} />
        <Kpi label="Failed runs" value={top.filter((run) => run.status === "failed").length} tone={top.some((run) => run.status === "failed") ? "red" : "green"} higherIsWorse hint="in the sample" />
      </KpiRow>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="Repository sync" description="Every repository the projects link.">
          {repositories.length === 0 ? <p className="text-[12px] text-text-muted">No repository is linked.</p> : <ShareBar segments={segmentsOf(countBy(repositories, (repository) => repository.syncStatus), (name) => SYNC_COLOR[name])} format={formatCount} />}
        </Section>
        <Section title="Applications and runs" description="Applications per project; the note is its runs in the sample.">
          <BarList
            format={formatCount}
            color={CHART_COLOR.teal}
            rows={list.map((project) => ({ key: project.id, label: project.name, value: project.applications.length, note: `${top.filter((run) => run.projectId === project.id).length} runs` }))}
          />
        </Section>
      </div>
    </div>
  );
}

/** One project's figures, the pipeline progress of each application and its run activity. */
export function ProjectInsights({ project }: { project: ProjectDetail }): React.JSX.Element | null {
  const stages = useLoader("stages", jobRunsApi.stages);
  const runs = useLoader(`project-insight-runs/${project.id}`, async () => (await jobRunsApi.listAll({ projectId: project.id, limit: 200 })).items, {
    live: [`job-runs:${project.id}`],
  });
  if (runs.data === undefined || stages.data === undefined) return null;
  const top = runs.data.filter((run) => run.kind === "stage");
  const pipeline = runtimePipelineStages(stages.data);
  const repositories = repositoriesOf(project);
  const newest = top[0];
  if (project.applications.length === 0 && top.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      <KpiRow>
        <Kpi label="Applications" value={project.applications.length} />
        <Kpi label="Repositories" value={new Set(repositories.map((repository) => repository.repositoryId)).size} hint={`${repositories.filter((repository) => repository.syncStatus !== "ready").length} not ready`} tone={repositories.some((repository) => repository.syncStatus !== "ready") ? "orange" : "green"} />
        <Kpi label="Runs" value={top.length} hint={`${top.filter((run) => isActiveStatus(run.status)).length} active`} />
        <Kpi label="Success rate" value={undefined} display={percent(successRate(top))} hint="of the finished runs" />
        <Kpi label="Failed" value={top.filter((run) => run.status === "failed").length} tone={top.some((run) => run.status === "failed") ? "red" : "green"} higherIsWorse />
        <Kpi label="Last run" value={undefined} display={newest === undefined ? "—" : formatRelative(newest.createdAt)} hint={newest === undefined ? "never" : `${stageLabel(newest.name)} · ${newest.status}`} />
      </KpiRow>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        {project.applications.length === 0 ? null : (
          <Section title="Pipeline progress" description="The latest run of each stage, per application." className="xl:col-span-2">
            <ul className="flex flex-col gap-4">
              {project.applications.map((application) => (
                <ApplicationProgress key={application.id} projectId={project.id} application={application} runs={top} stageIds={pipeline.map((stage) => stage.id)} />
              ))}
            </ul>
          </Section>
        )}
        <div className={project.applications.length === 0 ? "xl:col-span-5" : "xl:col-span-3"}>
          <ActivityChart runs={top} />
        </div>
      </div>
    </div>
  );
}

function ApplicationProgress({ projectId, application, runs, stageIds }: { projectId: string; application: ApplicationView; runs: JobRunView[]; stageIds: string[] }): React.JSX.Element {
  const own = runs.filter((run) => run.applicationId === application.id);
  const states = stageIds.map((id) => ({ label: stageLabel(id), status: latestRun(own, id)?.status }));
  const done = states.filter((state) => state.status === "succeeded").length;
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <Link to={deliveryLink({ projectId, applicationId: application.id })} className="min-w-0 truncate text-text hover:underline">
          {application.name}
        </Link>
        <span className="shrink-0 text-[12px] text-text-secondary tabular-nums">
          {done}/{stageIds.length} stages
        </span>
      </div>
      <PipelineProgress states={states} />
    </li>
  );
}
