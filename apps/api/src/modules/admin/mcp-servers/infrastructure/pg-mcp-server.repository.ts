// Postgres adapter for the MCP server registry (ADR-0047; schema: admin, migration 021). Header
// values live in admin.mcp_secret as AES-256-GCM ciphertext and are referenced from the server row as
// { secretId }; plaintext never leaves this adapter except through resolveHeaders (the connection test).

import { Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { getPool, withTransaction } from "#common/db/pool.js";
import { readSecret, type SecretTable, storeSecret } from "#common/db/secret-store.js";
import type { McpServerRecord, RegisterMcpServer } from "../domain/mcp-server.js";
import { McpServerRepository } from "../domain/mcp-server.ports.js";

const SECRETS: SecretTable = { table: "admin.mcp_secret", ownerColumn: "server_id" };

const COLUMNS = "id, url, description, enabled, timeout_sec, allowed_tools, headers, updated_by, created_at, updated_at";

interface Row {
  id: string;
  url: string;
  description: string | null;
  enabled: boolean;
  timeout_sec: number;
  allowed_tools: string[];
  headers: Record<string, { secretId: string }>;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
}

const headerSecretId = (serverId: string, name: string): string => `mcp:${serverId}:header:${encodeURIComponent(name)}`;

const toRecord = (row: Row): McpServerRecord => ({
  id: row.id,
  url: row.url,
  ...(row.description === null ? {} : { description: row.description }),
  enabled: row.enabled,
  timeoutSec: row.timeout_sec,
  allowedTools: row.allowed_tools,
  headerNames: Object.keys(row.headers).sort(),
  ...(row.updated_by === null ? {} : { updatedBy: row.updated_by }),
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

@Injectable()
export class PgMcpServerRepository extends McpServerRepository {
  get #pool(): Pool {
    return getPool();
  }

  async list(): Promise<McpServerRecord[]> {
    const result = await this.#pool.query<Row>(`select ${COLUMNS} from admin.mcp_server order by id`);
    return result.rows.map(toRecord);
  }

  async get(id: string): Promise<McpServerRecord | undefined> {
    const row = (await this.#pool.query<Row>(`select ${COLUMNS} from admin.mcp_server where id = $1`, [id])).rows[0];
    return row === undefined ? undefined : toRecord(row);
  }

  async create(input: RegisterMcpServer): Promise<McpServerRecord> {
    await withTransaction(async (client) => {
      // The secrets reference the server row, so the row comes first and then learns which headers it holds.
      await client.query(
        `insert into admin.mcp_server (id, url, description, enabled, timeout_sec, allowed_tools, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [input.id, input.url, input.description ?? null, input.enabled, input.timeoutSec, input.allowedTools, input.actor ?? null],
      );
      const references = await this.#storeHeaders(client, input.id, input.headers, {});
      await client.query("update admin.mcp_server set headers = $2 where id = $1", [input.id, JSON.stringify(references)]);
    });
    return (await this.get(input.id))!;
  }

  async replace(id: string, input: RegisterMcpServer): Promise<McpServerRecord | undefined> {
    const existing = (await this.#pool.query<Row>(`select ${COLUMNS} from admin.mcp_server where id = $1`, [id])).rows[0];
    if (existing === undefined) return undefined;
    await withTransaction(async (client) => {
      const references = await this.#storeHeaders(client, id, input.headers, existing.headers);
      const kept = Object.values(references).map((reference) => reference.secretId);
      await client.query("delete from admin.mcp_secret where server_id = $1 and not (secret_id = any($2::text[]))", [id, kept]);
      await client.query(
        `update admin.mcp_server set url = $2, description = $3, enabled = $4, timeout_sec = $5, allowed_tools = $6, headers = $7, updated_by = $8, updated_at = now()
          where id = $1`,
        [id, input.url, input.description ?? null, input.enabled, input.timeoutSec, input.allowedTools, JSON.stringify(references), input.actor ?? null],
      );
    });
    return this.get(id);
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.#pool.query("delete from admin.mcp_server where id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async resolveHeaders(id: string): Promise<Record<string, string> | undefined> {
    const row = (await this.#pool.query<Row>(`select ${COLUMNS} from admin.mcp_server where id = $1`, [id])).rows[0];
    if (row === undefined) return undefined;
    const resolved: Record<string, string> = {};
    for (const [name, reference] of Object.entries(row.headers)) resolved[name] = (await readSecret(this.#pool, SECRETS, reference.secretId)) ?? "";
    return resolved;
  }

  /** Encrypts the entered header values; a `null` value keeps the stored one. Returns the references to save. */
  async #storeHeaders(
    client: Parameters<typeof storeSecret>[0],
    serverId: string,
    headers: Record<string, string | null>,
    stored: Record<string, { secretId: string }>,
  ): Promise<Record<string, { secretId: string }>> {
    const references: Record<string, { secretId: string }> = {};
    for (const [rawName, value] of Object.entries(headers)) {
      const name = rawName.toLowerCase();
      if (value === null) {
        const kept = stored[name];
        if (kept !== undefined) references[name] = kept;
        continue;
      }
      const secretId = headerSecretId(serverId, name);
      await storeSecret(client, SECRETS, serverId, secretId, value);
      references[name] = { secretId };
    }
    return references;
  }
}
