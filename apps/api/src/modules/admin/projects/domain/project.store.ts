// Port of Projects — the DI token of this module. Implemented by the Postgres adapter.

import type {
  ApplicationRecord,
  CreateApplication,
  CreateProject,
  ProjectRecord,
  ProjectRepositoryLink,
  UpdateApplication,
  UpdateProject,
} from "./project.js";

export abstract class ProjectStore {
  abstract listProjects(): Promise<ProjectRecord[]>;
  abstract getProject(id: string): Promise<ProjectRecord | undefined>;
  /** Creates the project with its document repo link, in one transaction. */
  abstract createProject(input: CreateProject): Promise<ProjectRecord>;
  abstract updateProject(id: string, input: UpdateProject): Promise<ProjectRecord | undefined>;
  /** Removes the project with its applications and links (the repositories stay registered). */
  abstract removeProject(id: string): Promise<boolean>;

  abstract listApplications(projectId: string): Promise<ApplicationRecord[]>;
  abstract getApplication(projectId: string, id: string): Promise<ApplicationRecord | undefined>;
  abstract createApplication(projectId: string, input: CreateApplication): Promise<ApplicationRecord>;
  abstract updateApplication(projectId: string, id: string, input: UpdateApplication): Promise<ApplicationRecord | undefined>;
  /** Removes the application with its repository links. */
  abstract removeApplication(projectId: string, id: string): Promise<boolean>;

  abstract listLinks(projectId: string): Promise<ProjectRepositoryLink[]>;
  /** Links of every project to any of these repositories. */
  abstract linksOfRepositories(repositoryIds: readonly string[]): Promise<ProjectRepositoryLink[]>;
  abstract addLink(link: ProjectRepositoryLink): Promise<void>;
  abstract removeLink(projectId: string, repositoryId: string): Promise<boolean>;
}
