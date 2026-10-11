// Application layer: use cases of projects, applications and their repositories (A1,
// ADR-0028). Repositories come from Settings -> Git (the Git module's GitRegistry export);
// the rules come from @kintsugi/domain. Storage-agnostic.

import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  groupRepositories,
  type ManifestRepository,
  manifestFromProject,
  type ProjectRepositoryLink,
  projectRepositoryProblems,
  repositoryPath,
  type ValidationProblem,
} from "@kintsugi/domain";
import { MANIFEST_FILE, renderKintsugiYaml } from "@kintsugi/manifest";
import type { Page, PageQuery } from "#common/application/pagination.js";
import { toPage } from "#common/application/pagination.js";
import { GitRegistry } from "#modules/admin/git/index.js";
import {
  type ApplicationRecord,
  type CreateApplication,
  type CreateProject,
  type LinkRepository,
  ProjectConflictError,
  type ProjectDetail,
  type ProjectRecord,
  type ProjectRepositoryView,
  type RenderedManifest,
  type UpdateApplication,
  type UpdateProject,
} from "../domain/project.js";
import { ProjectStore } from "../domain/project.store.js";

const MANIFEST_HEADER = [
  "Rendered by Kintsugi from the project settings (Projects in the portal).",
  "unitKinds, pipelines, autoCommitPaths and policy show defaults until the portal manages them.",
  "Reference: docs/reference/document-repo.md",
].join("\n");

@Injectable()
export class ProjectsService {
  constructor(
    private readonly store: ProjectStore,
    private readonly git: GitRegistry,
  ) {}

  // ---- projects ----

  async listProjects(query: PageQuery): Promise<Page<ProjectRecord>> {
    const projects = await this.store.listProjects();
    return toPage(projects.slice(query.offset, query.offset + query.limit), projects.length, query);
  }

