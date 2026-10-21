import { describe, expect, it, vi } from "vitest";
import { createDefaultCliDeps, runCli } from "../src/cli.js";
import { formatResult } from "../src/render.js";
import type { CodingAgentWorkflowCapabilities, CodingAgentWorkflowPort } from "@kintsugi/harness-sdk";

type Config = { schemaVersion: "1"; activeProfile?: string; profiles: Record<string, { id: string; baseUrl: string; projectId?: string; caFile?: string }> };

class MemoryProfiles {
  value: Config = { schemaVersion: "1", profiles: {} };
  async load(): Promise<Config> { return structuredClone(this.value); }
  async save(value: Config): Promise<void> { this.value = structuredClone(value); }
}

class MemoryCredentials {
  values = new Map<string, string>();
  set = vi.fn(async (profile: string, value: string) => { this.values.set(profile, value); });
  get = vi.fn(async (profile: string) => this.values.get(profile));
  delete = vi.fn(async (profile: string) => { this.values.delete(profile); });
}

function harness(fetch: typeof globalThis.fetch, options: { profile?: boolean; token?: string; promptSecret?: () => Promise<string>; readStdin?: () => Promise<string> } = {}) {
  const profiles = new MemoryProfiles();
  const credentials = new MemoryCredentials();
  if (options.profile === true) profiles.value = { schemaVersion: "1", activeProfile: "work", profiles: {
    work: { id: "work", baseUrl: "https://kintsugi.example", projectId: "shop" },
  } };
  if (options.token !== undefined) credentials.values.set("work", options.token);
  let stdout = "";
  let stderr = "";
  const deps = {
    profiles, credentials, fetch, cwd: process.cwd(), signal: undefined,
    serveMcp: async (_access: CodingAgentWorkflowPort, _capabilities: CodingAgentWorkflowCapabilities) => undefined,
    env: {}, isTTY: false,
    promptSecret: options.promptSecret ?? vi.fn(async () => "TEST-hidden-token"),
    readStdin: options.readStdin ?? vi.fn(async () => "TEST-piped-token"),
    stdout: { write: (value: string) => { stdout += value; } },
    stderr: { write: (value: string) => { stderr += value; } },
    sleep: vi.fn(async () => undefined),
  };
  return { deps, profiles, credentials, output: () => ({ stdout, stderr }) };
}

function ok(data: unknown): Response { return Response.json({ success: true, data }); }

