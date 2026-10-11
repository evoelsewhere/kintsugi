// Delivery — the work on one project, per application: the stage pipeline with Run, the job
// runs (steps, live log, artifacts, cancel), the latest output in the document repo and the
// project's document writes. Configuration lives in Administration → Projects.
// URL: /delivery?project=<id>&app=<id>&run=<id>&section=writes (the project is also
// remembered in this browser).

import { FileText, FolderGit2, FolderKanban, Package, Play, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { JobRunList } from "@/components/job-runs/job-run-list";
import { Loaded } from "@/components/loaded";
import { PageHeading } from "@/components/page-heading";
import { ProjectSelector } from "@/components/project-selector";
import { SyncStatusBadge } from "@/components/status-badges";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { type JobRunView, jobRunsApi, type StageView } from "@/lib/api/job-runs";
import { type ApplicationView, type DocumentWriteView, type ProjectDetail, projectsApi } from "@/lib/api/projects";
import { useAuth } from "@/lib/auth";
import { formatBytes, shortSha } from "@/lib/format";
import { projectLink } from "@/lib/links";
import { useProjectSelection } from "@/lib/project-selection";
import { isActiveStatus } from "@/lib/status";
import { type Loader, useLoader } from "@/lib/use-loader";
import { cn } from "@/lib/utils";
import { DocumentWritesCard } from "./document-writes-card";
import { StagePipeline } from "./stage-pipeline";

export function DeliveryPage(): React.JSX.Element {
  const projects = useLoader("projects", projectsApi.list);
  const { projectId, select } = useProjectSelection(projects.data?.map((project) => project.id));
  const current = projects.data?.find((project) => project.id === projectId);

  return (
    <div className="flex flex-col gap-5">
      <Breadcrumbs items={current === undefined ? ["Delivery"] : ["Delivery", current.name]} />
      <PageHeading
        title="Delivery"
        description="Run stages per application and follow their jobs, outputs and writes to the document repo."
        actions={
          projects.data === undefined || projects.data.length === 0 ? undefined : (
            <>
              <ProjectSelector projects={projects.data} value={projectId} onChange={select} />
              {projectId === undefined ? null : (
                <Link to={projectLink(projectId)} className="inline-flex h-[var(--geist-form-small-height)] items-center gap-1.5 rounded-[var(--geist-radius)] px-3 text-[13px] text-text-secondary hover:bg-hover hover:text-text">
                  <Settings2 className="size-4" />
                  Configure
                </Link>
              )}
            </>
          )
        }
      />
      <Loaded loader={projects} rows={4}>
        {(list) =>
          list.length === 0 || projectId === undefined ? (
            <Card>
              <EmptyState
                icon={FolderKanban}
                title="No projects yet"
                description="Delivery works on a project's applications. Create a project and add its applications and repositories first."
                action={
                  <Link to="/projects" className="text-[13px] text-accent hover:underline">
                    Go to Administration → Projects
                  </Link>
                }
              />
            </Card>
          ) : (
            <ProjectDelivery key={projectId} projectId={projectId} />
          )
        }
      </Loaded>
    </div>
  );
}

function ProjectDelivery({ projectId }: { projectId: string }): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const project = useLoader(`project/${projectId}`, () => projectsApi.get(projectId));
  const stages = useLoader("stages", jobRunsApi.stages);
  const writes = useLoader(`writes/${projectId}`, async () => (await projectsApi.documentWrites(projectId, 15)).items, {
    refresh: (list) => (list.some((write) => write.status === "queued") ? 3000 : 30000),
  });
  const section = params.get("section");

  useEffect(() => {
    if (section === "writes" && writes.data !== undefined) document.getElementById("document-writes")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [section, writes.data]);

  if (project.data === undefined) {
    return (
      <Card>
        <Loaded loader={project} rows={4}>
          {() => null}
        </Loaded>
      </Card>
    );
  }
  const detail = project.data;
  const appId = params.get("app");
  const application = detail.applications.find((entry) => entry.id === appId) ?? detail.applications[0];
  const chooseApp = (id: string): void =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("app", id);
        next.delete("run");
        return next;
      },
      { replace: true },
    );

  return (
    <div className="flex flex-col gap-5">
      {detail.applications.length === 0 || application === undefined ? (
        <Card>
          <EmptyState
            icon={Package}
            title="No applications in this project"
            description="Add the applications to modernize and link their legacy repositories in the project's configuration."
            action={
              <Link to={projectLink(projectId)} className="text-[13px] text-accent hover:underline">
                Configure {detail.name}
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          <nav aria-label="Applications" className="flex flex-wrap gap-1 [box-shadow:0_1px_0_0_rgba(0,0,0,0.08)]">
            {detail.applications.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-current={entry.id === application.id ? "page" : undefined}
                onClick={() => chooseApp(entry.id)}
                className={cn(
                  "-mb-px flex items-center gap-1.5 px-3 py-2 text-[13px] text-text-secondary hover:text-text",
                  entry.id === application.id && "font-medium text-text [box-shadow:0_-2px_0_0_var(--color-text)_inset]",
                )}
              >
                <Package className="size-4" strokeWidth={1.5} />
                {entry.name}
              </button>
            ))}
          </nav>
          <ApplicationDelivery
            key={application.id}
            project={detail}
            application={application}
            stages={stages}
            writes={writes.data}
            initialRun={params.get("run") ?? undefined}
            onWritesChanged={() => void writes.reload()}
          />
        </>
      )}
      <DocumentWritesCard loader={writes} documentRepository={detail.documentRepository?.repositoryId} />
    </div>
  );
}

