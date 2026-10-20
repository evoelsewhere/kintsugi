// The frame every Delivery page shares: breadcrumbs, heading, the project selector (kept in
// ?project= and remembered in this browser) and the empty state when there is no project;
// plus the pieces of one project the pages reuse — its detail, the application tabs (?app=)
// and the repository facts of an application.

import { FolderGit2, FolderKanban, Package, Settings2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Loaded } from "@/components/loaded";
import { ProjectSelector } from "@/components/project-selector";
import { SyncStatusBadge } from "@/components/status-badges";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { type ApplicationView, type ProjectDetail, projectsApi } from "@/lib/api/projects";
import { deliveryLink, projectLink } from "@/lib/links";
import { useProjectSelection } from "@/lib/project-selection";
import { useLoader } from "@/lib/use-loader";
import { cn } from "@/lib/utils";

export interface DeliveryShellProps {
  /** Trail after "Delivery" and the project name. */
  crumbs?: string[];
  title: string;
  description: React.ReactNode;
  /** Extra actions before the project selector. */
  actions?: React.ReactNode;
  children: (projectId: string) => React.ReactNode;
}

export function DeliveryShell({ crumbs = [], title, description, actions, children }: DeliveryShellProps): React.JSX.Element {
  const projects = useLoader("projects", projectsApi.list);
  const { projectId, select } = useProjectSelection(projects.data?.map((project) => project.id));
  const current = projects.data?.find((project) => project.id === projectId);

  return (
    <div className="flex flex-col gap-4">
      {/* One row: where you are on the left, the project on the right; the page's own title is in its header card. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Breadcrumbs items={current === undefined ? [{ label: "Delivery", to: deliveryLink({ projectId }) }, ...crumbs] : [{ label: "Delivery", to: deliveryLink({ projectId }) }, { label: current.name, to: deliveryLink({ projectId }) }, ...crumbs]} />
        {projects.data === undefined || projects.data.length === 0 ? (
          actions
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            <ProjectSelector projects={projects.data} value={projectId} onChange={select} />
            {projectId === undefined ? null : (
              <Link
                to={projectLink(projectId)}
                aria-label="Configure the project"
                title="Configure the project"
                className="inline-flex h-[var(--geist-form-small-height)] items-center gap-1.5 rounded-[var(--geist-radius)] px-2.5 text-[13px] text-text-secondary hover:bg-hover hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
              >
                <Settings2 className="size-4" />
                Configure
              </Link>
            )}
          </div>
        )}
      </div>
      <h1 className="sr-only">{title}</h1>
      <p className="sr-only">{description}</p>
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
            <div key={projectId}>{children(projectId)}</div>
          )
        }
      </Loaded>
    </div>
  );
}

/** Loads a project and renders it once loaded (skeleton and error with Retry before). */
export function WithProject({ projectId, children }: { projectId: string; children: (project: ProjectDetail) => React.ReactNode }): React.JSX.Element {
  const project = useLoader(`project/${projectId}`, () => projectsApi.get(projectId));
  if (project.data === undefined) {
    return (
      <Card>
        <Loaded loader={project} rows={4}>
          {() => null}
        </Loaded>
      </Card>
    );
  }
  return <>{children(project.data)}</>;
}

export function NoApplications({ project }: { project: ProjectDetail }): React.JSX.Element {
  return (
    <Card>
      <EmptyState
        icon={Package}
        title="No applications in this project"
        description="Add the applications to modernize and link their legacy repositories in the project's configuration."
        action={
          <Link to={projectLink(project.id)} className="text-[13px] text-accent hover:underline">
            Configure {project.name}
          </Link>
        }
      />
    </Card>
  );
}

export function ApplicationTabs({ project, value, onChange }: { project: ProjectDetail; value: string; onChange: (id: string) => void }): React.JSX.Element {
  return (
    <nav aria-label="Applications" className="flex flex-wrap gap-1 [box-shadow:0_1px_0_0_rgba(0,0,0,0.08)] dark:[box-shadow:0_1px_0_0_rgba(255,255,255,0.12)]">
      {project.applications.map((entry) => (
        <button
          key={entry.id}
          type="button"
          aria-current={entry.id === value ? "page" : undefined}
          onClick={() => onChange(entry.id)}
          className={cn(
            "-mb-px flex items-center gap-1.5 rounded-[var(--geist-radius)] px-3 py-1.5 text-[13px] text-text-secondary hover:text-text focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]",
            entry.id === value && "font-medium text-text [box-shadow:0_-2px_0_0_var(--color-text)_inset]",
          )}
        >
          <Package className="size-4" strokeWidth={1.5} />
          {entry.name}
        </button>
      ))}
    </nav>
  );
}

/** The repositories of an application: legacy code (read-only), the document repo and the target repos. */
export function ApplicationFacts({ project, application }: { project: ProjectDetail; application: ApplicationView }): React.JSX.Element {
  const legacy = application.asIs.legacy[0];
  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-2 text-[12px] text-text-secondary">
      <RepoFact label="Legacy code (read-only)" repository={legacy} extra={application.asIs.legacy.length > 1 ? `+${application.asIs.legacy.length - 1} more` : undefined} />
      <RepoFact label="Document repo" repository={project.documentRepository ?? undefined} />
      <div className="min-w-0">
        <p className="text-[10px] tracking-wide text-text-muted uppercase">Target repos</p>
        <p className="text-text">{application.toBe.targets.length === 0 ? "None linked" : application.toBe.targets.map((target) => target.component ?? target.repositoryId).join(", ")}</p>
      </div>
    </div>
  );
}

function RepoFact({ label, repository, extra }: { label: string; repository: { repositoryId: string; syncStatus: string; url: string } | undefined; extra?: string | undefined }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <p className="text-[10px] tracking-wide text-text-muted uppercase">{label}</p>
      {repository === undefined ? (
        <p className="text-text-muted">None linked</p>
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

/** One fact of the header as a chip: a short eyebrow label, then its value. */
function FactChip({ label, title, children }: { label: string; title?: string | undefined; children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-hover px-2 py-0.5" title={title}>
      <span className="shrink-0 text-[10px] tracking-wide text-text-muted uppercase">{label}</span>
      {children}
    </span>
  );
}

/** One repository of an application as a chip: its name and sync state. */
function InlineRepo({ label, repository, extra }: { label: string; repository: { repositoryId: string; syncStatus: string; url: string } | undefined; extra?: string | undefined }): React.JSX.Element {
  return (
    <FactChip label={label} title={repository?.url}>
      {repository === undefined ? (
        <span className="text-text-muted">none linked</span>
      ) : (
        <>
          <span className="max-w-40 truncate text-text">{repository.repositoryId}</span>
          <SyncStatusBadge status={repository.syncStatus} />
          {extra === undefined ? null : <span className="tabular-nums text-text-muted">{extra}</span>}
        </>
      )}
    </FactChip>
  );
}

/** The repositories of an application on one line: legacy code, the document repo and the targets. */
export function CompactFacts({ project, application }: { project: ProjectDetail; application: ApplicationView }): React.JSX.Element {
  const legacy = application.asIs.legacy[0];
  const targets = application.toBe.targets.map((target) => target.component ?? target.repositoryId).join(", ");
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-text-secondary">
      <InlineRepo label="Legacy" repository={legacy} extra={application.asIs.legacy.length > 1 ? `+${application.asIs.legacy.length - 1}` : undefined} />
      <InlineRepo label="Docs" repository={project.documentRepository ?? undefined} />
      <FactChip label="Targets" title={targets === "" ? undefined : targets}>
        {targets === "" ? <span className="text-text-muted">none linked</span> : <span className="max-w-48 truncate text-text">{targets}</span>}
      </FactChip>
    </div>
  );
}

/**
 * The header of a stage page in two lines: the stage, its command, the application and its status
 * with the primary action on the right; then what the stage does (one line, the rest on hover) and
 * the repositories of the application.
 */
export function StageHeader({
  title,
  command,
  application,
  badge,
  description,
  actions,
  facts,
  children,
}: {
  title: string;
  command: string;
  application?: ApplicationView | undefined;
  badge?: React.ReactNode;
  description: string;
  actions?: React.ReactNode;
  facts?: React.ReactNode;
  /** Extra lines under the header (warnings). */
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <Card className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
          <p className="text-[16px] font-semibold tracking-tight text-text">{title}</p>
          <span className="font-mono text-[11px] text-text-muted" title={`Command /${command}`}>
            /{command}
          </span>
          {application === undefined ? null : (
            <span className="inline-flex items-center gap-1 rounded-[var(--geist-pill-radius)] bg-hover px-2 py-0.5 text-[11.5px] text-text-secondary">
              <Package className="size-3" strokeWidth={1.75} />
              {application.name}
            </span>
          )}
          {badge}
        </div>
        {actions === undefined ? null : <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
        <p className="min-w-48 flex-1 truncate text-[12.5px] text-text-secondary" title={description}>
          {description}
        </p>
        {facts}
      </div>
      {children}
    </Card>
  );
}
