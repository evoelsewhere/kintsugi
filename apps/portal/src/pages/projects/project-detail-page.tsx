// Project configuration (Administration → Projects, ADR-0028): the project's fields, per
// application the AS-IS group (legacy code and legacy data repos, read-only for Kintsugi) and
// the TO-BE group (the project's document repo and the target repos, each implementing an
// architecture component), plus the kintsugi.yaml that Kintsugi renders from this state and
// its publication to the document repo as a pull request. Running stages, job runs and
// document writes live in Delivery. Repository sync states refresh while not ready.

import type { ApplicationRepositoryRole } from "@kintsugi/domain";
import { FolderGit2, GitPullRequestArrow, Package, Pencil, Plus, Trash2, Unlink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SyncStatusBadge } from "@/components/status-badges";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { gitApi, type GitRepositoryView } from "@/lib/api/git";
import { type ApplicationView, type ProjectDetail, type ProjectRepositoryView, projectsApi } from "@/lib/api/projects";
import { useAuth } from "@/lib/auth";
import { deliveryLink } from "@/lib/links";
import { subscribeLive } from "@/lib/live";
import { Tabs } from "@/components/ui/tabs";
import { DesignSetsCard } from "./design-sets-card";
import { MemberConnectPanel } from "../member/connect-panel";
import { PluginAccessPanel } from "./plugin-access-panel";
import { ProjectAccessPanel } from "./project-access-panel";
import { ProjectInsights } from "./projects-insights";
import { NoRepositories } from "./no-repositories";
import { ApplicationDialog, LinkDialog, ProjectDialog } from "./project-dialogs";

type ConfirmTarget =
  | { kind: "project" }
  | { kind: "application"; application: ApplicationView }
  | { kind: "link"; application: ApplicationView; repository: ProjectRepositoryView };

type LinkTarget = { application: ApplicationView; role: ApplicationRepositoryRole };

type ProjectTab = "project" | "plugins" | "access" | "connect";

