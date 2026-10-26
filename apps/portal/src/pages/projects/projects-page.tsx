// Projects (Administration -> Projects, A1, ADR-0028): the installation's projects, each
// with its document repo. Opening one shows its applications and repositories.

import { ChevronRight, FolderKanban, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { gitApi, type GitRepositoryView } from "@/lib/api/git";
import { projectsApi, type ProjectView } from "@/lib/api/projects";
import { useAuth } from "@/lib/auth";
import { NoRepositories } from "./no-repositories";
import { ProjectDialog } from "./project-dialogs";
import { ProjectsInsights } from "./projects-insights";

export function ProjectsPage(): React.JSX.Element {
  const { can } = useAuth();
  const navigate = useNavigate();
  const canManage = can("projects.manage");
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [repositories, setRepositories] = useState<GitRepositoryView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [allProjects, allRepositories] = await Promise.all([
        projectsApi.list(),
        canManage || can("git.manage") ? gitApi.listRepositories() : Promise.resolve([]),
      ]);
      setProjects(allProjects);
      setRepositories(allRepositories);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, [can, canManage]);

  useEffect(() => {
    // load() sets state only after awaiting the API, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader crumbs={["Administration", "Projects"]} />
      {error === null ? null : <p className="text-[13px] text-[var(--ds-status-red)]">{error}</p>}

      <ProjectsInsights projects={projects} />

      <Card className="overflow-hidden p-0">
        <CardHeader className="px-4 pt-3 pb-3">
          <div>
            <CardTitle>Projects</CardTitle>
            <CardDescription>Each project has one document repo and, per application, AS-IS (legacy) and TO-BE (target) repositories.</CardDescription>
          </div>
          {canManage ? (
            <Button size="small" variant="solid" disabled={repositories.length === 0} onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" />
              New project
            </Button>
          ) : null}
        </CardHeader>
        {canManage && repositories.length === 0 ? (
          <div className="px-4 pb-4">
            <NoRepositories onSettingsClosed={() => void load()} />
          </div>
        ) : null}
        {projects.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-text-secondary [box-shadow:0_-1px_0_rgba(0,0,0,0.06)]">No projects yet.</p>
        ) : (
          projects.map((project) => (
            <Link
              key={project.id}
              to={`/projects/${project.id}`}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-hover [box-shadow:0_-1px_0_rgba(0,0,0,0.06)]"
            >
              <FolderKanban className="size-5 shrink-0 text-text-secondary" strokeWidth={1.5} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] text-text">{project.name}</p>
                <p className="truncate text-[12px] text-text-muted">
                  {project.id} · document repo {project.documentRepositoryId}
                  {project.description === undefined ? "" : ` · ${project.description}`}
                </p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-text-muted" />
            </Link>
          ))
        )}
      </Card>

      <ProjectDialog
        open={dialogOpen}
        project={null}
        repositories={repositories}
        existingIds={projects.map((project) => project.id)}
        onClose={() => setDialogOpen(false)}
        onSubmit={async (id, input) => {
          await projectsApi.create({ id, ...input });
          navigate(`/projects/${id}`);
        }}
      />
    </div>
  );
}
