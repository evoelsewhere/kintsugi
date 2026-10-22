// Domain of Projects (A1, ADR-0028): projects, their applications and the registered Git
// repositories they use, grouped AS-IS / TO-BE. The vocabulary and the rules come from
// @kintsugi/domain; this file adds the stored records and the commands. Pure types.

import type {
  Application,
  ApplicationRepositoryRole,
  Project,
  ProjectRepositoryLink,
  RepositoryGroups,
  RepositoryRole,
} from "@kintsugi/domain";

export interface ProjectRecord extends Project {
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationRecord extends Application {
  createdAt: string;
  updatedAt: string;
}

export type { ProjectRepositoryLink };

export interface CreateProject {
  id: string;
  name: string;
  description?: string;
  documentRepositoryId: string;
}

/** `description: null` clears it; a new `documentRepositoryId` replaces the document repo. */
export interface UpdateProject {
  name?: string;
  description?: string | null;
  documentRepositoryId?: string;
}

export interface CreateApplication {
  id: string;
  name: string;
  pipeline?: string;
}

/** `pipeline: null` clears it. */
export interface UpdateApplication {
  name?: string;
  pipeline?: string | null;
}

export interface LinkRepository {
  repositoryId: string;
  role: ApplicationRepositoryRole;
  component?: string;
}

/** A linked repository as the API shows it: the link plus the registered repository. */
export interface ProjectRepositoryView {
  repositoryId: string;
  role: RepositoryRole;
  component?: string;
  serverId: string;
  url: string;
  /** Path on its server, as written in kintsugi.yaml. */
  path: string;
  defaultBranch?: string;
  syncStatus: string;
}

export interface ApplicationView extends ApplicationRecord, RepositoryGroups<ProjectRepositoryView> {}

export interface ProjectDetail extends ProjectRecord {
  documentRepository: ProjectRepositoryView | null;
  applications: ApplicationView[];
}

/** The rendered manifest (render only: writing it to the document repo is a later step). */
export interface RenderedManifest {
  fileName: string;
  content: string;
}

/** A write lost a race against a uniqueness rule enforced by the store. */
export class ProjectConflictError extends Error {}
