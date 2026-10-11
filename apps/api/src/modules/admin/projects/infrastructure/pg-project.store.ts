// Postgres adapter for projects, applications and their repository links (ADR-0010,
// ADR-0028; schema: admin, migration 008_projects.sql). Links reference admin.git_repository.

import { Injectable } from "@nestjs/common";
import type { Disposition, RepositoryRole } from "@kintsugi/domain";
import type { Pool } from "pg";
import { getPool, withTransaction } from "#common/db/pool.js";
import {
  type ApplicationRecord,
  type CreateApplication,
  type CreateProject,
  ProjectConflictError,
  type ProjectRecord,
  type ProjectRepositoryLink,
  type UpdateApplication,
  type UpdateProject,
} from "../domain/project.js";
import { ProjectStore } from "../domain/project.store.js";

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  document_repository_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ApplicationRow {
  project_id: string;
  id: string;
  name: string;
  disposition: Disposition;
  pipeline: string | null;
  created_at: Date;
  updated_at: Date;
}

interface LinkRow {
  project_id: string;
  application_id: string | null;
  repository_id: string;
  role: RepositoryRole;
  component: string | null;
}

const PROJECT_SELECT = `select p.id, p.name, p.description, d.repository_id as document_repository_id, p.created_at, p.updated_at
  from admin.project p
  left join admin.project_repository d on d.project_id = p.id and d.role = 'document'`;
const APPLICATION_COLUMNS = "project_id, id, name, disposition, pipeline, created_at, updated_at";
const LINK_COLUMNS = "project_id, application_id, repository_id, role, component";

