// Application layer: use cases of the LLM provider registry (Settings → Providers).
// Depends on the domain port only; knows nothing about HTTP or Postgres.

import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { AgentModelBinding, CustomModelConfig } from "@kintsugi/runtime-sdk";
import type { Page, PageQuery } from "#common/application/pagination.js";
import { toPage } from "#common/application/pagination.js";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import type { Actor } from "#common/auth/decorators.js";
import type { LlmProviderRecord, ProviderConfigInput, ProviderKind, RegisterLlmProvider } from "../domain/llm-provider.js";
import { LlmProviderRepository } from "../domain/llm-provider.repository.js";
import type { SupportedProviders } from "../domain/provider-catalog.js";
import { ProviderCatalog } from "../domain/provider-catalog.js";
import { connectionProbe } from "./connection-probe.js";

/** Presentation view: configuration with every credential redacted. */
export interface LlmProviderView {
  id: string;
  kind: ProviderKind;
  enabled: boolean;
  hasApiKey: boolean;
  envKeys: string[];
  piProvider?: string;
  enabledModels?: string[];
  modelOverrides?: Record<string, unknown>;
  api?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  models?: CustomModelConfig[];
  updatedAt: string;
}

export interface TestConnectionResult {
  ok: boolean;
  message: string;
}

function toView(record: LlmProviderRecord): LlmProviderView {
  const config = record.config;
  return {
    id: record.id,
    kind: record.kind,
    enabled: record.enabled,
    hasApiKey: record.hasApiKey,
    envKeys: record.envKeys,
    updatedAt: record.updatedAt,
    ...(config.kind === "builtin"
      ? { piProvider: config.piProvider, enabledModels: config.enabledModels, modelOverrides: config.modelOverrides as Record<string, unknown> | undefined }
      : {
          api: config.api,
          baseUrl: config.baseUrl,
          // SecretRef values are masked — the API never returns credentials.
          headers: config.headers === undefined ? undefined : Object.fromEntries(Object.keys(config.headers).map((name) => [name, "[secret]"])),
          models: config.models,
        }),
  };
}

/** True when the replacement keeps a stored header value (`null` = keep). */
function keepsStoredHeaders(config: ProviderConfigInput): boolean {
  return config.kind === "custom" && Object.values(config.headers ?? {}).some((value) => value === null);
}

/** Where a provider's credential is sent: the pi catalog entry, or the custom wire protocol + base URL. */
function endpointOf(config: ProviderConfigInput | LlmProviderRecord["config"]): string {
  return config.kind === "builtin" ? `builtin:${config.piProvider}` : `custom:${config.api}:${config.baseUrl.replace(/\/$/, "")}`;
}

/** The names of the credentials a command enters (never their values): `apiKey` and/or `env`. */
function credentialFields(credentials: RegisterLlmProvider["credentials"]): string[] {
  return [...(credentials.apiKey === undefined ? [] : ["apiKey"]), ...(credentials.env === undefined ? [] : ["env"])];
}

/** What a provider is, for the audit log: kind plus the pi provider or wire protocol (no URLs, headers or keys). */
function providerSummary(config: ProviderConfigInput | LlmProviderRecord["config"]): Record<string, string> {
  return config.kind === "builtin" ? { kind: config.kind, piProvider: config.piProvider } : { kind: config.kind, api: config.api };
}

/** The names of the settings a replacement changes (header and credential values are never compared or recorded). */
function changedProviderFields(existing: LlmProviderRecord, input: RegisterLlmProvider): string[] {
  const fields = new Set<string>(credentialFields(input.credentials));
  if (existing.enabled !== input.enabled) fields.add("enabled");
  const before = existing.config as unknown as Record<string, unknown>;
  const after = input.config as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === "auth") continue;
    if (key === "headers") {
      const kept = Object.keys((before.headers ?? {}) as object).sort().join("\n");
      const entered = Object.entries((after.headers ?? {}) as Record<string, string | null>);
      if (kept !== entered.map(([name]) => name).sort().join("\n") || entered.some(([, value]) => value !== null)) fields.add("headers");
      continue;
    }
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) fields.add(key);
  }
  return [...fields].sort();
}

@Injectable()
export class LlmProvidersService {
  constructor(
    private readonly providers: LlmProviderRepository,
    private readonly catalog: ProviderCatalog,
    private readonly audit: AuditTrail,
  ) {}

  /** Providers and models this installation can call (read from the pinned pi release). */
  supported(): SupportedProviders {
    return this.catalog.list();
  }

  async list(): Promise<LlmProviderView[]> {
    return (await this.providers.list()).map(toView);
  }

  /** Paginated listing. TODO: push limit/offset down into the Postgres adapter. */
  async listPage(query: PageQuery): Promise<Page<LlmProviderView>> {
    const records = await this.providers.list();
    const page = toPage(records.slice(query.offset, query.offset + query.limit), records.length, query);
    return { ...page, items: page.items.map(toView) };
  }