  async getProject(id: string): Promise<ProjectDetail> {
    const project = await this.#mustGetProject(id);
    const [applications, links, views] = await Promise.all([this.store.listApplications(id), this.store.listLinks(id), this.#repositoryViews()]);
    const view = (link: ProjectRepositoryLink): ProjectRepositoryView | undefined => {
      const repository = views.get(link.repositoryId);
      return repository === undefined ? undefined : { ...repository, role: link.role, ...(link.component === undefined ? {} : { component: link.component }) };
    };
    const documentLink = links.find((link) => link.role === "document");
    const documentRepository = documentLink === undefined ? null : (view(documentLink) ?? null);
    return {
      ...project,
      documentRepository,
      applications: applications.map((application) => {
        const repositories = links
          .filter((link) => link.applicationId === application.id)
          .map(view)
          .filter((entry): entry is ProjectRepositoryView => entry !== undefined);
        return { ...application, ...groupRepositories(repositories, documentRepository) };
      }),
    };
  }

  async createProject(input: CreateProject): Promise<ProjectRecord> {
    if ((await this.store.getProject(input.id)) !== undefined) throw new ConflictException(`Project ${input.id} already exists`);
    await this.#mustBeRegistered(input.documentRepositoryId);
    await this.#check(input.id, [], [{ projectId: input.id, applicationId: null, repositoryId: input.documentRepositoryId, role: "document" }]);
    return this.#conflicts(() => this.store.createProject(input));
  }

  async updateProject(id: string, input: UpdateProject): Promise<ProjectRecord> {
    const project = await this.#mustGetProject(id);
    if (input.documentRepositoryId !== undefined && input.documentRepositoryId !== project.documentRepositoryId) {
      await this.#mustBeRegistered(input.documentRepositoryId);
      const links = (await this.store.listLinks(id)).map((link) => (link.role === "document" ? { ...link, repositoryId: input.documentRepositoryId! } : link));
      await this.#check(id, await this.#applicationIds(id), links);
    }
    const updated = await this.#conflicts(() => this.store.updateProject(id, input));
    if (updated === undefined) throw new NotFoundException(`Project ${id} not found`);
    return updated;
  }

  async removeProject(id: string): Promise<void> {
    if (!(await this.store.removeProject(id))) throw new NotFoundException(`Project ${id} not found`);
  }

  /** kintsugi.yaml for the project's current state. Render only: the document-writes module publishes it (ADR-0019). */
  async renderManifest(id: string): Promise<RenderedManifest> {
    const detail = await this.getProject(id);
    if (detail.documentRepository === null) throw new ConflictException(`Project ${id} has no document repository`);
    const ref = (repository: ProjectRepositoryView): { server: string; path: string } => ({ server: repository.serverId, path: repository.path });
    const manifest = manifestFromProject({
      project: { id: detail.id, name: detail.name, ...(detail.description === undefined ? {} : { description: detail.description }) },
      document: ref(detail.documentRepository),
      applications: detail.applications.map((application) => ({
        id: application.id,
        name: application.name,
        disposition: application.disposition,
        ...(application.pipeline === undefined ? {} : { pipeline: application.pipeline }),
        repos: [...application.asIs.legacy, ...application.asIs.legacyData, ...application.toBe.targets].map(
          (repository): ManifestRepository => ({
            ...ref(repository),
            role: repository.role as ManifestRepository["role"],
            ...(repository.component === undefined ? {} : { component: repository.component }),
          }),
        ),
      })),
    });
    return { fileName: MANIFEST_FILE, content: renderKintsugiYaml(manifest, { header: MANIFEST_HEADER }) };
  }

  // ---- applications ----

  async getApplication(projectId: string, id: string): Promise<ApplicationRecord> {
    await this.#mustGetProject(projectId);
    return this.#mustGetApplication(projectId, id);
  }

  async createApplication(projectId: string, input: CreateApplication): Promise<ApplicationRecord> {
    await this.#mustGetProject(projectId);
    if ((await this.store.getApplication(projectId, input.id)) !== undefined) throw new ConflictException(`Application ${input.id} already exists in project ${projectId}`);
    return this.#conflicts(() => this.store.createApplication(projectId, input));
  }

  async updateApplication(projectId: string, id: string, input: UpdateApplication): Promise<ApplicationRecord> {
    await this.#mustGetProject(projectId);
    const updated = await this.store.updateApplication(projectId, id, input);
    if (updated === undefined) throw new NotFoundException(`Application ${id} not found in project ${projectId}`);
    return updated;
  }

  /** Removes the application and unlinks its repositories (they stay registered in Settings -> Git). */
  async removeApplication(projectId: string, id: string): Promise<void> {
    await this.#mustGetProject(projectId);
    if (!(await this.store.removeApplication(projectId, id))) throw new NotFoundException(`Application ${id} not found in project ${projectId}`);
  }

  // ---- repository links ----

  async linkRepository(projectId: string, applicationId: string, input: LinkRepository): Promise<ProjectDetail> {
    await this.#mustGetProject(projectId);
    await this.#mustGetApplication(projectId, applicationId);
    await this.#mustBeRegistered(input.repositoryId);
    const link: ProjectRepositoryLink = {
      projectId,
      applicationId,
      repositoryId: input.repositoryId,
      role: input.role,
      ...(input.component === undefined ? {} : { component: input.component.trim() }),
    };
    await this.#check(projectId, await this.#applicationIds(projectId), [...(await this.store.listLinks(projectId)), link]);
    await this.#conflicts(() => this.store.addLink(link));
    return this.getProject(projectId);
  }

  async unlinkRepository(projectId: string, applicationId: string, repositoryId: string): Promise<void> {
    await this.#mustGetProject(projectId);
    const link = (await this.store.listLinks(projectId)).find((entry) => entry.repositoryId === repositoryId && entry.applicationId === applicationId);
    if (link === undefined) throw new NotFoundException(`Repository ${repositoryId} is not linked to application ${applicationId}`);
    await this.store.removeLink(projectId, repositoryId);
  }

  // ---- helpers ----

  /** Throws 400 with every rule the links break (ADR-0028). */
  async #check(projectId: string, applicationIds: string[], links: ProjectRepositoryLink[]): Promise<void> {
    const otherProjectLinks = (await this.store.linksOfRepositories(links.map((link) => link.repositoryId))).filter((link) => link.projectId !== projectId);
    const problems: ValidationProblem[] = projectRepositoryProblems({ projectId, applicationIds, links, otherProjectLinks });
    if (problems.length > 0) throw new BadRequestException({ message: problems.map((problem) => problem.message) });
  }

  async #applicationIds(projectId: string): Promise<string[]> {
    return (await this.store.listApplications(projectId)).map((application) => application.id);
  }

  async #repositoryViews(): Promise<Map<string, Omit<ProjectRepositoryView, "role" | "component">>> {
    const [servers, repositories] = await Promise.all([this.git.listServers(), this.git.listRepositories()]);
    const baseUrls = new Map(servers.map((server) => [server.id, server.baseUrl]));
    return new Map(
      repositories.map((repository) => [
        repository.id,
        {
          repositoryId: repository.id,
          serverId: repository.serverId,
          url: repository.url,
          path: repositoryPath(repository.url, baseUrls.get(repository.serverId) ?? ""),
          ...(repository.defaultBranch === undefined ? {} : { defaultBranch: repository.defaultBranch }),
          syncStatus: repository.syncStatus,
        },
      ]),
    );
  }

  async #mustBeRegistered(repositoryId: string): Promise<void> {
    if ((await this.git.getRepository(repositoryId)) === undefined) {
      throw new BadRequestException(`Repository ${repositoryId} is not registered; add it in Settings -> Git first`);
    }
  }

  async #mustGetProject(id: string): Promise<ProjectRecord> {
    const project = await this.store.getProject(id);
    if (project === undefined) throw new NotFoundException(`Project ${id} not found`);
    return project;
  }

  async #mustGetApplication(projectId: string, id: string): Promise<ApplicationRecord> {
    const application = await this.store.getApplication(projectId, id);
    if (application === undefined) throw new NotFoundException(`Application ${id} not found in project ${projectId}`);
    return application;
  }

  async #conflicts<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ProjectConflictError) throw new ConflictException(error.message);
      throw error;
    }
  }
}