describe("kintsugi CLI", () => {
  it("cleans up abort listeners after retry sleeps complete", async () => {
    const signal = new AbortController().signal;
    const remove = vi.spyOn(signal, "removeEventListener");
    await createDefaultCliDeps().sleep(0, signal);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("preserves snapshot provenance, completeness, and continuation in document output", () => {
    const page = {
      schemaVersion: "1", projectId: "shop", unitId: "web/core/invoice", snapshotId: "ctx_pinned",
      sourceId: "src_design", repositoryId: "project-docs", commit: "b".repeat(40),
      path: "units/invoice/design.md", contentHash: `sha256:${"c".repeat(64)}`, text: "Rounding rules.",
      citations: [{ sourceId: "src_design", path: "units/invoice/design.md", startLine: 8, endLine: 9 }],
      complete: false, requiredSectionsRemaining: ["sec_examples"], nextCursor: "cursor_next",
    };
    const text = formatResult(page, "text");
    const markdown = formatResult(page, "markdown");

    for (const output of [text, markdown]) {
      expect(output).toContain("ctx_pinned");
      expect(output).toContain("b".repeat(40));
      expect(output).toContain(`sha256:${"c".repeat(64)}`);
      expect(output.toLowerCase()).toContain("complete: no");
      expect(output).toContain("sec_examples");
      expect(output).toContain("cursor_next");
      expect(output).toContain("src_design — units/invoice/design.md#L8-L9");
    }
  });

  it("serves MCP with the selected profile and reloads its credential for every request", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ok({ schemaVersion: "1", items: [], limit: 25 }));
    const state = harness(fetch, { profile: true, token: "TEST-mcp-token" });
    let receivedCapabilities: unknown;
    let observedAccess: CodingAgentWorkflowPort | undefined;
    state.deps.serveMcp = async (access, capabilities) => {
      observedAccess = access;
      receivedCapabilities = capabilities;
      await access.listProjects({ limit: 5 });
      state.credentials.values.delete("work");
      await expect(access.listProjects({ limit: 5 })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    };
    const code = await runCli(["mcp", "serve", "--profile", "work"], state.deps as never);
    expect(code).toBe(0);
    expect(observedAccess).toBeDefined();
    expect(receivedCapabilities).toEqual({ reviews: true });
    expect(fetch).toHaveBeenCalledOnce();
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer TEST-mcp-token");
    expect(state.credentials.get).toHaveBeenCalledTimes(3);
    expect(state.output().stdout + state.output().stderr).not.toContain("TEST-mcp-token");
  });

  it("rejects a connection-level project selector so MCP calls stay explicit", async () => {
    const state = harness(async () => ok({ schemaVersion: "1", items: [], limit: 25 }), { profile: true, token: "TEST-token" });
    const serveMcp = vi.fn(async (_access: CodingAgentWorkflowPort, _capabilities: CodingAgentWorkflowCapabilities) => undefined);
    state.deps.serveMcp = serveMcp;
    const code = await runCli(["mcp", "serve", "--project", "shop"], state.deps as never);
    expect(code).toBe(2);
    expect(serveMcp).not.toHaveBeenCalled();
    expect(state.output().stderr).toContain("MCP_PROJECT_SELECTOR_UNSUPPORTED");
  });
  it("rejects token-stdin for MCP because stdin is the protocol channel", async () => {
    const readStdin = vi.fn(async () => "TEST-one-shot");
    const state = harness(async () => ok({ schemaVersion: "1", items: [], limit: 25 }), { profile: true, token: "TEST-token", readStdin });
    const code = await runCli(["mcp", "serve", "--token-stdin"], state.deps as never);
    expect(code).toBe(2);
    expect(readStdin).not.toHaveBeenCalled();
    expect(state.output().stderr).toContain("MCP_TOKEN_STDIN_UNSUPPORTED");
  });
  it("prints parseable JSON success on stdout", async () => {
    const state = harness(async () => ok({ schemaVersion: "1", items: [{ projectId: "shop", name: "Shop" }], limit: 25 }), { profile: true, token: "TEST-token" });
    const code = await runCli(["--format", "json", "project", "list"], state.deps as never);
    expect(code).toBe(0);
    expect(JSON.parse(state.output().stdout)).toMatchObject({ items: [{ projectId: "shop" }] });
    expect(state.output().stderr).toBe("");
  });

  it("prints structured JSON errors to stderr and leaves stdout empty", async () => {
    const state = harness(async () => Response.json({
      success: false, statusCode: 403, error: "Forbidden", message: "Project Access is required", timestamp: "2026-10-21T00:00:00Z", path: "/member/v1/projects",
    }, { status: 403 }), { profile: true, token: "TEST-token" });
    const code = await runCli(["--format", "json", "project", "list"], state.deps as never);
    expect(code).toBe(3);
    expect(state.output().stdout).toBe("");
    expect(JSON.parse(state.output().stderr)).toMatchObject({ success: false, error: { status: 403 } });
  });

  it("does not prompt in no-input mode", async () => {
    const prompt = vi.fn(async () => "TEST-secret");
    const state = harness(async () => ok({ schemaVersion: "1", items: [], limit: 25 }), { promptSecret: prompt });
    const code = await runCli(["--no-input", "--format", "json", "project", "list"], state.deps as never);
    expect(code).not.toBe(0);
    expect(prompt).not.toHaveBeenCalled();
    expect(state.output().stdout).toBe("");
  });

  it("rejects hidden login prompts under --no-input without reading stdin", async () => {
    const prompt = vi.fn(async () => "TEST-secret");
    const readStdin = vi.fn(async () => "TEST-piped-token");
    const state = harness(async () => ok({ schemaVersion: "1", items: [], limit: 25 }), { promptSecret: prompt, readStdin });
    const code = await runCli(["--no-input", "auth", "login", "--url", "https://kintsugi.example"], state.deps as never);
    expect(code).toBe(2);
    expect(prompt).not.toHaveBeenCalled();
    expect(readStdin).not.toHaveBeenCalled();
    expect(state.credentials.set).not.toHaveBeenCalled();
  });

  it("stores the token in the injected secure store while profile JSON contains no secret", async () => {
    const prompt = vi.fn(async () => "TEST-login-secret");
    const state = harness(async () => ok({ schemaVersion: "1", items: [], limit: 25 }), { promptSecret: prompt });
    state.deps.isTTY = true;
    const code = await runCli(["auth", "login", "--url", "https://kintsugi.example", "--profile", "work"], state.deps as never);
    expect(code).toBe(0);
    expect(prompt).toHaveBeenCalledOnce();
    expect(state.credentials.values.get("work")).toBe("TEST-login-secret");
    expect(JSON.stringify(state.profiles.value)).not.toContain("TEST-login-secret");
    expect(state.output().stdout + state.output().stderr).not.toContain("TEST-login-secret");
  });

  it("stores a piped login token securely without requiring a TTY", async () => {
    const readStdin = vi.fn(async () => "TEST-piped-login-token\n");
    const state = harness(async () => ok({ schemaVersion: "1", items: [], limit: 25 }), { readStdin });
    const code = await runCli(["auth", "login", "--url", "https://kintsugi.example", "--profile", "ci", "--token-stdin"], state.deps as never);
    expect(code).toBe(0);
    expect(state.credentials.values.get("ci")).toBe("TEST-piped-login-token");
    expect(JSON.stringify(state.profiles.value)).not.toContain("TEST-piped-login-token");
    expect(state.output().stdout + state.output().stderr).not.toContain("TEST-piped-login-token");
  });

  it("rejects changing the installation under an existing profile", async () => {
    const state = harness(async () => ok({ schemaVersion: "1", items: [], limit: 25 }), { profile: true, token: "TEST-old-secret" });
    const readStdin = vi.fn(async () => "TEST-new-secret");
    (state.deps as unknown as { readStdin: typeof readStdin }).readStdin = readStdin;
    const code = await runCli(["auth", "login", "--url", "https://other.example", "--profile", "work", "--token-stdin"], state.deps as never);
    expect(code).not.toBe(0);
    expect(readStdin).not.toHaveBeenCalled();
    expect(state.credentials.values.get("work")).toBe("TEST-old-secret");
  });

  it("accepts an explicit one-shot stdin token without persisting it", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ok({ schemaVersion: "1", items: [], limit: 25 }));
    const state = harness(fetch, { profile: true, readStdin: async () => "TEST-one-shot" });
    const code = await runCli(["--token-stdin", "--format", "json", "project", "list"], state.deps as never);
    expect(code).toBe(0);
    expect(state.credentials.set).not.toHaveBeenCalled();
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer TEST-one-shot");
  });

  it("accepts the JSON alias after a command and keeps results on stdout", async () => {
    const state = harness(async () => ok({ schemaVersion: "1", items: [], limit: 25 }), { profile: true, token: "TEST-token" });
    const code = await runCli(["project", "list", "--json"], state.deps as never);
    expect(code).toBe(0);
    expect(JSON.parse(state.output().stdout)).toMatchObject({ items: [] });
    expect(state.output().stderr).toBe("");
  });

  it("does not accept a token as an argument or echo it in errors", async () => {
    const state = harness(async () => ok({ schemaVersion: "1", items: [], limit: 25 }));
    const code = await runCli(["auth", "login", "--url", "https://kintsugi.example", "--token", "TEST-argv-secret"], state.deps as never);
    expect(code).not.toBe(0);
    expect(state.output().stdout).toBe("");
    expect(state.output().stderr).not.toContain("TEST-argv-secret");
    expect(state.credentials.set).not.toHaveBeenCalled();
  });
});

