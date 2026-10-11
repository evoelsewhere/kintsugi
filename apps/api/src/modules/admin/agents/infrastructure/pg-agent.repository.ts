// Postgres adapter for custom agents, their versions and shared skills (schema: admin,
// migration 012_agents.sql).

import { Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { getPool, withTransaction } from "#common/db/pool.js";
import type { AgentVersionRecord, CustomAgentRecord, PackageFileMap, SaveAgent, SharedSkillRecord } from "../domain/agent.js";
import { AgentRepository } from "../domain/agent.repository.js";

interface AgentRow {
  name: string;
  audience: CustomAgentRecord["audience"];
  version: string;
  package: PackageFileMap;
  enabled: boolean;
  copied_from: string | null;
  created_by: string | null;
  created_at: Date;
  updated_by: string | null;
  updated_at: Date;
}

interface VersionRow {
  version: string;
  package: PackageFileMap;
  created_by: string | null;
  created_at: Date;
}

interface SkillRow {
  name: string;
  content: string;
  created_by: string | null;
  updated_by: string | null;
  updated_at: Date;
}

const UNIQUE_VIOLATION = "23505";
const isUniqueViolation = (error: unknown): boolean => (error as { code?: string }).code === UNIQUE_VIOLATION;

const toAgent = (row: AgentRow): CustomAgentRecord => ({
  name: row.name,
  audience: row.audience,
  version: row.version,
  files: row.package,
  enabled: row.enabled,
  ...(row.copied_from === null ? {} : { copiedFrom: row.copied_from }),
  ...(row.created_by === null ? {} : { createdBy: row.created_by }),
  createdAt: row.created_at.toISOString(),
  ...(row.updated_by === null ? {} : { updatedBy: row.updated_by }),
  updatedAt: row.updated_at.toISOString(),
});

const toVersion = (row: VersionRow): AgentVersionRecord => ({
  version: row.version,
  files: row.package,
  ...(row.created_by === null ? {} : { createdBy: row.created_by }),
  createdAt: row.created_at.toISOString(),
});

const toSkill = (row: SkillRow): SharedSkillRecord => ({
  name: row.name,
  content: row.content,
  ...(row.created_by === null ? {} : { createdBy: row.created_by }),
  ...(row.updated_by === null ? {} : { updatedBy: row.updated_by }),
  updatedAt: row.updated_at.toISOString(),
});

const AGENT_COLUMNS = "name, audience, version, package, enabled, copied_from, created_by, created_at, updated_by, updated_at";

@Injectable()
export class PgAgentRepository extends AgentRepository {
  get #pool(): Pool {
    return getPool();
  }

  async list(): Promise<CustomAgentRecord[]> {
    const result = await this.#pool.query<AgentRow>(`select ${AGENT_COLUMNS} from admin.agent order by name`);
    return result.rows.map(toAgent);
  }

  async get(name: string): Promise<CustomAgentRecord | undefined> {
    const result = await this.#pool.query<AgentRow>(`select ${AGENT_COLUMNS} from admin.agent where name = $1`, [name]);
    const row = result.rows[0];
    return row === undefined ? undefined : toAgent(row);
  }

  async create(agent: SaveAgent, actor: string): Promise<boolean> {
    try {
      await withTransaction(async (client) => {
        await client.query(
          `insert into admin.agent (name, audience, version, package, copied_from, created_by, updated_by)
           values ($1, $2, $3, $4, $5, $6, $6)`,
          [agent.name, agent.audience, agent.version, JSON.stringify(agent.files), agent.copiedFrom ?? null, actor],
        );
        await client.query("insert into admin.agent_version (name, version, package, created_by) values ($1, $2, $3, $4)", [
          agent.name,
          agent.version,
          JSON.stringify(agent.files),
          actor,
        ]);
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async saveVersion(agent: SaveAgent, actor: string): Promise<boolean> {
    try {
      await withTransaction(async (client) => {
        await client.query("insert into admin.agent_version (name, version, package, created_by) values ($1, $2, $3, $4)", [
          agent.name,
          agent.version,
          JSON.stringify(agent.files),
          actor,
        ]);
        await client.query("update admin.agent set audience = $2, version = $3, package = $4, updated_by = $5, updated_at = now() where name = $1", [
          agent.name,
          agent.audience,
          agent.version,
          JSON.stringify(agent.files),
          actor,
        ]);
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async restore(name: string, version: AgentVersionRecord, audience: CustomAgentRecord["audience"], actor: string): Promise<void> {
    await this.#pool.query("update admin.agent set audience = $2, version = $3, package = $4, updated_by = $5, updated_at = now() where name = $1", [
      name,
      audience,
      version.version,
      JSON.stringify(version.files),
      actor,
    ]);
  }

  async setEnabled(name: string, enabled: boolean, actor: string): Promise<boolean> {
    const result = await this.#pool.query("update admin.agent set enabled = $2, updated_by = $3, updated_at = now() where name = $1", [name, enabled, actor]);
    return (result.rowCount ?? 0) > 0;
  }

  async remove(name: string): Promise<boolean> {
    const result = await this.#pool.query("delete from admin.agent where name = $1", [name]);
    return (result.rowCount ?? 0) > 0;
  }

  async versions(name: string): Promise<AgentVersionRecord[]> {
    const result = await this.#pool.query<VersionRow>(
      "select version, package, created_by, created_at from admin.agent_version where name = $1 order by created_at desc, version desc",
      [name],
    );
    return result.rows.map(toVersion);
  }

  async version(name: string, version: string): Promise<AgentVersionRecord | undefined> {
    const result = await this.#pool.query<VersionRow>("select version, package, created_by, created_at from admin.agent_version where name = $1 and version = $2", [
      name,
      version,
    ]);
    const row = result.rows[0];
    return row === undefined ? undefined : toVersion(row);
  }

  async listSkills(): Promise<SharedSkillRecord[]> {
    const result = await this.#pool.query<SkillRow>("select name, content, created_by, updated_by, updated_at from admin.agent_skill order by name");
    return result.rows.map(toSkill);
  }

  async getSkill(name: string): Promise<SharedSkillRecord | undefined> {
    const result = await this.#pool.query<SkillRow>("select name, content, created_by, updated_by, updated_at from admin.agent_skill where name = $1", [name]);
    const row = result.rows[0];
    return row === undefined ? undefined : toSkill(row);
  }

  async createSkill(name: string, content: string, actor: string): Promise<boolean> {
    try {
      await this.#pool.query("insert into admin.agent_skill (name, content, created_by, updated_by) values ($1, $2, $3, $3)", [name, content, actor]);
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async updateSkill(name: string, content: string, actor: string): Promise<boolean> {
    const result = await this.#pool.query("update admin.agent_skill set content = $2, updated_by = $3, updated_at = now() where name = $1", [name, content, actor]);
    return (result.rowCount ?? 0) > 0;
  }

  async removeSkill(name: string): Promise<boolean> {
    const result = await this.#pool.query("delete from admin.agent_skill where name = $1", [name]);
    return (result.rowCount ?? 0) > 0;
  }
}