  async get(id: string): Promise<LlmProviderView> {
    return toView(await this.#mustGet(id));
  }

  async create(input: RegisterLlmProvider, actor: Actor): Promise<LlmProviderView> {
    const existing = await this.providers.get(input.id);
    if (existing !== undefined) throw new ConflictException(`LLM provider ${input.id} already exists`);
    const created = await this.providers.create(input);
    await this.audit.recordChange(
      auditRecord(actor, AUDIT_ACTIONS.llmProviderCreate, {
        subject: created.id,
        detail: { ...providerSummary(input.config), enabled: created.enabled, credentials: credentialFields(input.credentials) },
      }),
    );
    return toView(created);
  }

  async replace(id: string, input: RegisterLlmProvider, actor: Actor): Promise<LlmProviderView> {
    const existing = await this.#mustGet(id);
    const hasNewCredentials = input.credentials.apiKey !== undefined || input.credentials.env !== undefined;
    // A stored credential stays bound to the endpoint it was entered for; otherwise
    // repointing the provider would send the kept key to an arbitrary host.
    const endpointChanged = endpointOf(existing.config) !== endpointOf(input.config);
    if (endpointChanged && !hasNewCredentials) {
      throw new BadRequestException("Changing the provider endpoint requires re-entering its credential");
    }
    // Stored header values are bound to the endpoint the same way (gateways put keys in headers).
    if (endpointChanged && keepsStoredHeaders(input.config)) {
      throw new BadRequestException("Changing the provider endpoint requires re-entering its header values");
    }
    const updated = await this.providers.replace(id, input);
    if (updated === undefined) throw new NotFoundException(`LLM provider ${id} not found`);
    await this.audit.recordChange(
      auditRecord(actor, AUDIT_ACTIONS.llmProviderUpdate, { subject: id, detail: { ...providerSummary(input.config), fields: changedProviderFields(existing, input) } }),
    );
    return toView(updated);
  }

  async remove(id: string, actor: Actor): Promise<void> {
    const existing = await this.providers.get(id);
    if (!(await this.providers.remove(id))) throw new NotFoundException(`LLM provider ${id} not found`);
    await this.audit.recordChange(
      auditRecord(actor, AUDIT_ACTIONS.llmProviderDelete, { subject: id, ...(existing === undefined ? {} : { detail: providerSummary(existing.config) }) }),
    );
  }

  listBindings(): Promise<AgentModelBinding[]> {
    return this.providers.listBindings();
  }

  async replaceBindings(bindings: AgentModelBinding[], actor: Actor): Promise<AgentModelBinding[]> {
    for (const binding of bindings) {
      await this.#mustGet(binding.provider);
    }
    await this.providers.replaceBindings(bindings);
    await this.audit.recordChange(
      auditRecord(actor, AUDIT_ACTIONS.modelBindingsSave, {
        detail: { bindings: bindings.map((binding) => (binding.projectId === undefined ? binding.agent : `${binding.agent}@${binding.projectId}`)) },
      }),
    );
    return this.providers.listBindings();
  }

  /**
   * Best-effort connectivity check from the API host (the definitive check runs with the
   * job): an authenticated model listing against the provider's own endpoint — the stored
   * base URL for custom providers, pi's catalog endpoint for builtin ones.
   */
  async testConnection(id: string): Promise<TestConnectionResult> {
    const record = await this.#mustGet(id);
    const view = toView(record);

    if (!view.hasApiKey && view.envKeys.length === 0) {
      return { ok: false, message: "No credential stored for this provider." };
    }
    const endpoint =
      view.kind === "custom"
        ? { api: view.api ?? "", baseUrl: view.baseUrl ?? "" }
        : this.catalog.endpointOf(view.piProvider ?? "");
    if (endpoint === undefined) {
      return { ok: false, message: `Connection test not supported for "${view.piProvider ?? id}": it has no single fixed endpoint; it is checked when a runtime job runs.` };
    }
    if (!view.hasApiKey) {
      return { ok: false, message: `Connection test not supported for environment-based credentials (${endpoint.api}); they are checked when a runtime job runs.` };
    }

    const secret = await this.providers.resolveApiKey(id);
    if (secret === undefined) return { ok: false, message: "Stored credential could not be resolved." };

    const extraHeaders = await this.#resolveHeaders(record);
    if (extraHeaders === undefined) return { ok: false, message: "A stored header value could not be resolved." };
    const probe = connectionProbe(endpoint.api, endpoint.baseUrl, secret, extraHeaders);
    if (probe === undefined) {
      return { ok: false, message: `Connection test not supported for the "${endpoint.api}" protocol; it is checked when a runtime job runs.` };
    }
    try {
      const response = await fetch(probe.url, { headers: probe.headers, signal: AbortSignal.timeout(5000) });
      return {
        ok: response.ok,
        message: response.ok ? `Reachable: GET ${probe.url} → ${response.status}` : `GET ${probe.url} → ${response.status} ${response.statusText}`,
      };
    } catch (error) {
      return { ok: false, message: `GET ${probe.url} failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /** A custom provider's header values in plaintext, or undefined when one is missing. */
  async #resolveHeaders(record: LlmProviderRecord): Promise<Record<string, string> | undefined> {
    if (record.config.kind !== "custom") return {};
    const resolved: Record<string, string> = {};
    for (const [name, value] of Object.entries(record.config.headers ?? {})) {
      const plaintext = typeof value === "string" ? value : await this.providers.resolveSecret(value.secretId);
      if (plaintext === undefined) return undefined;
      resolved[name] = plaintext;
    }
    return resolved;
  }

  async #mustGet(id: string): Promise<LlmProviderRecord> {
    const record = await this.providers.get(id);
    if (record === undefined) throw new NotFoundException(`LLM provider ${id} not found`);
    return record;
  }
}
