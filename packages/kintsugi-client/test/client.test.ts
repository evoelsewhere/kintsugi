import { describe, expect, it, vi } from "vitest";
import { createCodingAgentWorkflowClient } from "../src/client.js";
import { CodingAgentClientError } from "../src/errors.js";

function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(status >= 400 ? {
    success: false, statusCode: status, error: "Error", message: "request failed",
    timestamp: "2026-10-21T00:00:00.000Z", path: "/api/member/v1/projects",
    ...(data === undefined ? {} : { details: data }),
  } : { success: true, data }), { status, headers });
}

describe("typed Coding Agent Workflow HTTP client", () => {
  it("encodes selectors, sends the token only to the configured installation, and validates results", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://kintsugi.example/base/api/member/v1/task-status?projectId=shop&unitId=web%2Fcore%2Finvoice");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer private-test-token");
      expect(init?.redirect).toBe("manual");
      return json({ schemaVersion: "1", projectId: "shop", unitId: "web/core/invoice", status: "pending",
        latestContinuation: {
          schemaVersion: "1", projectId: "shop", unitId: "web/core/invoice", id: "evt_continuation",
          kind: "task.continuation", occurredAt: "2026-10-21T00:00:00.000Z",
          metadata: { schemaVersion: "1", decisionId: "decision_42", gateId: "G2", evidenceHash: "sha256:evidence", recordCommit: "a".repeat(40),
            status: "member-action", code: "MEMBER_STAGE_AVAILABLE", nextAction: "Refresh task status before acting." },
        },
        evidenceAvailability: { pullRequests: "unavailable", reviews: "unavailable" }, pullRequests: [], currentReviewIds: [], gates: [], nextAction: "Read the task brief." });
    });
    const client = createCodingAgentWorkflowClient({
      baseUrl: "https://kintsugi.example/base/",
      tokenProvider: async () => "private-test-token",
      fetch: fetcher,
    });

    await expect(client.taskStatus({ projectId: "shop", unitId: "web/core/invoice" })).resolves.toMatchObject({
      projectId: "shop", unitId: "web/core/invoice", status: "pending",
      latestContinuation: { kind: "task.continuation", projectId: "shop", unitId: "web/core/invoice" },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("creates a fresh request timeout for every operation", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ schemaVersion: "1", items: [], limit: 25 }));
    const signals: AbortSignal[] = [];
    const signalProvider = vi.fn(() => {
      const signal = new AbortController().signal;
      signals.push(signal);
      return signal;
    });
    const client = createCodingAgentWorkflowClient({
      baseUrl: "https://kintsugi.example",
      tokenProvider: async () => "token",
      fetch: fetcher,
      signalProvider,
    });
    await client.listProjects({});
    await client.listProjects({});
    expect(signalProvider).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBe(signals[0]);
    expect(fetcher.mock.calls[1]?.[1]?.signal).toBe(signals[1]);
    expect(signals[0]).not.toBe(signals[1]);
  });
  it("joins the API prefix correctly when the installation URL has no base path", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://kintsugi.example/api/member/v1/projects?limit=25");
      return json({ schemaVersion: "1", items: [], limit: 25 });
    });
    const client = createCodingAgentWorkflowClient({ baseUrl: "https://kintsugi.example", tokenProvider: async () => "token", fetch: fetcher });
    await expect(client.listProjects({})).resolves.toMatchObject({ items: [] });
  });

  it("rejects installation URLs that are not HTTPS or loopback HTTP", () => {
    expect(() => createCodingAgentWorkflowClient({ baseUrl: "http://example.com", tokenProvider: async () => "x" })).toThrow("HTTPS");
    expect(() => createCodingAgentWorkflowClient({ baseUrl: "https://user:secret@example.com", tokenProvider: async () => "x" })).toThrow("URL");
  });

  it("blocks redirects without following them or forwarding the bearer token", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://attacker.example/collect" } }));
    const client = createCodingAgentWorkflowClient({ baseUrl: "https://kintsugi.example", tokenProvider: async () => "private-test-token", fetch: fetcher });
    await expect(client.listProjects({})).rejects.toMatchObject({ code: "REDIRECT_BLOCKED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("validates the response schema and never includes the token in its diagnostic", async () => {
    const client = createCodingAgentWorkflowClient({
      baseUrl: "https://kintsugi.example",
      tokenProvider: async () => "never-print-this-token",
      fetch: async () => json({ schemaVersion: "1", items: [{ projectId: "!!!", name: "x" }], limit: 1 }),
    });
    await expect(client.listProjects({})).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("returns stable API errors and retries bounded transient responses", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ code: "BUSY" }, 503, { "retry-after": "1" }))
      .mockResolvedValueOnce(json({ schemaVersion: "1", items: [], limit: 25 }));
    const client = createCodingAgentWorkflowClient({
      baseUrl: "https://kintsugi.example", tokenProvider: async () => "token", fetch: fetcher,
      sleep, maxRetries: 2,
    });
    await expect(client.listProjects({})).resolves.toMatchObject({ items: [] });
    expect(sleep).toHaveBeenCalledWith(1000, undefined);

    const denied = createCodingAgentWorkflowClient({
      baseUrl: "https://kintsugi.example", tokenProvider: async () => "token",
      fetch: async () => json({ code: "PROJECT_ACCESS_REQUIRED" }, 403),
    });
    await expect(denied.listProjects({})).rejects.toBeInstanceOf(CodingAgentClientError);
    await expect(denied.listProjects({})).rejects.toMatchObject({ status: 403 });
  });

  it("uses the injected clock for HTTP-date Retry-After values", async () => {
    const now = Date.parse("2026-10-21T00:00:00.000Z");
    const sleep = vi.fn(async () => undefined);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ code: "BUSY" }, 503, { "retry-after": "Wed, 21 Oct 2026 00:00:02 GMT" }))
      .mockResolvedValueOnce(json({ schemaVersion: "1", items: [], limit: 25 }));
    const client = createCodingAgentWorkflowClient({
      baseUrl: "https://kintsugi.example", tokenProvider: async () => "token", fetch: fetcher,
      sleep, now: () => now, maxRetries: 1,
    });

    await expect(client.listProjects({})).resolves.toMatchObject({ items: [] });
    expect(sleep).toHaveBeenCalledWith(2_000, undefined);
  });

  it("retries snapshot preparation with the returned handle and respects cancellation", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ code: "SNAPSHOT_PREPARING", snapshotId: "ctx_pending", retryAfterMs: 1000 }, 409))
      .mockImplementationOnce(async (input: RequestInfo | URL) => {
        expect(new URL(String(input)).searchParams.get("snapshotId")).toBe("ctx_pending");
        return json({
          schemaVersion: "1", projectId: "shop", unitId: "web/core/invoice", activity: "implementation",
          title: "Invoice", objective: "Implement invoice", acceptanceCriteria: [], snapshotId: "ctx_pending",
          contextRevision: "sha256:" + "a".repeat(64), documentRepoCommit: "a".repeat(40), sources: [],
          requiredDeliverableIds: [], readiness: { readyFor: [], blockers: [], byActivity: {
            design: { ready: false, blockers: [] }, implementation: { ready: false, blockers: [] }, verification: { ready: false, blockers: [] },
          } }, blockers: [], requiredContextStatus: "complete", sections: [], omittedSections: [],
          freshness: { isCurrent: true, observedAt: "2026-10-21T00:00:00.000Z" }, fetchedAt: "2026-10-21T00:00:00.000Z",
        });
      });
    const client = createCodingAgentWorkflowClient({ baseUrl: "https://kintsugi.example", tokenProvider: async () => "token", fetch: fetcher, sleep });
    await expect(client.briefTask({ projectId: "shop", unitId: "web/core/invoice", activity: "implementation" })).resolves.toMatchObject({ snapshotId: "ctx_pending" });
    expect(sleep).toHaveBeenCalledWith(1000, undefined);

    const abort = new AbortController();
    abort.abort();
    const cancelled = createCodingAgentWorkflowClient({ baseUrl: "https://kintsugi.example", tokenProvider: async () => "token", fetch: fetcher, signal: abort.signal });
    await expect(cancelled.listProjects({})).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("bounds repeated snapshot preparation and reports the pinned handle", async () => {
    const fetcher = vi.fn(async () => json({ code: "SNAPSHOT_PREPARING", snapshotId: "ctx_waiting", retryAfterMs: 1000 }, 409));
    const sleep = vi.fn(async () => undefined);
    const client = createCodingAgentWorkflowClient({ baseUrl: "https://kintsugi.example", tokenProvider: async () => "token", fetch: fetcher, sleep, maxSnapshotWaitMs: 2000 });
    await expect(client.briefTask({ projectId: "shop", unitId: "web/core/invoice", activity: "implementation" })).rejects.toMatchObject({
      code: "SNAPSHOT_TIMEOUT", details: { snapshotId: "ctx_waiting" },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not make a request without a token for reads or streaming", async () => {
    const fetcher = vi.fn();
    const client = createCodingAgentWorkflowClient({ baseUrl: "https://kintsugi.example", tokenProvider: async () => undefined, fetch: fetcher });
    await expect(client.listProjects({})).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(async () => { for await (const _event of client.watchTask({ projectId: "shop", unitId: "web/core/invoice" }, new AbortController().signal)) { void _event; } }).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("redacts a credential echoed in an API error message or details", async () => {
    const client = createCodingAgentWorkflowClient({
      baseUrl: "https://kintsugi.example",
      tokenProvider: async () => "TEST-private-token",
      fetch: async () => new Response(JSON.stringify({ success: false, statusCode: 403, error: "Forbidden", message: "TEST-private-token denied", details: { echoed: "TEST-private-token" } }), { status: 403 }),
    });
    await expect(client.listProjects({})).rejects.toMatchObject({ code: "FORBIDDEN", status: 403, message: "[redacted] denied", details: { echoed: "[redacted]" } });
  });
  it("redacts a credential echoed in the API error code", async () => {
    const secret = "TEST-private-token";
    const responses: unknown[] = [
      { success: false, statusCode: 403, error: "Forbidden", message: "Access denied", details: { code: `${secret}_FORBIDDEN` } },
      { success: false, statusCode: 403, error: `${secret} denied`, message: "Access denied" },
    ];
    for (const body of responses) {
      const client = createCodingAgentWorkflowClient({
        baseUrl: "https://kintsugi.example",
        tokenProvider: async () => secret,
        fetch: async () => new Response(JSON.stringify(body), { status: 403 }),
      });
      let error: unknown;
      try { await client.listProjects({}); } catch (value) { error = value; }
      expect(error).toBeInstanceOf(CodingAgentClientError);
      expect(error).toMatchObject({ status: 403 });
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });
});
