// Postgres adapter for the MCP server registry (ADR-0047; schema: admin). Like the provider registry,
// it runs in kintsugi-worker, which owns Postgres access: it resolves the servers a job's agent names,
// with their headers decrypted, and the launcher hands them to the job's child process on stdin only.

import { decryptSecret } from "@kintsugi/secrets";
import type { McpServerSpec } from "@kintsugi/runtime-sdk";
import { Pool } from "pg";

interface Row {
  id: string;
  url: string;
  description: string | null;
  timeout_sec: number;
  allowed_tools: string[];
  headers: Record<string, { secretId: string }>;
}

/** The enabled servers with these ids; throws when one is missing or disabled, so a job never starts without a server its agent needs. */
export async function loadMcpServers(ids: readonly string[], databaseUrl = process.env["DATABASE_URL"]): Promise<McpServerSpec[]> {
  if (ids.length === 0) return [];
  if (databaseUrl === undefined || databaseUrl === "") throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const servers = await pool.query<Row>("select id, url, description, timeout_sec, allowed_tools, headers from admin.mcp_server where id = any($1) and enabled", [[...ids]]);
    const secrets = await pool.query<{ secret_id: string; ciphertext: string; iv: string; auth_tag: string }>(
      "select secret_id, ciphertext, iv, auth_tag from admin.mcp_secret where server_id = any($1)",
      [[...ids]],
    );
    const plain = new Map(secrets.rows.map((secret) => [secret.secret_id, decryptSecret({ ciphertext: secret.ciphertext, iv: secret.iv, authTag: secret.auth_tag })]));
    const found = new Map(servers.rows.map((row) => [row.id, row]));
    return ids.map((id): McpServerSpec => {
      const row = found.get(id);
      if (row === undefined) throw new Error(`MCP server "${id}" is not registered or is disabled (Settings → MCP servers)`);
      return {
        name: row.id,
        url: row.url,
        headers: Object.fromEntries(Object.entries(row.headers).map(([name, ref]) => [name, plain.get(ref.secretId) ?? ""])),
        timeoutSec: row.timeout_sec,
        ...(row.description === null ? {} : { description: row.description }),
        allowedTools: row.allowed_tools,
      };
    });
  } finally {
    await pool.end();
  }
}
