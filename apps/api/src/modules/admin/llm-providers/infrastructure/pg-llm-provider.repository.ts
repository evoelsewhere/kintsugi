// Postgres adapter for the LLM provider registry (ADR-0009, ADR-0010; schema: admin).
// Secrets live in admin.llm_secret as AES-256-GCM ciphertext and are referenced from
// the stored config as { secretId } — plaintext never leaves this adapter.

import { Injectable } from "@nestjs/common";
import type { AgentModelBinding, CustomModelConfig, LlmProviderConfig } from "@kintsugi/runtime-sdk";
import type { ThinkingLevel } from "@kintsugi/domain";
import type { Pool } from "pg";
import { decryptSecret, encryptSecret } from "../../../../common/db/crypto.js";
import { getPool } from "../../../../common/db/pool.js";
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
  headers?: Record<string, string>;
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

@Injectable()
export class PgLlmProviderRepository extends LlmProviderRepository {
  get #pool(): Pool {
    return getPool();
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
    const config = this.#buildStoredConfig(input);
    await this.#pool.query("insert into admin.llm_provider (id, kind, config) values ($1, $2, $3)", [input.id, config.kind, JSON.stringify(config)]);
    await this.#storeSecrets(input.id, input.credentials);
    return (await this.get(input.id))!;
  }

  async replace(id: string, input: RegisterLlmProvider): Promise<LlmProviderRecord | undefined> {
    const existing = await this.get(id);
    if (existing === undefined) return undefined;

    const hasNewCredentials = input.credentials.apiKey !== undefined || input.credentials.env !== undefined;
    const config = this.#buildStoredConfig(input, hasNewCredentials ? undefined : (existing.config.auth as StoredAuth));
    await this.#pool.query("update admin.llm_provider set config = $2, enabled = $3, updated_at = now() where id = $1", [
      id,
      JSON.stringify(config),
      config.enabled,
    ]);
    if (hasNewCredentials) await this.#storeSecrets(id, input.credentials);
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
    const client = await this.#pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from admin.agent_model_binding");
      for (const binding of bindings) {
        await client.query(
          "insert into admin.agent_model_binding (agent, project_id, provider_id, model, thinking) values ($1, $2, $3, $4, $5)",
          [binding.agent, binding.projectId ?? "*", binding.provider, binding.model, binding.thinking ?? null],
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
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

  #buildStoredConfig(input: RegisterLlmProvider, keepAuth?: StoredAuth): StoredConfig {
    const { kind, ...rest } = input.config as ProviderConfigInput & { kind: "builtin" | "custom" };
    void rest;
    const auth = keepAuth ?? this.#authFor(input.id, input.credentials);
    return {
      ...(input.config as Omit<StoredConfig, "kind" | "id" | "enabled" | "auth">),
      kind,
      id: input.id,
      enabled: input.enabled,
      auth,
    };
  }

  #authFor(providerId: string, credentials: ProviderCredentials): StoredAuth {
    if (credentials.apiKey !== undefined) return { type: "api-key", key: { secretId: apiKeySecretId(providerId) } };
    if (credentials.env !== undefined && Object.keys(credentials.env).length > 0) {
      return { type: "env", vars: Object.fromEntries(Object.keys(credentials.env).map((name) => [name, `${apiKeySecretId(providerId)}:env:${name}`])) };
    }
    return { type: "none" };
  }

  async #storeSecrets(providerId: string, credentials: ProviderCredentials): Promise<void> {
    const entries: Array<[string, string]> = [];
    if (credentials.apiKey !== undefined) entries.push([apiKeySecretId(providerId), credentials.apiKey]);
    for (const [name, value] of Object.entries(credentials.env ?? {})) {
      entries.push([`${apiKeySecretId(providerId)}:env:${name}`, value]);
    }
    for (const [secretId, plaintext] of entries) {
      const encrypted = encryptSecret(plaintext);
      await this.#pool.query(
        `insert into admin.llm_secret (secret_id, provider_id, ciphertext, iv, auth_tag)
         values ($1, $2, $3, $4, $5)
         on conflict (secret_id) do update set ciphertext = $3, iv = $4, auth_tag = $5`,
        [secretId, providerId, encrypted.ciphertext, encrypted.iv, encrypted.authTag],
      );
    }
  }

  async #toRecord(row: ProviderRow): Promise<LlmProviderRecord> {
    const auth = row.config.auth;
    const envKeys = auth.type === "env" && auth.vars !== undefined ? Object.keys(auth.vars) : [];
    const hasApiKey =
      auth.type === "api-key" && auth.key !== undefined ? (await this.resolveSecret(auth.key.secretId)) !== undefined : false;
    return {
      id: row.id,
      kind: row.kind,
      enabled: row.enabled,
      config: row.config as unknown as LlmProviderConfig,
      hasApiKey,
      envKeys,
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
