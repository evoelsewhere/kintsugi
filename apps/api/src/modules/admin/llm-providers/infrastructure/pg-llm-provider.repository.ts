// Postgres adapter for the LLM provider registry (ADR-0009, ADR-0010; schema: admin).
// Secrets live in admin.llm_secret as AES-256-GCM ciphertext and are referenced from
// the stored config as { secretId } — plaintext never leaves this adapter.

import { Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { decryptSecret, encryptSecret } from "@kintsugi/secrets";
import type { AgentModelBinding, CustomModelConfig, LlmProviderConfig, SecretRef } from "@kintsugi/runtime-sdk";
import type { ThinkingLevel } from "@kintsugi/domain";
import type { Pool } from "pg";
import { getPool, type Queryable, withTransaction } from "../../../../common/db/pool.js";
import type { LlmProviderRecord, ProviderConfigInput, ProviderCredentials, RegisterLlmProvider } from "../domain/llm-provider.js";
import { LlmProviderRepository } from "../domain/llm-provider.repository.js";

interface StoredAuth {
  type: "api-key" | "env" | "none";
  key?: { secretId: string };
  vars?: Record<string, string>;
}

interface StoredConfig {
  kind: "builtin" | "custom";
  id: string;
  enabled: boolean;
  auth: StoredAuth;
  piProvider?: string;
  enabledModels?: string[];
  modelOverrides?: Record<string, unknown>;
  api?: string;
  baseUrl?: string;
  headers?: Record<string, string | SecretRef>;
  models?: CustomModelConfig[];
}

interface ProviderRow {
  id: string;
  kind: "builtin" | "custom";
  config: StoredConfig;
  enabled: boolean;
  updated_at: Date;
}

const apiKeySecretId = (providerId: string): string => `provider:${providerId}:api-key`;
const headerSecretId = (providerId: string, name: string): string => `provider:${providerId}:header:${encodeURIComponent(name)}`;

interface PreparedConfig {
  config: StoredConfig;
  headerSecrets: Array<[string, string]>;
  staleHeaderSecretIds: string[];
}

@Injectable()
export class PgLlmProviderRepository extends LlmProviderRepository implements OnApplicationBootstrap {
  get #pool(): Pool {
    return getPool();
  }

  /** Runs after ensureSchema() (main.ts), before the API serves requests. */
  async onApplicationBootstrap(): Promise<void> {
    await this.encryptLegacyHeaders();
  }

  /**
   * Older installations stored custom header values as plaintext in the provider JSON.
   * Moves them into admin.llm_secret once at startup, so reads never write.
   */
  async encryptLegacyHeaders(): Promise<void> {
    const result = await this.#pool.query<{ id: string }>(
      `select id from admin.llm_provider
        where kind = 'custom'
          and exists (select 1 from jsonb_each(coalesce(config->'headers', '{}'::jsonb)) as header where jsonb_typeof(header.value) = 'string')`,
    );
    for (const { id } of result.rows) {
      await withTransaction(async (client) => {
        const locked = await client.query<ProviderRow>("select id, kind, config, enabled, updated_at from admin.llm_provider where id = $1 for update", [id]);
        const current = locked.rows[0];
        if (current === undefined) return;
        // Every header kept as-is (null = keep the stored value): plaintext ones are encrypted on the way.
        const configInput = {
          ...current.config,
          headers: Object.fromEntries(Object.keys(current.config.headers ?? {}).map((name) => [name, null])),
        } as unknown as ProviderConfigInput;
        const prepared = this.#buildStoredConfig(
          { id: current.id, enabled: current.enabled, config: configInput, credentials: {} },
          current.config.auth,
          current.config,
        );
        await client.query("update admin.llm_provider set config = $2, updated_at = now() where id = $1", [current.id, JSON.stringify(prepared.config)]);
        await this.#storeSecrets(client, current.id, {}, prepared.headerSecrets);
      });
    }
  }

  async list(): Promise<LlmProviderRecord[]> {
    const result = await this.#pool.query<ProviderRow>("select id, kind, config, enabled, updated_at from admin.llm_provider order by id");
    return Promise.all(result.rows.map((row) => this.#toRecord(row)));
  }

  async get(id: string): Promise<LlmProviderRecord | undefined> {
    const result = await this.#pool.query<ProviderRow>("select id, kind, config, enabled, updated_at from admin.llm_provider where id = $1", [id]);
    const row = result.rows[0];
    return row === undefined ? undefined : this.#toRecord(row);
  }

  async create(input: RegisterLlmProvider): Promise<LlmProviderRecord> {
    const prepared = this.#buildStoredConfig(input);
    const config = prepared.config;
    await withTransaction(async (client) => {
      await client.query("insert into admin.llm_provider (id, kind, config) values ($1, $2, $3)", [input.id, config.kind, JSON.stringify(config)]);
      await this.#storeSecrets(client, input.id, input.credentials, prepared.headerSecrets);
    });
    return (await this.get(input.id))!;
  }

  async replace(id: string, input: RegisterLlmProvider): Promise<LlmProviderRecord | undefined> {
    const existing = await this.get(id);
    if (existing === undefined) return undefined;

    const hasNewCredentials = input.credentials.apiKey !== undefined || input.credentials.env !== undefined;
    const prepared = this.#buildStoredConfig(
      input,
      hasNewCredentials ? undefined : (existing.config.auth as StoredAuth),
      existing.config as StoredConfig,
    );
    const config = prepared.config;
    await withTransaction(async (client) => {
      await client.query("update admin.llm_provider set config = $2, enabled = $3, updated_at = now() where id = $1", [
        id,
        JSON.stringify(config),
        config.enabled,
      ]);
      if (hasNewCredentials) {
        // Replace API/env credentials but retain encrypted header values still referenced by this config.
        const headerSecretIds = Object.values(config.headers ?? {}).flatMap((value) => (typeof value === "string" ? [] : [value.secretId]));
        await client.query("delete from admin.llm_secret where provider_id = $1 and not (secret_id = any($2::text[]))", [id, headerSecretIds]);
      } else if (prepared.staleHeaderSecretIds.length > 0) {
        await client.query("delete from admin.llm_secret where provider_id = $1 and secret_id = any($2::text[])", [id, prepared.staleHeaderSecretIds]);
      }
      if (hasNewCredentials || prepared.headerSecrets.length > 0) {
        await this.#storeSecrets(client, id, hasNewCredentials ? input.credentials : {}, prepared.headerSecrets);
      }
    });
    return (await this.get(id))!;
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.#pool.query("delete from admin.llm_provider where id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async listBindings(): Promise<AgentModelBinding[]> {
    const result = await this.#pool.query<{ agent: string; project_id: string; provider_id: string; model: string; thinking: string | null }>(
      "select agent, project_id, provider_id, model, thinking from admin.agent_model_binding order by agent, project_id",
    );
    return result.rows.map((row) => ({
      agent: row.agent as AgentModelBinding["agent"],
      ...(row.project_id === "*" ? {} : { projectId: row.project_id }),
      provider: row.provider_id,
      model: row.model,
      ...(row.thinking === null ? {} : { thinking: row.thinking as ThinkingLevel }),
    }));
  }

  async replaceBindings(bindings: AgentModelBinding[]): Promise<void> {
    await withTransaction(async (client) => {
      await client.query("delete from admin.agent_model_binding");
      for (const binding of bindings) {
        await client.query(
          "insert into admin.agent_model_binding (agent, project_id, provider_id, model, thinking) values ($1, $2, $3, $4, $5)",
          [binding.agent, binding.projectId ?? "*", binding.provider, binding.model, binding.thinking ?? null],
        );
      }
    });
  }

  async resolveApiKey(providerId: string): Promise<string | undefined> {
    return this.resolveSecret(apiKeySecretId(providerId));
  }

  /** Resolves a stored { secretId } to its plaintext — connectivity checks and the runtime launcher only. */
  async resolveSecret(secretId: string): Promise<string | undefined> {
    const result = await this.#pool.query<{ ciphertext: string; iv: string; auth_tag: string }>(
      "select ciphertext, iv, auth_tag from admin.llm_secret where secret_id = $1",
      [secretId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag });
  }

  #buildStoredConfig(input: RegisterLlmProvider, keepAuth?: StoredAuth, existing?: StoredConfig): PreparedConfig {
    const { kind, headers: incomingHeaders, ...configFields } = input.config as ProviderConfigInput & {
      kind: "builtin" | "custom";
      headers?: Record<string, string | null>;
    };
    const oldHeaders = existing?.kind === "custom" ? existing.headers : undefined;
    // HTTP header names are case-insensitive: stored lower-case, matched lower-case.
    const previousByName = new Map(Object.entries(oldHeaders ?? {}).map(([name, value]) => [name.toLowerCase(), value]));
    const headers: Record<string, SecretRef> = {};
    const headerSecrets: Array<[string, string]> = [];

    for (const [rawName, value] of Object.entries(incomingHeaders ?? {})) {
      const name = rawName.toLowerCase();
      if (value === null) {
        const previous = previousByName.get(name);
        if (previous === undefined) continue;
        if (typeof previous === "string") {
          const secretId = headerSecretId(input.id, name);
          headers[name] = { secretId };
          headerSecrets.push([secretId, previous]);
        } else {
          headers[name] = previous;
        }
      } else {
        const secretId = headerSecretId(input.id, name);
        headers[name] = { secretId };
        headerSecrets.push([secretId, value]);
      }
    }

    const retainedHeaderSecretIds = new Set(Object.values(headers).map((value) => value.secretId));
    const staleHeaderSecretIds = Object.entries(oldHeaders ?? {})
      .map(([name, value]) => (typeof value === "string" ? headerSecretId(input.id, name.toLowerCase()) : value.secretId))
      .filter((secretId) => !retainedHeaderSecretIds.has(secretId));
    const auth = keepAuth ?? this.#authFor(input.id, input.credentials);
    return {
      config: {
        ...(configFields as Omit<StoredConfig, "kind" | "id" | "enabled" | "auth" | "headers">),
        ...(kind === "custom" && Object.keys(headers).length > 0 ? { headers } : {}),
        kind,
        id: input.id,
        enabled: input.enabled,
        auth,
      },
      headerSecrets,
      staleHeaderSecretIds,
    };
  }

  #authFor(providerId: string, credentials: ProviderCredentials): StoredAuth {
    if (credentials.apiKey !== undefined) return { type: "api-key", key: { secretId: apiKeySecretId(providerId) } };
    if (credentials.env !== undefined && Object.keys(credentials.env).length > 0) {
      return { type: "env", vars: Object.fromEntries(Object.keys(credentials.env).map((name) => [name, `${apiKeySecretId(providerId)}:env:${name}`])) };
    }
    return { type: "none" };
  }

  async #storeSecrets(
    db: Queryable,
    providerId: string,
    credentials: ProviderCredentials,
    headerSecrets: Array<[string, string]> = [],
  ): Promise<void> {
    const entries: Array<[string, string]> = [];
    if (credentials.apiKey !== undefined) entries.push([apiKeySecretId(providerId), credentials.apiKey]);
    for (const [name, value] of Object.entries(credentials.env ?? {})) {
      entries.push([`${apiKeySecretId(providerId)}:env:${name}`, value]);
    }
    entries.push(...headerSecrets);
    for (const [secretId, plaintext] of entries) {
      const encrypted = encryptSecret(plaintext);
      await db.query(
        `insert into admin.llm_secret (secret_id, provider_id, ciphertext, iv, auth_tag)
         values ($1, $2, $3, $4, $5)
         on conflict (secret_id) do update set ciphertext = $3, iv = $4, auth_tag = $5`,
        [secretId, providerId, encrypted.ciphertext, encrypted.iv, encrypted.authTag],
      );
    }
  }

  async #secretExists(secretId: string): Promise<boolean> {
    const result = await this.#pool.query("select 1 from admin.llm_secret where secret_id = $1", [secretId]);
    return (result.rowCount ?? 0) > 0;
  }

  async #toRecord(row: ProviderRow): Promise<LlmProviderRecord> {
    const config = row.config;
    const auth = config.auth;
    const envKeys = auth.type === "env" && auth.vars !== undefined ? Object.keys(auth.vars) : [];
    // Presence only: listing never decrypts, so a rotated or missing key cannot break reads.
    const hasApiKey = auth.type === "api-key" && auth.key !== undefined ? await this.#secretExists(auth.key.secretId) : false;
    return {
      id: row.id,
      kind: row.kind,
      enabled: row.enabled,
      config: config as unknown as LlmProviderConfig,
      hasApiKey,
      envKeys,
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
