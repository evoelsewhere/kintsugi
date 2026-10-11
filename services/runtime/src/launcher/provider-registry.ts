// Postgres adapter for the LLM provider registry (ADR-0009, ADR-0010; schema: admin).
// The launcher runs in kintsugi-worker, which owns Postgres access; it resolves the
// job's credentials here; the launcher hands them to the job's child process only (ADR-0029).
// TODO: move to the worker's shared layer when services/orchestrator lands.

import { decryptSecret } from "@kintsugi/secrets";
import { Pool } from "pg";
import type { ResolvedCredentials, StoredAuth, StoredProviderConfig } from "./model-runtime.js";

export interface LoadedProvider {
  config: StoredProviderConfig;
  credentials: ResolvedCredentials;
}

export async function loadProvider(providerId: string, databaseUrl = process.env["DATABASE_URL"]): Promise<LoadedProvider> {
  if (databaseUrl === undefined || databaseUrl === "") throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const provider = await pool.query<{ config: StoredProviderConfig }>(
      "select config from admin.llm_provider where id = $1 and enabled",
      [providerId],
    );
    const row = provider.rows[0];
    if (row === undefined) throw new Error(`LLM provider ${providerId} not found or disabled`);
    const config = row.config;

    const secrets = await pool.query<{ secret_id: string; ciphertext: string; iv: string; auth_tag: string }>(
      "select secret_id, ciphertext, iv, auth_tag from admin.llm_secret where provider_id = $1",
      [providerId],
    );
    const resolved: Record<string, string> = {};
    for (const secret of secrets.rows) {
      resolved[secret.secret_id] = decryptSecret({ ciphertext: secret.ciphertext, iv: secret.iv, authTag: secret.auth_tag });
    }

    const credentials: ResolvedCredentials = { secrets: resolved, env: {} };
    const auth: StoredAuth | undefined = config.auth;
    if (auth?.type === "api-key" && auth.key !== undefined) {
      credentials.apiKey = resolved[auth.key.secretId];
    }
    if (auth?.type === "env" && auth.vars !== undefined) {
      for (const [name, ref] of Object.entries(auth.vars)) {
        credentials.env = { ...credentials.env, [name]: resolved[ref] ?? "" };
      }
    }
    return { config, credentials };
  } finally {
    await pool.end();
  }
}
