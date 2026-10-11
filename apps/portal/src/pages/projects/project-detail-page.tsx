// Project detail (ADR-0028): per application, the AS-IS group (legacy code and legacy data
// repos, read-only for Kintsugi) and the TO-BE group (the project's document repo and the
// target repos, each implementing an architecture component), plus the kintsugi.yaml that
// Kintsugi renders from this state (read-only).

import type { ApplicationRepositoryRole } from "@kintsugi/domain";
import { FolderGit2, Pencil, Plus, Trash2, Unlink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import { gitApi, type GitRepositoryView } from "@/lib/api/git";
import { type ApplicationView, type ProjectDetail, type ProjectRepositoryView, projectsApi } from "@/lib/api/projects";
import { useAuth } from "@/lib/auth";
import { NoRepositories } from "./no-repositories";
import { ApplicationDialog, LinkDialog, ProjectDialog } from "./project-dialogs";

const SYNC_TONE: Record<string, StatusTone> = { pending: "muted", cloning: "blue", ready: "green", error: "red" };

type ConfirmTarget =
  | { kind: "project" }
  | { kind: "application"; application: ApplicationView }
  | { kind: "link"; application: ApplicationView; repository: ProjectRepositoryView };

type LinkTarget = { application: ApplicationView; role: ApplicationRepositoryRole };

export function ProjectDetailPage(): React.JSX.Element {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const canManage = can("projects.manage");
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [manifest, setManifest] = useState<string>("");
  const [repositories, setRepositories] = useState<GitRepositoryView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editProject, setEditProject] = useState(false);
  const [applicationDialog, setApplicationDialog] = useState<{ open: boolean; application: ApplicationView | null }>({ open: false, application: null });
  const [linkTarget, setLinkTarget] = useState<LinkTarget | null>(null);
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [detail, rendered, registered] = await Promise.all([
        projectsApi.get(projectId),
        projectsApi.manifest(projectId),
        canManage || can("git.manage") ? gitApi.listRepositories() : Promise.resolve([]),
      ]);
      setProject(detail);
      setManifest(rendered.content);
      setRepositories(registered);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, [projectId, can, canManage]);

  useEffect(() => {
    // load() sets state only after awaiting the API, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (project === null) {
    return (
      <div className="flex flex-col gap-5">
        <Breadcrumbs items={["Administration", "Projects", projectId]} />
        <p className={error === null ? "text-[13px] text-text-muted" : "text-[13px] text-[var(--ds-status-red)]"}>{error ?? "Loading…"}</p>
      </div>
    );
  }

  const linked = new Set([
    ...(project.documentRepository === null ? [] : [project.documentRepository.repositoryId]),
    ...project.applications.flatMap((application) => [...application.asIs.legacy, ...application.asIs.legacyData, ...application.toBe.targets].map((repository) => repository.repositoryId)),
  ]);
  const linkable = repositories.filter((repository) => !linked.has(repository.id));

  async function runConfirm(target: ConfirmTarget): Promise<void> {
    if (target.kind === "project") {
      await projectsApi.remove(projectId);
      navigate("/projects");
      return;
    }
    if (target.kind === "application") await projectsApi.removeApplication(projectId, target.application.id);
    else await projectsApi.unlink(projectId, target.application.id, target.repository.repositoryId);
    await load();
  }

  return (
    <div className="flex flex-col gap-5">
      <Breadcrumbs items={["Administration", "Projects", project.name]} />
      {error === null ? null : <p className="text-[13px] text-[var(--ds-status-red)]">{error}</p>}

      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>{project.name}</CardTitle>
            <CardDescription>
              {project.id}
              {project.description === undefined ? "" : ` · ${project.description}`}
            </CardDescription>
            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-text-secondary">
              <FolderGit2 className="size-4 text-text-muted" strokeWidth={1.5} />
              Document repo: {project.documentRepository === null ? "none" : `${project.documentRepository.repositoryId} (${project.documentRepository.url})`}
            </p>
          </div>
          {canManage ? (
            <div className="flex shrink-0 items-center gap-1">
              <Button size="small" variant="ghost" onClick={() => setEditProject(true)}>
                <Pencil className="size-4" />
                Edit
              </Button>
              <Button size="icon" variant="danger" aria-label="Delete project" onClick={() => setConfirm({ kind: "project" })}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ) : null}
        </CardHeader>
      </Card>

      {canManage && repositories.length === 0 ? <NoRepositories onSettingsClosed={() => void load()} /> : null}

      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-medium text-text">Applications</h2>
          <p className="mt-0.5 text-[12px] text-text-muted">AS-IS repositories are read-only for Kintsugi; only members write to TO-BE target repositories.</p>
        </div>
        {canManage ? (
          <Button size="small" variant="solid" onClick={() => setApplicationDialog({ open: true, application: null })}>
            <Plus className="size-4" />
            Add application
          </Button>
        ) : null}
      </div>

      {project.applications.length === 0 ? (
        <p className="text-[13px] text-text-secondary">No applications yet.</p>
      ) : (
        project.applications.map((application) => (
          <ApplicationCard
            key={application.id}
            application={application}
            canManage={canManage}
            canLink={linkable.length > 0}
            onEdit={() => setApplicationDialog({ open: true, application })}
            onRemove={() => setConfirm({ kind: "application", application })}
            onLink={(role) => setLinkTarget({ application, role })}
            onUnlink={(repository) => setConfirm({ kind: "link", application, repository })}
          />
        ))
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>kintsugi.yaml</CardTitle>
            <CardDescription>
              Rendered from this project, read-only. It is not committed to the document repo yet; unit kinds, pipelines, auto-commit paths and policy show defaults.
            </CardDescription>
          </div>
        </CardHeader>
        <pre className="shadow-border mt-3 max-h-[28rem] overflow-auto rounded-[var(--geist-radius)] bg-recessed px-3 py-2 font-mono text-[12px] leading-5 text-text">{manifest}</pre>
      </Card>

      <ProjectDialog
        open={editProject}
        project={project}
        repositories={repositories.filter((repository) => repository.id === project.documentRepositoryId || !linked.has(repository.id))}
        existingIds={[]}
        onClose={() => setEditProject(false)}
        onSubmit={async (_id, input) => {
          await projectsApi.update(projectId, input);
          await load();
        }}
      />

      <ApplicationDialog
        open={applicationDialog.open}
        application={applicationDialog.application}
        existingIds={project.applications.map((application) => application.id)}
        onClose={() => setApplicationDialog({ open: false, application: null })}
        onSubmit={async (id, input) => {
          if (applicationDialog.application === null) await projectsApi.createApplication(projectId, { id, ...input });
          else await projectsApi.updateApplication(projectId, id, input);
          await load();
        }}
      />

      <LinkDialog
        open={linkTarget !== null}
        role={linkTarget?.role ?? "legacy"}
        applicationName={linkTarget?.application.name ?? ""}
        repositories={linkable}
        onClose={() => setLinkTarget(null)}
        onSubmit={async (input) => {
          if (linkTarget === null) return;
          await projectsApi.link(projectId, linkTarget.application.id, input);
          await load();
        }}
      />

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === "project" ? "Delete project?" : confirm?.kind === "application" ? "Remove application?" : "Unlink repository?"}
        confirmLabel={confirm?.kind === "project" ? "Delete project" : confirm?.kind === "application" ? "Remove application" : "Unlink"}
        busyLabel="Removing…"
        onConfirm={() => (confirm === null ? Promise.resolve() : runConfirm(confirm))}
        onClose={() => setConfirm(null)}
      >
        {confirm?.kind === "project"
          ? `"${project.name}" and its applications are deleted. The repositories stay registered in Settings → Git.`
          : confirm?.kind === "application"
            ? `"${confirm.application.name}" is removed and its repositories are unlinked. They stay registered in Settings → Git.`
            : confirm?.kind === "link"
              ? `"${confirm.repository.repositoryId}" is unlinked from ${confirm.application.name}. It stays registered in Settings → Git.`
              : null}
      </ConfirmDialog>
    </div>
  );
}

interface ApplicationCardProps {
  application: ApplicationView;
  canManage: boolean;
  canLink: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onLink: (role: ApplicationRepositoryRole) => void;
  onUnlink: (repository: ProjectRepositoryView) => void;
}

function ApplicationCard({ application, canManage, canLink, onEdit, onRemove, onLink, onUnlink }: ApplicationCardProps): React.JSX.Element {
  const group = (title: string, role: ApplicationRepositoryRole, repositories: ProjectRepositoryView[]): React.JSX.Element => (
    <RepositoryList
      title={title}
      repositories={repositories}
      {...(canManage ? { onLink: canLink ? () => onLink(role) : undefined, onUnlink } : {})}
    />
  );

  return (
    <Card className="p-0">
      <CardHeader className="px-4 pt-3">
        <div className="min-w-0">
          <CardTitle>{application.name}</CardTitle>
          <CardDescription>
            {application.id} · {application.disposition}
            {application.pipeline === undefined ? "" : ` · pipeline ${application.pipeline}`}
          </CardDescription>
        </div>
        {canManage ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button size="small" variant="ghost" onClick={onEdit}>
              <Pencil className="size-4" />
              Edit
            </Button>
            <Button size="icon" variant="danger" aria-label={`Remove ${application.name}`} onClick={onRemove}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <div className="mt-3 grid grid-cols-1 gap-px md:grid-cols-2 [box-shadow:0_-1px_0_rgba(0,0,0,0.06)]">
        <section className="flex flex-col gap-3 px-4 py-3">
          <div>
            <h4 className="text-[13px] font-medium text-text">AS-IS</h4>
            <p className="text-[12px] text-text-muted">Read-only for Kintsugi.</p>
          </div>
          {group("Legacy code", "legacy", application.asIs.legacy)}
          {group("Legacy data", "legacy-data", application.asIs.legacyData)}
        </section>
        <section className="flex flex-col gap-3 px-4 py-3 md:[box-shadow:-1px_0_0_rgba(0,0,0,0.06)]">
          <div>
            <h4 className="text-[13px] font-medium text-text">TO-BE</h4>
            <p className="text-[12px] text-text-muted">Members write; the runtime never does.</p>
          </div>
          <RepositoryList
            title="Document repo"
            hint="Project level — change it with Edit project."
            repositories={application.toBe.document === null ? [] : [application.toBe.document]}
          />
          {group("Target repos", "target", application.toBe.targets)}
        </section>
      </div>
    </Card>
  );
}

interface RepositoryListProps {
  title: string;
  hint?: string;
  repositories: ProjectRepositoryView[];
  onLink?: (() => void) | undefined;
  onUnlink?: (repository: ProjectRepositoryView) => void;
}

function RepositoryList({ title, hint, repositories, onLink, onUnlink }: RepositoryListProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-text-secondary">
          {title}
          {hint === undefined ? null : <span className="text-text-muted"> · {hint}</span>}
        </span>
        {onLink === undefined ? null : (
          <Button size="small" variant="ghost" onClick={onLink}>
            <Plus className="size-4" />
            Link
          </Button>
        )}
      </div>
      {repositories.length === 0 ? (
        <p className="text-[12px] text-text-muted">None.</p>
      ) : (
        repositories.map((repository) => (
          <div key={repository.repositoryId} className="flex items-center gap-2 rounded-[var(--geist-radius)] px-2 py-1.5 hover:bg-hover">
            <FolderGit2 className="size-4 shrink-0 text-text-secondary" strokeWidth={1.5} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] text-text">{repository.repositoryId}</p>
              <p className="truncate text-[11px] text-text-muted" title={repository.url}>
                {repository.serverId}: {repository.path}
              </p>
            </div>
            {repository.component === undefined ? null : <Badge>{repository.component}</Badge>}
            <span title={repository.syncStatus}>
              <StatusDot tone={SYNC_TONE[repository.syncStatus] ?? "muted"} />
            </span>
            {onUnlink === undefined ? null : (
              <Button size="icon" variant="danger" aria-label={`Unlink ${repository.repositoryId}`} onClick={() => onUnlink(repository)}>
                <Unlink className="size-4" />
              </Button>
            )}
          </div>
        ))
      )}
    </div>
  );
}