describe("review retrieval contract", () => {
  const report: import("@kintsugi/harness-sdk").ReviewReport = {
    schemaVersion: "1", projectId: "payments", unitId: "web/core/invoice", reviewId: "review_current", generation: 2,
    currentness: "superseded", verdict: "fail", reviewedHead: "a".repeat(40), reviewedBase: "b".repeat(40),
    mergeBase: "c".repeat(40), contextRevision: `sha256:${"d".repeat(64)}`, policyRevision: "policy_2", agentVersion: "reviewer_1",
    coverage: "partial", findings: [{ findingId: "finding_1", severity: "high", title: "Preserve rounding",
      rationale: "Rounding every line causes invoice drift.",
      repairGuidance: "Sum the exact line amounts, then round the final total.",
      citation: { sourceId: "source_1", path: "src/invoice.ts", startLine: 8, endLine: 11 }, currentness: "superseded" }],
  };

  it.each(["text", "markdown", "json"] as const)("preserves actionable findings and revision provenance in %s", async (format) => {
    const state = harness(async () => ok(report), { profile: true, token: "TEST-token" });
    expect(await runCli(["review", "get", "review_current", "--project", "payments", "--format", format], state.deps as never)).toBe(0);
    const { stdout, stderr } = state.output();
    expect(stderr).toBe("");
    if (format === "json") expect(JSON.parse(stdout)).toEqual(report);
    else for (const value of ["review_current", "superseded", "fail", "partial", report.reviewedHead, report.reviewedBase, report.mergeBase!,
      report.contextRevision, "policy_2", "reviewer_1", "finding_1", "high", "Preserve rounding", report.findings[0]!.rationale, report.findings[0]!.repairGuidance, "src/invoice.ts#L8-L11"])
      expect(stdout).toContain(value);
  });

  it("requires an explicit review project even when the profile has a default", async () => {
    const fetch = vi.fn(async () => ok(report));
    const state = harness(fetch, { profile: true, token: "TEST-token" });
    expect(await runCli(["review", "get", "review_current"], state.deps as never)).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
    expect(state.output().stderr).toContain("PROJECT_REQUIRED");
  });

  it.each([true, false])("uses the selected installation and credential with explicit project before command: %s", async (before) => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ok(report));
    const state = harness(fetch, { profile: true, token: "TEST-token" });
    state.profiles.value.profiles.other = { id: "other", baseUrl: "https://other.example/base", projectId: "default" };
    state.credentials.values.set("other", "TEST-other-token");
    expect(await runCli([...(before ? ["--project", "payments"] : []), "review", "get", "review_current", "--profile", "other", ...(!before ? ["--project", "payments"] : []), "--json"], state.deps as never)).toBe(0);
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://other.example/base/api/member/v1/reviews/review_current?projectId=payments");
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer TEST-other-token");
    expect(JSON.parse(state.output().stdout)).toEqual(report);
  });

  it.each([
    [501, "UNSUPPORTED_CAPABILITY", 2], [403, "FORBIDDEN", 3], [401, "UNAUTHENTICATED", 3], [409, "REVIEW_STALE", 2],
  ] as const)("surfaces review errors (%s/%s) on stderr", async (status, errorCode, exitCode) => {
    const state = harness(async () => Response.json({ success: false, statusCode: status, error: "Error", message: "Review cannot be retrieved",
      timestamp: "2026-10-21T00:00:00Z", path: "/api/member/v1/reviews/review_current", details: { code: errorCode, reviewId: "review_current" } },
    { status }), { profile: true, token: "TEST-token" });
    expect(await runCli(["review", "get", "review_current", "--project", "payments", "--json"], state.deps as never)).toBe(exitCode);
    expect(state.output().stdout).toBe("");
    expect(JSON.parse(state.output().stderr)).toMatchObject({ success: false, error: { code: errorCode, status, details: { reviewId: "review_current" } } });
  });

  it.each([undefined, "payments"])("lists only task-status review references with project selector %s", async (project) => {
    const fetch = vi.fn(async (_input: RequestInfo | URL) => ok({ schemaVersion: "1", projectId: project ?? "shop", unitId: "web/core/invoice", status: "pending",
      evidenceAvailability: { pullRequests: "available", reviews: "available" }, pullRequests: [], currentReviewIds: ["review_authorized"], gates: [], nextAction: "Read findings." }));
    const state = harness(fetch, { profile: true, token: "TEST-token" });
    expect(await runCli(["review", "list", "--task", "/web/core/invoice/", ...(project === undefined ? [] : ["--project", project]), "--json"], state.deps as never)).toBe(0);
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`https://kintsugi.example/api/member/v1/task-status?projectId=${project ?? "shop"}&unitId=web%2Fcore%2Finvoice`);
    expect(JSON.parse(state.output().stdout)).toEqual([{ reviewId: "review_authorized", currentness: "current" }]);
  });
});