export function ProjectDetailPage(): React.JSX.Element {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const canManage = can("projects.manage");
  const [searchParams, setSearchParams] = useSearchParams();
  const tabs: Array<{ id: ProjectTab; label: string }> = [
    { id: "project", label: "Project" },
    ...(can("plugin.access.manage") ? [{ id: "plugins" as const, label: "Member plugins" }] : []),
    ...(can("project.access.manage") ? [{ id: "access" as const, label: "Project access" }] : []),
    ...(can("member.read") ? [{ id: "connect" as const, label: "Connect your AI" }] : []),
  ];
  const tab = tabs.find((entry) => entry.id === searchParams.get("tab"))?.id ?? "project";
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [manifest, setManifest] = useState<string>("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [scaffold, setScaffold] = useState(true);
  const [repositories, setRepositories] = useState<GitRepositoryView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editProject, setEditProject] = useState(false);
  const [applicationDialog, setApplicationDialog] = useState<{ open: boolean; application: ApplicationView | null }>({ open: false, application: null });
  const [linkTarget, setLinkTarget] = useState<LinkTarget | null>(null);
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null);
  const toast = useToast();

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

  // The worker clones newly linked repositories in the background: their status reaches this page over the live stream.
  useEffect(() => subscribeLive(["repositories"], () => void load()), [load]);

  if (project === null) {
    return (
      <div className="flex flex-col gap-5">
        <Breadcrumbs items={["Administration", { label: "Projects", to: "/projects" }, projectId]} />
        {error === null ? <SkeletonRows rows={4} /> : <p className="text-[13px] text-[var(--ds-status-red)]">{error}</p>}
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
    toast.success(target.kind === "application" ? `Removed ${target.application.name}` : `Unlinked ${target.repository.repositoryId}`);
    await load();
  }

  return (
    <div className="flex flex-col gap-5">
      <Breadcrumbs items={["Administration", { label: "Projects", to: "/projects" }, project.name]} />
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
          <div className="flex shrink-0 items-center gap-1">
            <Link to={deliveryLink({ projectId: project.id })} className="inline-flex h-[var(--geist-form-small-height)] items-center gap-1.5 rounded-[var(--geist-radius)] px-3 text-[14px] text-text-secondary hover:bg-hover hover:text-text">
              <Package className="size-4" />
              Open in Delivery
            </Link>
          {canManage ? (
            <>
              <Button size="small" variant="ghost" onClick={() => setEditProject(true)}>
                <Pencil className="size-4" />
                Edit
              </Button>
              <Button size="icon" variant="danger" aria-label="Delete project" onClick={() => setConfirm({ kind: "project" })}>
                <Trash2 className="size-4" />
              </Button>
            </>
          ) : null}
          </div>
        </CardHeader>
      </Card>

      <Tabs label="Project sections" tabs={tabs} value={tab} onChange={(id) => setSearchParams(id === "project" ? {} : { tab: id }, { replace: true })} />

      {tab === "project" ? (
        <>
        {canManage && repositories.length === 0 ? <NoRepositories onSettingsClosed={() => void load()} /> : null}

        <ProjectInsights project={project} />

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
          <Card>
            <EmptyState
              icon={Package}
              title="No applications yet"
              description={canManage ? "Add the applications to modernize, then link their legacy repositories so Delivery can run stages." : "Someone with projects.manage adds the applications to modernize."}
            />
          </Card>
        ) : (
          project.applications.map((application) => (
            <ApplicationCard
              key={application.id}
              projectId={project.id}
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

        <DesignSetsCard project={project} />

        <Card>
          <CardHeader>
            <div>
              <CardTitle>kintsugi.yaml</CardTitle>
              <CardDescription>
                Rendered from this project. Publishing proposes it to the document repo as a pull request; unit kinds, pipelines, auto-commit paths and policy show defaults.
              </CardDescription>
            </div>
            {canManage && project.documentRepository !== null ? (
              <Button size="small" variant="solid" className="shrink-0" onClick={() => setPublishOpen(true)}>
                <GitPullRequestArrow className="size-4" />
                Publish kintsugi.yaml
              </Button>
            ) : null}
          </CardHeader>
          <pre className="shadow-border mt-3 max-h-[28rem] overflow-auto rounded-[var(--geist-radius)] bg-recessed px-3 py-2 font-mono text-[12px] leading-5 text-text">{manifest}</pre>
        </Card>
        </>
      ) : null}

      {tab === "plugins" ? <PluginAccessPanel projectId={projectId} canManage={can("plugin.access.manage")} /> : null}
      {tab === "access" ? <ProjectAccessPanel projectId={projectId} canManage={can("project.access.manage")} /> : null}
      {tab === "connect" ? <MemberConnectPanel projectId={projectId} canManage={can("tokens.manage-own")} canRead={can("member.read")} /> : null}

      <ConfirmDialog
        open={publishOpen}
        title="Publish kintsugi.yaml?"
        confirmLabel="Publish"
        busyLabel="Queuing…"
        confirmVariant="solid"
        onConfirm={async () => {
          await projectsApi.publishManifest(projectId, { scaffold });
          toast.success(scaffold ? "kintsugi.yaml and the starter structure queued" : "kintsugi.yaml queued for publishing", "Follow the pull request under Document writes in Delivery.");
        }}
        onClose={() => setPublishOpen(false)}
      >
        Kintsugi commits the rendered kintsugi.yaml as kintsugi-bot on a new <code className="font-mono">kintsugi/*</code> branch of{" "}
        {project.documentRepository?.repositoryId ?? "the document repo"} and opens a pull request for review. Plain Git servers get the branch only.
        <div className="mt-3">
          <Checkbox checked={scaffold} onChange={setScaffold} label="Also create the starter structure that is missing" />
          <p className="mt-1 pl-6 text-[12px] text-text-muted">
            Program, portfolio, architecture, standards, plugins and gate folders with their READMEs, and one skeleton per application ({project.applications.length}). Files already in the repo are never replaced.
          </p>
        </div>
      </ConfirmDialog>

      <ProjectDialog
        open={editProject}
        project={project}
        repositories={repositories.filter((repository) => repository.id === project.documentRepositoryId || !linked.has(repository.id))}
        existingIds={[]}
        onClose={() => setEditProject(false)}
        onSubmit={async (_id, input) => {
          await projectsApi.update(projectId, input);
          toast.success("Project saved");
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
          toast.success(applicationDialog.application === null ? "Application added" : "Application saved", input.name);
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
          toast.success("Repository linked", `${input.repositoryId} → ${linkTarget.application.name}`);
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
  projectId: string;
  application: ApplicationView;
  canManage: boolean;
  canLink: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onLink: (role: ApplicationRepositoryRole) => void;
  onUnlink: (repository: ProjectRepositoryView) => void;
}

function ApplicationCard({ projectId, application, canManage, canLink, onEdit, onRemove, onLink, onUnlink }: ApplicationCardProps): React.JSX.Element {
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
            {application.id}
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link
            to={deliveryLink({ projectId, applicationId: application.id })}
            className="inline-flex h-[var(--geist-form-small-height)] items-center rounded-[var(--geist-radius)] px-3 text-[14px] text-text-secondary hover:bg-hover hover:text-text"
          >
            Runs &amp; stages
          </Link>
          {canManage ? (
            <>
              <Button size="small" variant="ghost" onClick={onEdit}>
                <Pencil className="size-4" />
                Edit
              </Button>
              <Button size="icon" variant="danger" aria-label={`Remove ${application.name}`} onClick={onRemove}>
                <Trash2 className="size-4" />
              </Button>
            </>
          ) : null}
        </div>
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
        <p className="text-[12px] text-text-muted">{onLink === undefined ? "None linked." : "None linked yet — use Link to add one."}</p>
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
            <SyncStatusBadge status={repository.syncStatus} />
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