/** Unique and check violations become a conflict the application layer can report. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505" || code === "23514" || code === "23503") {
      throw new ProjectConflictError(`The change conflicts with another project or repository (${(error as { constraint?: string }).constraint ?? code}).`);
    }
    throw error;
  }
}

@Injectable()
export class PgProjectStore extends ProjectStore {
  get #pool(): Pool {
    return getPool();
  }

  async listProjects(): Promise<ProjectRecord[]> {
    const result = await this.#pool.query<ProjectRow>(`${PROJECT_SELECT} order by p.name, p.id`);
    return result.rows.map(toProject);
  }

  async getProject(id: string): Promise<ProjectRecord | undefined> {
    const result = await this.#pool.query<ProjectRow>(`${PROJECT_SELECT} where p.id = $1`, [id]);
    const row = result.rows[0];
    return row === undefined ? undefined : toProject(row);
  }

  async createProject(input: CreateProject): Promise<ProjectRecord> {
    await guarded(() =>
      withTransaction(async (client) => {
        await client.query("insert into admin.project (id, name, description) values ($1, $2, $3)", [input.id, input.name, input.description ?? null]);
        await client.query("insert into admin.project_repository (project_id, application_id, repository_id, role) values ($1, null, $2, 'document')", [
          input.id,
          input.documentRepositoryId,
        ]);
      }),
    );
    return (await this.getProject(input.id))!;
  }

  async updateProject(id: string, input: UpdateProject): Promise<ProjectRecord | undefined> {
    const updated = await guarded(() =>
      withTransaction(async (client) => {
        const result = await client.query(
          `update admin.project set name = coalesce($2, name),
             description = case when $3::boolean then $4 else description end,
             updated_at = now()
           where id = $1`,
          [id, input.name ?? null, input.description !== undefined, input.description ?? null],
        );
        if ((result.rowCount ?? 0) === 0) return false;
        if (input.documentRepositoryId !== undefined) {
          await client.query("update admin.project_repository set repository_id = $2 where project_id = $1 and role = 'document'", [id, input.documentRepositoryId]);
        }
        return true;
      }),
    );
    return updated ? this.getProject(id) : undefined;
  }

  async removeProject(id: string): Promise<boolean> {
    const result = await this.#pool.query("delete from admin.project where id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async listApplications(projectId: string): Promise<ApplicationRecord[]> {
    const result = await this.#pool.query<ApplicationRow>(`select ${APPLICATION_COLUMNS} from admin.application where project_id = $1 order by name, id`, [projectId]);
    return result.rows.map(toApplication);
  }

  async getApplication(projectId: string, id: string): Promise<ApplicationRecord | undefined> {
    const result = await this.#pool.query<ApplicationRow>(`select ${APPLICATION_COLUMNS} from admin.application where project_id = $1 and id = $2`, [projectId, id]);
    const row = result.rows[0];
    return row === undefined ? undefined : toApplication(row);
  }

  async createApplication(projectId: string, input: CreateApplication): Promise<ApplicationRecord> {
    await guarded(() =>
      this.#pool.query("insert into admin.application (project_id, id, name, disposition, pipeline) values ($1, $2, $3, $4, $5)", [
        projectId,
        input.id,
        input.name,
        input.disposition,
        input.pipeline ?? null,
      ]),
    );
    return (await this.getApplication(projectId, input.id))!;
  }

  async updateApplication(projectId: string, id: string, input: UpdateApplication): Promise<ApplicationRecord | undefined> {
    const result = await this.#pool.query(
      `update admin.application set name = coalesce($3, name), disposition = coalesce($4, disposition),
         pipeline = case when $5::boolean then $6 else pipeline end, updated_at = now()
       where project_id = $1 and id = $2`,
      [projectId, id, input.name ?? null, input.disposition ?? null, input.pipeline !== undefined, input.pipeline ?? null],
    );
    return (result.rowCount ?? 0) === 0 ? undefined : this.getApplication(projectId, id);
  }

  async removeApplication(projectId: string, id: string): Promise<boolean> {
    const result = await this.#pool.query("delete from admin.application where project_id = $1 and id = $2", [projectId, id]);
    return (result.rowCount ?? 0) > 0;
  }

  async listLinks(projectId: string): Promise<ProjectRepositoryLink[]> {
    const result = await this.#pool.query<LinkRow>(`select ${LINK_COLUMNS} from admin.project_repository where project_id = $1 order by created_at, repository_id`, [projectId]);
    return result.rows.map(toLink);
  }

  async linksOfRepositories(repositoryIds: readonly string[]): Promise<ProjectRepositoryLink[]> {
    if (repositoryIds.length === 0) return [];
    const result = await this.#pool.query<LinkRow>(`select ${LINK_COLUMNS} from admin.project_repository where repository_id = any($1::text[])`, [[...repositoryIds]]);
    return result.rows.map(toLink);
  }

  async addLink(link: ProjectRepositoryLink): Promise<void> {
    await guarded(() =>
      this.#pool.query("insert into admin.project_repository (project_id, application_id, repository_id, role, component) values ($1, $2, $3, $4, $5)", [
        link.projectId,
        link.applicationId,
        link.repositoryId,
        link.role,
        link.component ?? null,
      ]),
    );
  }

  async removeLink(projectId: string, repositoryId: string): Promise<boolean> {
    const result = await this.#pool.query("delete from admin.project_repository where project_id = $1 and repository_id = $2", [projectId, repositoryId]);
    return (result.rowCount ?? 0) > 0;
  }
}

function toProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    ...(row.description === null ? {} : { description: row.description }),
    // Every project is created with its document repo; "" only if the row was edited by hand.
    documentRepositoryId: row.document_repository_id ?? "",
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toApplication(row: ApplicationRow): ApplicationRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    disposition: row.disposition,
    ...(row.pipeline === null ? {} : { pipeline: row.pipeline }),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toLink(row: LinkRow): ProjectRepositoryLink {
  return {
    projectId: row.project_id,
    applicationId: row.application_id,
    repositoryId: row.repository_id,
    role: row.role,
    ...(row.component === null ? {} : { component: row.component }),
  };
}
