import { afterEach, describe, expect, it, vi } from "vitest";
import { connectionProbe } from "#modules/admin/llm-providers/application/connection-probe.js";
import { LlmProvidersService } from "#modules/admin/llm-providers/application/llm-providers.service.js";
import type { LlmProviderRecord } from "#modules/admin/llm-providers/domain/llm-provider.js";
import type { LlmProviderRepository } from "#modules/admin/llm-providers/domain/llm-provider.repository.js";
import type { ProviderCatalog } from "#modules/admin/llm-providers/domain/provider-catalog.js";

describe("connectionProbe", () => {
  it("uses Bearer auth on /models for OpenAI-style APIs", () => {
    expect(connectionProbe("openai-completions", "https://gw.example/v1/", "k")).toEqual({
      url: "https://gw.example/v1/models",
      headers: { accept: "application/json", authorization: "Bearer k" },
    });
    expect(connectionProbe("openai-responses", "https://api.openai.com/v1", "k")?.url).toBe("https://api.openai.com/v1/models");
  });

  it("uses x-api-key and anthropic-version for Anthropic, adding /v1 when missing", () => {
    expect(connectionProbe("anthropic-messages", "https://api.anthropic.com", "k")).toEqual({
      url: "https://api.anthropic.com/v1/models",
      headers: { accept: "application/json", "x-api-key": "k", "anthropic-version": "2023-06-01" },
    });
    expect(connectionProbe("anthropic-messages", "https://gw.example/v1", "k")?.url).toBe("https://gw.example/v1/models");
  });

  it("uses x-goog-api-key for Gemini and Bearer /v1/models for Mistral", () => {
    expect(connectionProbe("google-generative-ai", "https://generativelanguage.googleapis.com/v1beta", "k")?.headers).toMatchObject({ "x-goog-api-key": "k" });
    expect(connectionProbe("mistral-conversations", "https://api.mistral.ai", "k")?.url).toBe("https://api.mistral.ai/v1/models");
  });

  it("has no probe for other protocols or templated URLs", () => {
    expect(connectionProbe("bedrock-converse-stream", "https://bedrock-runtime.us-east-1.amazonaws.com", "k")).toBeUndefined();
    expect(connectionProbe("openai-completions", "https://gateway.example/{ACCOUNT_ID}/v1", "k")).toBeUndefined();
    expect(connectionProbe("openai-completions", "", "k")).toBeUndefined();
  });
});

describe("LlmProvidersService.testConnection", () => {
  afterEach(() => vi.unstubAllGlobals());

  function service(record: LlmProviderRecord, endpoint?: { api: string; baseUrl: string }) {
    const repository = {
      get: async () => record,
      resolveApiKey: async () => "stored-key",
    } as unknown as LlmProviderRepository;
    const catalog = { list: () => ({ builtin: [], customApis: [] }), endpointOf: () => endpoint } as unknown as ProviderCatalog;
    return new LlmProvidersService(repository, catalog);
  }

  const custom = (api: string): LlmProviderRecord =>
    ({
      id: "gw",
      kind: "custom",
      enabled: true,
      hasApiKey: true,
      envKeys: [],
      config: { kind: "custom", id: "gw", enabled: true, api, baseUrl: "https://gw.example/v1", models: [{ id: "m" }], auth: { type: "api-key", key: { secretId: "s1" } } },
      updatedAt: "2026-10-10T00:00:00Z",
    }) as unknown as LlmProviderRecord;

  const builtin = (auth: { type: string; [field: string]: unknown }): LlmProviderRecord =>
    ({
      id: "main",
      kind: "builtin",
      enabled: true,
      hasApiKey: auth.type === "api-key",
      envKeys: auth.type === "env" ? ["REGION"] : [],
      config: { kind: "builtin", id: "main", enabled: true, piProvider: "anthropic", auth },
      updatedAt: "2026-10-10T00:00:00Z",
    }) as unknown as LlmProviderRecord;

  it("probes a custom provider at its stored endpoint with protocol headers", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await service(custom("anthropic-messages")).testConnection("gw");
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("https://gw.example/v1/models", expect.objectContaining({ headers: expect.objectContaining({ "x-api-key": "stored-key" }) }));
  });

  it("probes a builtin provider at the catalog endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response("unauthorized", { status: 401, statusText: "Unauthorized" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await service(builtin({ type: "api-key", key: { secretId: "s1" } }), { api: "anthropic-messages", baseUrl: "https://api.anthropic.com" }).testConnection("main");
    expect(result).toEqual({ ok: false, message: "GET https://api.anthropic.com/v1/models → 401 Unauthorized" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reports unsupported protocols without calling out", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await service(custom("bedrock-converse-stream")).testConnection("gw");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not supported for the "bedrock-converse-stream" protocol/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports builtin providers without a single endpoint, and env-only credentials, as unsupported", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await service(builtin({ type: "api-key", key: { secretId: "s1" } })).testConnection("main")).message).toMatch(/no single fixed endpoint/);
    const envOnly = await service(builtin({ type: "env", vars: { REGION: { secretId: "s2" } } }), { api: "anthropic-messages", baseUrl: "https://api.anthropic.com" }).testConnection("main");
    expect(envOnly.message).toMatch(/environment-based credentials/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports network failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))));
    expect(await service(custom("openai-completions")).testConnection("gw")).toEqual({ ok: false, message: "GET https://gw.example/v1/models failed: ECONNREFUSED" });
  });
});