describe("task watch CLI", () => {
  const event = (id: string) => ({ schemaVersion: "1", projectId: "shop", unitId: "web/core/invoice", id,
    kind: "task.activity-ready", occurredAt: "2026-10-21T00:00:00Z", metadata: { activity: "verification", ready: true } });
  const frame = (id: string) => `event: task-event\nid: ${id}\ndata: ${JSON.stringify(event(id))}\n\n`;

  it("uses the selected profile/project and resume options, emitting compact NDJSON", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(frame("evt_1") + frame("evt_2"), { headers: { "content-type": "text/event-stream" } }));
    const state = harness(fetch, { profile: true, token: "TEST-token" });
    expect(await runCli(["task", "watch", "/web/core/invoice/", "--after-event-id", "evt_0", "--limit", "2", "--json"], state.deps as never)).toBe(0);
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://kintsugi.example/api/member/v1/task-events?projectId=shop&unitId=web%2Fcore%2Finvoice&afterEventId=evt_0&limit=2");
    expect(state.output().stdout).toBe(`${JSON.stringify(event("evt_1"))}\n${JSON.stringify(event("evt_2"))}\n`);
    expect(state.output().stderr).toBe("");
  });

  it.each(["text", "markdown"])("shows event identity, time, kind and metadata in %s", async (format) => {
    const state = harness(async () => new Response(frame("evt_1"), { headers: { "content-type": "text/event-stream" } }), { profile: true, token: "TEST-token" });
    expect(await runCli(["task", "watch", "web/core/invoice", "--limit", "1", "--format", format], state.deps as never)).toBe(0);
    for (const value of ["evt_1", "task.activity-ready", "2026-10-21T00:00:00Z", "shop/web/core/invoice", "verification", "true"]) expect(state.output().stdout).toContain(value);
  });

  it.each(["0", "1001", "1.5", "nope"])("rejects invalid event limit %s without fetching", async (limit) => {
    const fetch = vi.fn();
    const state = harness(fetch, { profile: true, token: "TEST-token" });
    expect(await runCli(["task", "watch", "web/core/invoice", "--limit", limit], state.deps as never)).toBe(2);
    expect(state.output().stderr).toContain("LIMIT_INVALID");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces cursor expiry as a structured error without output", async () => {
    const state = harness(async () => Response.json({ success: false, message: "Refresh task status before resuming", details: { code: "MEMBER_EVENT_CURSOR_EXPIRED" } }, { status: 409 }), { profile: true, token: "TEST-token" });
    expect(await runCli(["task", "watch", "web/core/invoice", "--json"], state.deps as never)).toBe(2);
    expect(state.output().stdout).toBe("");
    expect(JSON.parse(state.output().stderr)).toMatchObject({ error: { code: "MEMBER_EVENT_CURSOR_EXPIRED", status: 409 } });
  });

  it("prints events immediately, cancels only the subscription and cleans up process listeners", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let onOutput!: () => void;
    const printed = new Promise<void>((resolve) => { onOutput = resolve; });
    const cancel = vi.fn();
    const fetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; value.enqueue(new TextEncoder().encode(frame("evt_1"))); }, cancel }), { headers: { "content-type": "text/event-stream" } }));
    const state = harness(fetch, { profile: true, token: "TEST-token" });
    const watch = new AbortController();
    Object.assign(state.deps, { watchSignal: watch.signal, signal: AbortSignal.abort() });
    const originalWrite = state.deps.stdout.write;
    state.deps.stdout.write = (value) => { originalWrite(value); onOutput(); };
    const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
    const running = runCli(["task", "watch", "web/core/invoice", "--json"], state.deps as never);
    await printed;
    expect(JSON.parse(state.output().stdout).id).toBe("evt_1");
    expect(controller).toBeDefined();
    watch.abort();
    expect(await running).toBe(0);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
    expect(state.output().stderr).toBe("");
    expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(before);
  });
});