interface ApplicationDeliveryProps {
  project: ProjectDetail;
  application: ApplicationView;
  stages: Loader<StageView[]>;
  writes: DocumentWriteView[] | undefined;
  initialRun: string | undefined;
  onWritesChanged: () => void;
}

function ApplicationDelivery({ project, application, stages, writes, initialRun, onWritesChanged }: ApplicationDeliveryProps): React.JSX.Element {
  const { can } = useAuth();
  const toast = useToast();
  const [busyStage, setBusyStage] = useState<string | null>(null);
  const [, setParams] = useSearchParams();
  const runs = useLoader(`runs/${project.id}/${application.id}`, async () => (await jobRunsApi.list(project.id, application.id, 20)).items, {
    refresh: (list) => (list.some((run) => isActiveStatus(run.status) || run.documentWrite?.status === "queued") ? 3000 : 30000),
  });

  const blocked =
    project.documentRepository === null
      ? "The project has no document repo, so job output has nowhere to go."
      : application.asIs.legacy.length === 0
        ? "Link a legacy code repo to the application to run stages."
        : undefined;

  async function run(stage: StageView): Promise<void> {
    setBusyStage(stage.id);
    try {
      const queued = await jobRunsApi.runStage(project.id, application.id, stage.id);
      toast.success(`Stage ${stage.id} queued`, `${application.name} · the worker starts it shortly.`);
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set("run", queued.id);
          return next;
        },
        { replace: true },
      );
      await runs.reload();
    } catch (failure) {
      toast.error(`Could not run ${stage.id}`, failure);
    } finally {
      setBusyStage(null);
    }
  }

  const legacy = application.asIs.legacy[0];
  const latestSucceeded = runs.data?.find((entry) => entry.status === "succeeded");

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-wrap items-start gap-x-8 gap-y-2 text-[12px] text-text-secondary">
          <div>
            <p className="text-[15px] font-medium text-text">{application.name}</p>
            <p className="text-text-muted">
              {application.id} · {application.disposition}
              {application.pipeline === undefined ? "" : ` · pipeline ${application.pipeline}`}
            </p>
          </div>
          <RepoFact label="Legacy code (read-only)" repository={legacy} extra={application.asIs.legacy.length > 1 ? `+${application.asIs.legacy.length - 1} more` : undefined} />
          <RepoFact label="Document repo" repository={project.documentRepository ?? undefined} />
          <div>
            <p className="text-text-muted">Target repos</p>
            <p className="text-text">{application.toBe.targets.length === 0 ? "None linked" : application.toBe.targets.map((target) => target.component ?? target.repositoryId).join(", ")}</p>
          </div>
        </div>
      </Card>

      {stages.data === undefined ? (
        <Card>
          <CardTitle>Stage pipeline</CardTitle>
          <div className="mt-3">
            <Loaded loader={stages} rows={2}>
              {() => null}
            </Loaded>
          </div>
        </Card>
      ) : (
        <StagePipeline stages={stages.data} runs={runs.data ?? []} canRun={can("jobs.run")} blocked={blocked} busyStage={busyStage} onRun={(stage) => void run(stage)} />
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Job runs</CardTitle>
            <CardDescription>Open a run for its steps, artifacts and live log. Active runs refresh on their own.</CardDescription>
          </div>
        </CardHeader>
        <div className="mt-2">
          <Loaded loader={runs} rows={3}>
            {(list) =>
              list.length === 0 ? (
                <EmptyState
                  icon={Play}
                  title="No runs yet"
                  description={blocked ?? (can("jobs.run") ? "Run the assess stage above to inventory and assess the legacy code." : "Someone with the jobs.run permission can start the assess stage.")}
                />
              ) : (
                <JobRunList
                  key={initialRun ?? "none"}
                  runs={list}
                  canCancel={can("jobs.run")}
                  initialOpen={initialRun}
                  onChanged={() => {
                    void runs.reload();
                    onWritesChanged();
                  }}
                />
              )
            }
          </Loaded>
        </div>
      </Card>

      {latestSucceeded === undefined ? null : <LatestOutput run={latestSucceeded} writes={writes} />}
    </div>
  );
}

function RepoFact({ label, repository, extra }: { label: string; repository: { repositoryId: string; syncStatus: string; url: string } | undefined; extra?: string | undefined }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <p className="text-text-muted">{label}</p>
      {repository === undefined ? (
        <p className="text-text">None linked</p>
      ) : (
        <p className="flex items-center gap-2 text-text" title={repository.url}>
          <FolderGit2 className="size-3.5 shrink-0 text-text-muted" strokeWidth={1.5} />
          <span className="truncate">{repository.repositoryId}</span>
          <SyncStatusBadge status={repository.syncStatus} />
          {extra === undefined ? null : <span className="text-text-muted">{extra}</span>}
        </p>
      )}
    </div>
  );
}

/** The artifacts of the application's latest successful run and where they went in the document repo. */
function LatestOutput({ run, writes }: { run: JobRunView; writes: DocumentWriteView[] | undefined }): React.JSX.Element {
  const detail = useLoader(`latest/${run.projectId}/${run.id}/${run.documentWrite?.status ?? ""}`, () => jobRunsApi.get(run.projectId, run.id));
  const write = writes?.find((entry) => entry.id === run.documentWrite?.id);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Latest output in the document repo</CardTitle>
          <CardDescription>
            From stage {run.name}, {new Date(run.finishedAt ?? run.createdAt).toLocaleString()}.
          </CardDescription>
        </div>
      </CardHeader>
      <div className="mt-3 flex flex-col gap-2">
        <Loaded loader={detail} rows={2}>
          {(loaded) =>
            loaded.artifacts.length === 0 ? (
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