describe("watch process signals", () => {
  it.each(["SIGINT", "SIGTERM"] as const)("closes its stream cleanly for %s", async (signalName) => {
    const before = process.listenerCount(signalName);
    const cancel = vi.fn();
    const value = { schemaVersion: "1", projectId: "shop", unitId: "web/core/invoice", id: "evt_1", kind: "task.changed", occurredAt: "2026-10-21T00:00:00Z", metadata: {} };
    const state = harness(async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`event: task-event\nid: evt_1\ndata: ${JSON.stringify(value)}\n\n`));
    }, cancel }), { headers: { "content-type": "text/event-stream" } }), { profile: true, token: "TEST-token" });
    const write = state.deps.stdout.write;
    state.deps.stdout.write = (output) => { write(output); process.emit(signalName); };
    expect(await runCli(["task", "watch", "web/core/invoice", "--json"], state.deps as never)).toBe(0);
    expect(cancel).toHaveBeenCalledOnce();
    expect(process.listenerCount(signalName)).toBe(before);
    expect(state.output().stderr).toBe("");
  });
});

describe("watch authorization", () => {
  it("uses the named profile credential and an explicit project instead of its default", async () => {
    const value = { schemaVersion: "1", projectId: "payments", unitId: "web/core/invoice", id: "evt_1", kind: "task.changed", occurredAt: "2026-10-21T00:00:00Z", metadata: {} };
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(`event: task-event\nid: evt_1\ndata: ${JSON.stringify(value)}\n\n`, { headers: { "content-type": "text/event-stream" } }));
    const state = harness(fetch, { profile: true, token: "TEST-token" });
    state.profiles.value.profiles.other = { id: "other", baseUrl: "https://other.example/base", projectId: "default" };
    state.credentials.values.set("other", "TEST-other-token");
    expect(await runCli(["--project", "payments", "task", "watch", "web/core/invoice", "--profile", "other", "--limit", "1", "--json"], state.deps as never)).toBe(0);
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://other.example/base/api/member/v1/task-events?projectId=payments&unitId=web%2Fcore%2Finvoice&limit=1");
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer TEST-other-token");
    expect(JSON.parse(state.output().stdout)).toEqual(value);
  });

  it.each([
    ["MEMBER_EVENT_UNAUTHENTICATED", 401],
    ["MEMBER_EVENT_ACCESS_REVOKED", 403],
  ] as const)("keeps delivered events and reports %s only to stderr", async (code, status) => {
    const value = { schemaVersion: "1", projectId: "shop", unitId: "web/core/invoice", id: "evt_1", kind: "task.changed", occurredAt: "2026-10-21T00:00:00Z", metadata: {} };
    const error = JSON.stringify({ code, message: "Access revoked" });
    const fetch = vi.fn(async () => new Response(`event: task-event\nid: evt_1\ndata: ${JSON.stringify(value)}\n\nevent: error\ndata: ${error}\n\n`, { headers: { "content-type": "text/event-stream" } }));
    const state = harness(fetch, { profile: true, token: "TEST-token" });
    const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
    expect(await runCli(["task", "watch", "web/core/invoice", "--json"], state.deps as never)).toBe(3);
    expect(JSON.parse(state.output().stdout)).toEqual(value);
    expect(JSON.parse(state.output().stderr)).toMatchObject({ success: false, error: { code, status } });
    expect(fetch).toHaveBeenCalledOnce();
    expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(before);
  });
});

describe("watch EOF lifecycle", () => {
  it.each([true, false])("resumes clean EOF and exits cleanly with a bounded watch: %s", async (bounded) => {
    const event = (id: string) => ({ schemaVersion: "1", projectId: "shop", unitId: "web/core/invoice", id,
      kind: "task.changed", occurredAt: "2026-10-21T00:00:00Z", metadata: {} });
    const watch = new AbortController();
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      const id = fetch.mock.calls.length === 1 ? "evt_1" : "evt_2";
      return new Response(`event: task-event\nid: ${id}\ndata: ${JSON.stringify(event(id))}\n\n`, { headers: { "content-type": "text/event-stream" } });
    });
    const state = harness(fetch, { profile: true, token: "TEST-initial-token" });
    Object.assign(state.deps, { watchSignal: watch.signal });
    const write = state.deps.stdout.write;
    state.deps.stdout.write = (output) => {
      write(output);
      state.credentials.values.set("work", "TEST-refreshed-token");
      if (!bounded && JSON.parse(output).id === "evt_2") watch.abort();
    };
    const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
    expect(await runCli(["task", "watch", "web/core/invoice", ...(bounded ? ["--limit", "2"] : []), "--json"], state.deps as never)).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    const resumed = fetch.mock.calls[1];
    expect(new Headers(resumed?.[1]?.headers).get("last-event-id")).toBe("evt_1");
    expect(new Headers(resumed?.[1]?.headers).get("authorization")).toBe("Bearer TEST-refreshed-token");
    expect(new URL(String(resumed?.[0])).searchParams.get("afterEventId")).toBe("evt_1");
    expect(new URL(String(resumed?.[0])).searchParams.get("limit")).toBe(bounded ? "1" : null);
    expect(state.output().stdout.trim().split("\n").map((line) => JSON.parse(line))).toEqual([event("evt_1"), event("evt_2")]);
    expect(state.output().stderr).toBe("");
    expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(before);
  });
});
