import { describe, expect, it, vi } from "vitest";
import { createDefaultCliDeps, runCli } from "../src/cli.js";
import { getNativeClientVersion } from "../src/client-version.js";
import { formatResult } from "../src/render.js";
import { EventEmitter } from "node:events";
import * as cliModule from "../src/cli.js";
import type { CodingAgentWorkflowCapabilities, CodingAgentWorkflowPort } from "@kintsugi/harness-sdk";

describe("native client version detection", () => {
  it("uses direct execution for Windows client executables", async () => {
    const execute = vi.fn(async () => ({ stdout: "2.1.278\n", stderr: "" }));

    await expect(getNativeClientVersion("claude", "win32", execute as never)).resolves.toBe("2.1.278");
    expect(execute).toHaveBeenCalledWith("claude", ["--version"], expect.objectContaining({ shell: false }));
  });

  it("keeps direct execution on Unix", async () => {
    const execute = vi.fn(async () => ({ stdout: "0.163.0-alpha.10.2\n", stderr: "" }));

    await expect(getNativeClientVersion("codex", "linux", execute as never)).resolves.toBe("0.163.0-alpha.10.2");
    expect(execute).toHaveBeenCalledWith("codex", ["--version"], expect.not.objectContaining({ shell: true }));
  });
});

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
  it.each(["SIGINT", "SIGTERM"])("cancels browser sign-in on %s and cleans up process signal listeners", async (signal) => {
    const state = harness(async () => ok({}), { profile: true });
    const signals = new EventEmitter();
    let closed = false;
    const deps = { ...state.deps,
      openBrowser: async () => { signals.emit(signal); },
      createOAuthCallback: async () => ({ redirectUri: "http://127.0.0.1:54321/oauth/callback", waitForCode: () => new Promise<{ code: string; state: string }>(() => undefined), close: async () => { closed = true; } }),
      serveMcp: async (access: CodingAgentWorkflowPort) => { await access.listProjects({ limit: 5 }); return undefined; },
    };
    const entrypoint = (cliModule as unknown as { runCliWithSignals: (argv: string[], deps: typeof state.deps, signals: EventEmitter) => Promise<number> }).runCliWithSignals;
    expect(typeof entrypoint).toBe("function");
    expect(await entrypoint(["mcp", "serve"], deps, signals)).toBe(2);
    expect(closed).toBe(true);
    expect(state.output().stdout).toBe("");
    expect(state.output().stderr).toContain("CANCELLED");
    expect(signals.listenerCount("SIGINT") + signals.listenerCount("SIGTERM")).toBe(0);
  });
  it("authenticates through browser PKCE and stores only a refresh envelope", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const state = harness(async (input, init) => {
      requests.push({ url: String(input), init });
      return ok({ accessToken: "knt_caw_test", refreshToken: "knt_crt_test", expiresIn: 300, connectionId: "connection-1", projectIds: ["shop"] });
    });
    let authorization: URL | undefined;
    let closed = false;
    const deps = { ...state.deps,
      openBrowser: async (url: string) => { authorization = new URL(url); },
      createOAuthCallback: async ({ state: nonce }: { state: string }) => ({
        redirectUri: "http://127.0.0.1:45678/oauth/callback",
        waitForCode: async () => ({ code: "server-code", state: nonce }),
        close: async () => { closed = true; },
      }),
    };
    expect(await runCli(["auth", "login", "--url", "https://kintsugi.example", "--project", "shop"], deps)).toBe(0);
    expect(authorization?.pathname).toBe("/coding-agent/authorize");
    expect(authorization?.searchParams.get("projectId")).toBe("shop");
    expect(authorization?.searchParams.get("codeChallengeMethod")).toBe("S256");
    expect(requests[0]?.url).toBe("https://kintsugi.example/api/auth/coding-agent/token");
    expect(new Headers(requests[0]?.init?.headers).get("x-kintsugi-csrf")).toBe("1");
    expect(JSON.parse(state.credentials.values.get("work")!)).toMatchObject({ version: 1, refreshToken: "knt_crt_test", connectionId: "connection-1", projectIds: ["shop"] });
    expect(state.credentials.values.get("work")).not.toContain("knt_caw_test");
    expect(state.output().stdout + state.output().stderr).not.toContain("knt_crt_test");
    expect(closed).toBe(true);
  });

  it("reopens browser consent when MCP refresh is rejected at the connection-age cap", async () => {
    const state = harness(async (_url, init) => {
      if (init?.body === undefined) return ok({ schemaVersion: "1", items: [], limit: 5 });
      const body = JSON.parse(String(init?.body)) as { grantType: string };
      if (body.grantType === "refresh_token") return Response.json({ success: false }, { status: 401 });
      return ok({ accessToken: "knt_caw_after-consent", refreshToken: "knt_crt_after-consent", expiresIn: 300, connectionId: "renewed", projectIds: ["shop"] });
    }, { profile: true, token: JSON.stringify({ version: 1, baseUrl: "https://kintsugi.example", refreshToken: "knt_crt_expired", connectionId: "expired", projectIds: ["shop"] }) });
    let opened = 0;
    let served = false;
    const deps = { ...state.deps,
      openBrowser: async () => { opened++; },
      createOAuthCallback: async ({ state: nonce }: { state: string }) => ({ redirectUri: "http://127.0.0.1:54321/oauth/callback", waitForCode: async () => ({ code: "renewal-code", state: nonce }), close: async () => undefined }),
      serveMcp: async (access: CodingAgentWorkflowPort) => {
        served = true;
        expect(opened).toBe(0);
        await access.listProjects({ limit: 5 });
      },
    };
    expect(await runCli(["mcp", "serve"], deps)).toBe(0);
    expect(opened).toBe(1);
    expect(served).toBe(true);
    expect(state.output().stdout).toBe("");
    expect(state.output().stderr).toContain("Sign in to Kintsugi");
    expect(state.deps.promptSecret).not.toHaveBeenCalled();
    expect(state.deps.readStdin).not.toHaveBeenCalled();
    expect(JSON.parse(state.credentials.values.get("work")!).connectionId).toBe("renewed");
  });

  it("starts the MCP bridge before opening first-use browser sign-in", async () => {
    const state = harness(async (_url, init) => init?.body === undefined
      ? ok({ schemaVersion: "1", items: [{ projectId: "shop", name: "Shop" }], limit: 5 })
      : ok({ accessToken: "knt_caw_first-use", refreshToken: "knt_crt_first-use", expiresIn: 300, connectionId: "first-use", projectIds: ["shop"] }), { profile: true });
    const events: string[] = [];
    const deps = { ...state.deps,
      openBrowser: async () => { events.push("browser"); },
      createOAuthCallback: async ({ state: nonce }: { state: string }) => ({ redirectUri: "http://127.0.0.1:54321/oauth/callback", waitForCode: async () => ({ code: "first-use-code", state: nonce }), close: async () => undefined }),
      serveMcp: async (access: CodingAgentWorkflowPort) => {
        events.push("server");
        expect(events).toEqual(["server"]);
        await access.listProjects({ limit: 5 });
      },
    };

    expect(await runCli(["mcp", "serve", "--profile", "work"], deps)).toBe(0);
    expect(events).toEqual(["server", "browser"]);
    expect(JSON.parse(state.credentials.values.get("work")!).connectionId).toBe("first-use");
    expect(state.output().stderr).toContain("Sign in to Kintsugi");
    expect(state.output().stdout).toBe("");
  });

  it("shows only safe OAuth metadata in auth status", async () => {
    const state = harness(async () => ok({}), { profile: true, token: JSON.stringify({ version: 1, baseUrl: "https://kintsugi.example", refreshToken: "knt_crt_status-secret", connectionId: "conn", projectIds: ["shop"] }) });
    expect(await runCli(["auth", "status", "--json"], state.deps as never)).toBe(0);
    expect(JSON.parse(state.output().stdout)).toMatchObject({ authenticated: true, authentication: "browser", connectionId: "conn", projectIds: ["shop"] });
    expect(state.output().stdout + state.output().stderr).not.toContain("knt_crt_");
  });

  it.each(["knt_caw_access", "knt_crt_refresh"])("never persists a raw OAuth secret through legacy token-stdin: %s", async (token) => {
    const state = harness(async () => ok({}), { readStdin: async () => token });
    expect(await runCli(["auth", "login", "--url", "https://kintsugi.example", "--token-stdin"], state.deps as never)).toBe(2);
    expect(state.credentials.values.size).toBe(0);
    expect(state.output().stdout + state.output().stderr).not.toContain(token);
  });
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

  it("escapes and labels latestContinuation across task status formats", () => {
    const latestContinuation = {
      schemaVersion: "1",
      projectId: "shop",
      unitId: "web/core/invoice",
      id: "evt_status_continuation",
      kind: "task.continuation",
      occurredAt: "2026-10-21T00:00:00Z",
      metadata: {
        schemaVersion: "1",
        status: "member-action",
        nextAction: "Continue after \u202echecking the brief.",
        "hostile\u200fkey": "line\u0085separator",
      },
    };
    const status = {
      schemaVersion: "1",
      projectId: "shop",
      unitId: "web/core/invoice",
      status: "in-progress",
      latestContinuation,
      evidenceAvailability: { pullRequests: "available", reviews: "available" },
      pullRequests: [],
      currentReviewIds: [],
      gates: [],
      nextAction: "Refresh before \u202eacting.",
    };

    const json = formatResult(status, "json");
    expect(json).not.toMatch(/[\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/);
    expect(JSON.parse(json)).toEqual(status);
    for (const format of ["text", "markdown"] as const) {
      const output = formatResult(status, format);
      expect(output).not.toMatch(/[\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/);
      expect(output).toContain("Latest continuation (historical)");
      expect(output).toContain("Continuation is advisory only.");
      expect(output).toContain("\\u202E");
      expect(output).toContain("\\u0085");
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
    expect(state.credentials.get).toHaveBeenCalledTimes(2);
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

  it("uses a project found after the first project page", async () => {
    const firstPage = Array.from({ length: 25 }, (_, index) => ({ projectId: "project-" + (index + 1), name: "Project " + (index + 1) }));
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.searchParams.get("cursor") === "cursor-1") {
        return ok({ schemaVersion: "1", items: [{ projectId: "project-26", name: "Project 26" }], limit: 25 });
      }
      return ok({ schemaVersion: "1", items: firstPage, limit: 25, nextCursor: "cursor-1" });
    });
    const state = harness(fetch, { profile: true, token: "TEST-token" });
    const code = await runCli(["project", "use", "project-26"], state.deps as never);

    expect(code).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get("limit")).toBe("25");
    expect(new URL(String(fetch.mock.calls[1]?.[0])).searchParams.get("cursor")).toBe("cursor-1");
    expect(state.profiles.value.profiles.work?.projectId).toBe("project-26");
    expect(state.output().stderr).toBe("");
  });

  it("rejects a project that is absent after the last project page", async () => {
    let page = 0;
    const fetch = vi.fn(async () => {
      page += 1;
      return page === 1
        ? ok({ schemaVersion: "1", items: [], limit: 25, nextCursor: "cursor-1" })
        : ok({ schemaVersion: "1", items: [], limit: 25 });
    });
    const state = harness(fetch, { profile: true, token: "TEST-token" });
    const code = await runCli(["project", "use", "missing"], state.deps as never);

    expect(code).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(state.output().stderr).toContain("PROJECT_NOT_AVAILABLE");
    expect(state.profiles.value.profiles.work?.projectId).toBe("shop");
  });

  it("rejects a repeated project cursor", async () => {
    const fetch = vi.fn(async () => ok({ schemaVersion: "1", items: [], limit: 25, nextCursor: "cursor-repeat" }));
    const state = harness(fetch, { profile: true, token: "TEST-token" });
    const code = await runCli(["project", "use", "missing"], state.deps as never);

    expect(code).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(state.output().stderr).toContain("PROJECT_PAGINATION_INVALID");
    expect(state.profiles.value.profiles.work?.projectId).toBe("shop");
  });

  it("bounds project lookup when the project list keeps returning new cursors", async () => {
    let page = 0;
    const fetch = vi.fn(async () => {
      page += 1;
      return ok({ schemaVersion: "1", items: [], limit: 25, nextCursor: "cursor-" + page });
    });
    const state = harness(fetch, { profile: true, token: "TEST-token" });
    const code = await runCli(["project", "use", "missing"], state.deps as never);

    expect(code).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(100);
    expect(state.output().stderr).toContain("PROJECT_LOOKUP_LIMIT_EXCEEDED");
    expect(state.profiles.value.profiles.work?.projectId).toBe("shop");
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

  it("requires explicit project consent instead of a hidden token prompt", async () => {
    const prompt = vi.fn(async () => "TEST-login-secret");
    const state = harness(async () => ok({ schemaVersion: "1", items: [], limit: 25 }), { promptSecret: prompt });
    state.deps.isTTY = true;
    const code = await runCli(["auth", "login", "--url", "https://kintsugi.example", "--profile", "work"], state.deps as never);
    expect(code).toBe(2);
    expect(prompt).not.toHaveBeenCalled();
    expect(state.credentials.values.get("work")).toBeUndefined();
    expect(state.output().stderr).toContain("PROJECT_REQUIRED");
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

  it.each(["text", "markdown", "json"] as const)("preserves current PR, review, and gate status in %s task output", async (format) => {
    const status = {
      schemaVersion: "1", projectId: "shop", unitId: "web/core/invoice", status: "awaiting-review",
      evidenceAvailability: { pullRequests: "available", reviews: "available" },
      pullRequests: [{ repositoryId: "repo_shop", pullRequestId: "pr_42", state: "open", headRevision: "a".repeat(40), updatedAt: "2026-10-21T00:00:00Z" }],
      currentReviewIds: ["review_current"],
      gates: [{ unitId: "web/core/invoice", gateId: "G2", status: "pending", publication: "awaiting-merge" }],
      nextAction: "Read findings and update the PR.",
    };
    const state = harness(async () => ok(status), { profile: true, token: "TEST-token" });

    expect(await runCli(["task", "status", "web/core/invoice", "--format", format], state.deps as never)).toBe(0);
    expect(state.output().stderr).toBe("");
    if (format === "json") expect(JSON.parse(state.output().stdout)).toEqual(status);
    else for (const value of ["pr_42", "open", "review_current", "G2", "awaiting-merge", status.nextAction]) expect(state.output().stdout).toContain(value);
  });

  it("renders empty task evidence explicitly in Markdown", async () => {
    const status = {
      schemaVersion: "1", projectId: "shop", unitId: "web/core/invoice", status: "pending",
      evidenceAvailability: { pullRequests: "available", reviews: "available" },
      pullRequests: [], currentReviewIds: [], gates: [],
      nextAction: "Implement the task, then create a pull request.",
    };
    const state = harness(async () => ok(status), { profile: true, token: "TEST-token" });

    expect(await runCli(["task", "status", "web/core/invoice", "--format", "markdown"], state.deps as never)).toBe(0);
    const output = state.output().stdout;
    for (const emptyState of ["No pull requests reported.", "No current review reports.", "No gate status reported."]) {
      expect(output).toContain(emptyState);
    }
    expect(output).not.toContain("undefined");
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
  const continuationPlans = {
    "member-action": { code: "MEMBER_STAGE_AVAILABLE", phase: "verify", stage: "test", nextAction: "Continue the declared member stage test in phase verify (qc). Request current task context before starting." },
    blocked: { code: "PIPELINE_NOT_DECLARED", phase: null, stage: null, nextAction: "Continuation is blocked: PIPELINE_NOT_DECLARED. Update the declared pipeline or current Git task and request a new evidence-bound decision." },
    unsupported: { code: "RUNTIME_CONTINUATION_UNSUPPORTED", phase: "verify", stage: "test", nextAction: "The declared next stage test requires runtime agent verify. Automatic runtime continuation is unsupported; coordinate this stage in the portal." },
    complete: { code: "PIPELINE_END", phase: null, stage: null, nextAction: "The declared pipeline has no next stage. Review the current Git task; no new task has been created." },
  } as const;
  const recordCommit = "da39a3ee5e6b4b0d3255bfef95601890afd80709";
  const sourceCommit = "a9993e364706816aba3e25717850c26c9cd0d89d";
  const continuation = (status: "member-action" | "blocked" | "unsupported" | "complete") => ({ schemaVersion: "1", projectId: "shop", unitId: "web/core/invoice", id: `evt_${status}`,
    kind: "task.continuation", occurredAt: "2026-10-21T00:00:00Z", metadata: {
      schemaVersion: "1", decisionId: "decision_42", gateId: "G2", evidenceHash: "evidence_42", recordCommit, sourceCommit,
      status, ...continuationPlans[status],
    } });
  const expectSafeEventOutput = (output: string, format: "text" | "markdown") => {
    const hasTerminalControl = [...output.replaceAll("\n", "")].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) || codePoint === 0x2028 || codePoint === 0x2029
        || codePoint === 0x061c || codePoint === 0x200e || codePoint === 0x200f
        || (codePoint >= 0x202a && codePoint <= 0x202e) || (codePoint >= 0x2066 && codePoint <= 0x2069);
    });
    expect(hasTerminalControl).toBe(false);
    expect(output).not.toMatch(/\n(?:Status: forged|Fake field:)/i);
    if (format === "markdown") expect(output).not.toMatch(/\n(?:#{1,6}\s+forged|[-+*]\s+forged|\d+[.)]\s+forged|>\s+forged)/i);
  };
  const expectedMarkdownValue = (value: string, format: "text" | "markdown") => format === "markdown" ? `\`${value}\`` : value;

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
    const exitCode = await runCli(["task", "watch", "web/core/invoice", "--limit", "1", "--format", format], state.deps as never);
    expect(exitCode, state.output().stderr).toBe(0);
    const output = state.output().stdout;
    if (format === "markdown") {
      expect(output).toContain("### `task.activity-ready` (`evt_1`)");
      expect(output).toContain("Time: `2026-10-21T00:00:00Z`");
      expect(output).toContain("Task: `shop/web/core/invoice`");
      expect(output).toContain('`activity`: `"verification"`');
      expect(output).toContain("`ready`: `true`");
    } else {
      for (const value of ["evt_1", "task.activity-ready", "2026-10-21T00:00:00Z", "shop/web/core/invoice", "verification", "true"]) {
        expect(output).toContain(value);
      }
    }
  });

  it.each(["member-action", "blocked", "unsupported", "complete"] as const)("renders %s continuation status as guidance/evidence", async (status) => {
    for (const format of ["text", "markdown"] as const) {
      const continuationEvent = continuation(status);
      const responseFrame = `event: task-event\nid: ${continuationEvent.id}\ndata: ${JSON.stringify(continuationEvent)}\n\n`;
      const state = harness(async () => new Response(responseFrame, { headers: { "content-type": "text/event-stream" } }), { profile: true, token: "TEST-token" });

      expect(await runCli(["task", "watch", "web/core/invoice", "--limit", "1", "--format", format], state.deps as never)).toBe(0);
      const output = state.output().stdout;
      expect(output).toContain(format === "markdown" ? "### Task continuation guidance/evidence" : "Task continuation guidance/evidence");
      for (const value of [status, continuationEvent.metadata.code, recordCommit, sourceCommit, continuationEvent.metadata.nextAction]) {
        expect(output).toContain(expectedMarkdownValue(value, format));
      }
      if (continuationEvent.metadata.phase === null) expect(output).not.toMatch(/(?:Phase|Stage):/);
      else for (const value of [continuationEvent.metadata.phase, continuationEvent.metadata.stage]) expect(output).toContain(value);
      expect(output.toLowerCase()).not.toContain("gate approved");
    }
  });

  it("omits null phase and stage while retaining the source commit", async () => {
    const continuationEvent = continuation("blocked");
    const responseFrame = `event: task-event\nid: ${continuationEvent.id}\ndata: ${JSON.stringify(continuationEvent)}\n\n`;
    const state = harness(async () => new Response(responseFrame, { headers: { "content-type": "text/event-stream" } }), { profile: true, token: "TEST-token" });

    expect(await runCli(["task", "watch", "web/core/invoice", "--limit", "1", "--format", "markdown"], state.deps as never)).toBe(0);
    const output = state.output().stdout;
    expect(output).toContain("- Status: `blocked`");
    expect(output).toContain(expectedMarkdownValue(continuationEvent.metadata.nextAction, "markdown"));
    expect(output).toContain(`- Source commit: \`${sourceCommit}\``);
    expect(output).not.toMatch(/(?:Phase|Stage):/);
    expect(output).not.toContain("null");
  });

  it("preserves continuation JSON as the exact event object", async () => {
    const continuationEvent = continuation("complete");
    const responseFrame = `event: task-event\nid: ${continuationEvent.id}\ndata: ${JSON.stringify(continuationEvent)}\n\n`;
    const state = harness(async () => new Response(responseFrame, { headers: { "content-type": "text/event-stream" } }), { profile: true, token: "TEST-token" });

    expect(await runCli(["task", "watch", "web/core/invoice", "--limit", "1", "--json"], state.deps as never)).toBe(0);
    expect(state.output().stdout).toBe(`${JSON.stringify(continuationEvent)}\n`);
  });

  it("renders continuation Markdown values in code spans longer than embedded backtick runs", async () => {
    const base = continuation("member-action");
    const continuationEvent = { ...base, metadata: { ...base.metadata, nextAction: "Review issue #123 and reference `details`." } };
    const responseFrame = `event: task-event\nid: ${continuationEvent.id}\ndata: ${JSON.stringify(continuationEvent)}\n\n`;
    const state = harness(async () => new Response(responseFrame, { headers: { "content-type": "text/event-stream" } }), { profile: true, token: "TEST-token" });

    expect(await runCli(["task", "watch", "web/core/invoice", "--limit", "1", "--format", "markdown"], state.deps as never)).toBe(0);
    const output = state.output().stdout;
    expect(output).toContain(`- Record commit: \`${recordCommit}\``);
    expect(output).toContain("- Next action: ``Review issue #123 and reference `details`.``");
  });

  it("renders every dynamic generic Markdown value in code spans", async () => {
    const genericEvent = { ...event("evt_issue"), kind: "issue #123", occurredAt: "2026-10-21T00:00:00Z", metadata: { "reference #123": "commit a9993e364706816aba3e25717850c26c9cd0d89d" } };
    const responseFrame = `event: task-event\nid: ${genericEvent.id}\ndata: ${JSON.stringify(genericEvent)}\n\n`;
    const state = harness(async () => new Response(responseFrame, { headers: { "content-type": "text/event-stream" } }), { profile: true, token: "TEST-token" });

    expect(await runCli(["task", "watch", "web/core/invoice", "--limit", "1", "--format", "markdown"], state.deps as never)).toBe(0);
    const output = state.output().stdout;
    expect(output).toContain("### `issue #123` (`evt_issue`)");
    expect(output).toContain("Time: `2026-10-21T00:00:00Z`");
    expect(output).toContain("Task: `shop/web/core/invoice`");
    expect(output).toContain('`reference #123`: `"commit a9993e364706816aba3e25717850c26c9cd0d89d"`');
  });

  it("keeps unknown event kinds on the generic metadata renderer", async () => {
    const unknownEvent = { ...event("evt_unknown"), kind: "future.event", metadata: { detail: "preserve this metadata" } };
    const responseFrame = `event: task-event\nid: ${unknownEvent.id}\ndata: ${JSON.stringify(unknownEvent)}\n\n`;
    const state = harness(async () => new Response(responseFrame, { headers: { "content-type": "text/event-stream" } }), { profile: true, token: "TEST-token" });

    expect(await runCli(["task", "watch", "web/core/invoice", "--limit", "1", "--format", "text"], state.deps as never)).toBe(0);
    expect(state.output().stdout).toContain("future.event");
    expect(state.output().stdout).toContain('detail: "preserve this metadata"');
    expect(state.output().stdout).not.toContain("continuation guidance/evidence");
  });

  it.each(["text", "markdown"] as const)("escapes hostile continuation fields in %s output", async (format) => {
    const hostile = "safe\n### forged header\rStatus: forged\u001b[31m**bold** [link](https://example.test)\u2028";
    const base = continuation("member-action");
    const continuationEvent = { ...base, metadata: { ...base.metadata, status: hostile, code: hostile, phase: hostile, nextAction: hostile } };
    const responseFrame = `event: task-event\nid: ${continuationEvent.id}\ndata: ${JSON.stringify(continuationEvent)}\n\n`;
    const state = harness(async () => new Response(responseFrame, { headers: { "content-type": "text/event-stream" } }), { profile: true, token: "TEST-token" });

    const exitCode = await runCli(["task", "watch", "web/core/invoice", "--limit", "1", "--format", format], state.deps as never);
    expect(exitCode, state.output().stderr).toBe(0);
    const output = state.output().stdout;
    expectSafeEventOutput(output, format);
    expect(output).toContain("\\n");
    if (format === "markdown") {
      expect(output).toContain("- Status: `safe\\n### forged header\\rStatus: forged\\u001B[31m**bold** [link](https://example.test)\\u2028`");
    }
  });

  it.each(["text", "markdown"] as const)("escapes hostile generic headers and metadata in %s output", async (format) => {
    const hostile = "safe\n### forged header\rStatus: forged\u001b[31m**bold** [link](https://example.test)\u2028";
    const unknownEvent = { ...event("evt_unknown"), kind: "future.event\n### forged kind",
      metadata: { "## Forged header\nFake field": hostile } };
    const responseFrame = `event: task-event\nid: ${unknownEvent.id}\ndata: ${JSON.stringify(unknownEvent)}\n\n`;
    const state = harness(async () => new Response(responseFrame, { headers: { "content-type": "text/event-stream" } }), { profile: true, token: "TEST-token" });

    expect(await runCli(["task", "watch", "web/core/invoice", "--limit", "1", "--format", format], state.deps as never)).toBe(0);
    const output = state.output().stdout;
    expectSafeEventOutput(output, format);
    expect(output).toContain("future.event");
    expect(output).toContain("\\n");
    if (format === "markdown") {
      expect(output).toContain("### `future.event\\n### forged kind` (`evt_unknown`)");
      expect(output).toContain('`## Forged header\\nFake field`: `"safe\\n### forged header\\rStatus: forged\\u001B[31m**bold** [link](https://example.test)\\u2028"`');
    }
  });

  it.each(["text", "markdown"] as const)("escapes bidi formatting controls in continuation fields in %s output", async (format) => {
    const base = continuation("member-action");
    const continuationEvent = { ...base, metadata: { ...base.metadata, nextAction: "before\u202eafter\u2066isolated\u2069" } };
    const responseFrame = `event: task-event\nid: ${continuationEvent.id}\ndata: ${JSON.stringify(continuationEvent)}\n\n`;
    const state = harness(async () => new Response(responseFrame, { headers: { "content-type": "text/event-stream" } }), { profile: true, token: "TEST-token" });

    expect(await runCli(["task", "watch", "web/core/invoice", "--limit", "1", "--format", format], state.deps as never)).toBe(0);
    const output = state.output().stdout;
    expectSafeEventOutput(output, format);
    expect(output).toContain("\\u202E");
    expect(output).toContain("\\u2066");
    expect(output).toContain("\\u2069");
    expect(output).not.toContain("\u202e");
    expect(output).not.toContain("\u2066");
    expect(output).not.toContain("\u2069");
  });

  it("preserves latestContinuation in JSON and marks continuation events advisory in text and Markdown", async () => {
    const value = {
      ...event("evt_continuation"),
      kind: "task.continuation",
      metadata: {
        schemaVersion: "1",
        decisionId: "decision_42",
        gateId: "G2",
        evidenceHash: "evidence_42",
        recordCommit: "da39a3ee5e6b4b0d3255bfef95601890afd80709",
        sourceCommit: "a9993e364706816aba3e25717850c26c9cd0d89d",
        status: "member-action",
        code: "MEMBER_STAGE_AVAILABLE",
        phase: "verify",
        stage: "test",
        nextAction: "Continue the declared member stage test in phase verify.",
        latestContinuation: "The suggested next activity is verification.",
      },
    };
    const responseFrame = `event: task-event\nid: ${value.id}\ndata: ${JSON.stringify(value)}\n\n`;
    const jsonState = harness(async () => new Response(responseFrame, { headers: { "content-type": "text/event-stream" } }), { profile: true, token: "TEST-token" });

    expect(await runCli(["task", "watch", "web/core/invoice", "--limit", "1", "--json"], jsonState.deps as never)).toBe(0);
    expect(jsonState.output().stdout).toBe(`${JSON.stringify(value)}\n`);

    for (const format of ["text", "markdown"] as const) {
      const state = harness(async () => new Response(responseFrame, { headers: { "content-type": "text/event-stream" } }), { profile: true, token: "TEST-token" });
      expect(await runCli(["task", "watch", "web/core/invoice", "--limit", "1", "--format", format], state.deps as never)).toBe(0);
      const output = state.output().stdout;
      expect(output).toContain("Continuation is advisory only.");
      expect(output).toContain("Fetch current task status before taking action.");
      expect(output).toContain("latestContinuation");
      expect(output).toContain("The suggested next activity is verification.");
    }
  });

  it.each(["text", "markdown"] as const)("safely renders dynamic event values in %s", async (format) => {
    const hostile = "safe\n### forged header\rStatus: forged\u001b[31m**bold** [link](https://example.test)\u2028\u202e";
    const value = {
      ...event("evt_hostile"),
      kind: "future.event\n### forged kind",
      metadata: { "## Forged header\nFake field": hostile },
    };
    const responseFrame = `event: task-event\nid: evt_hostile\ndata: ${JSON.stringify(value)}\n\n`;
    const state = harness(async () => new Response(responseFrame, { headers: { "content-type": "text/event-stream" } }), { profile: true, token: "TEST-token" });

    expect(await runCli(["task", "watch", "web/core/invoice", "--limit", "1", "--format", format], state.deps as never)).toBe(0);
    const output = state.output().stdout;
    const controls = [...output.replaceAll("\n", "")].filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) || codePoint === 0x2028 || codePoint === 0x2029
        || codePoint === 0x061c || codePoint === 0x200e || codePoint === 0x200f
        || (codePoint >= 0x202a && codePoint <= 0x202e) || (codePoint >= 0x2066 && codePoint <= 0x2069);
    });
    expect(controls).toHaveLength(0);
    expect(output).not.toMatch(/\n(?:#{1,6}\s+forged|Status: forged|Fake field:)/i);
    expect(output).toContain("\\n");
    expect(output).toContain("\\u001B[31m");
    expect(output).toContain("\\u202E");
    if (format === "markdown") {
      expect(output).toContain("### `future.event\\n### forged kind`");
      expect(output).toContain('`## Forged header\\nFake field`: `"safe\\n### forged header\\rStatus: forged\\u001B[31m**bold** [link](https://example.test)\\u2028\\u202E"`');
    }
  });

  it("escapes display controls in JSON task events without changing parsed values", async () => {
    const value = {
      ...event("evt_json_controls"),
      metadata: {
        hostile: "line\u0085separator\u2028paragraph\u2029rtl\u202eoverride\u2066isolate\u2069",
        "key\u200fmark": "preserved",
      },
    };
    const responseFrame = `event: task-event\nid: ${value.id}\ndata: ${JSON.stringify(value)}\n\n`;
    const state = harness(async () => new Response(responseFrame, { headers: { "content-type": "text/event-stream" } }), { profile: true, token: "TEST-token" });

    expect(await runCli(["task", "watch", "web/core/invoice", "--limit", "1", "--json"], state.deps as never)).toBe(0);
    const output = state.output().stdout;
    const jsonLine = output.trimEnd();
    expect(jsonLine).not.toMatch(/[\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/);
    for (const escaped of ["\\u0085", "\\u2028", "\\u2029", "\\u202E", "\\u2066", "\\u2069", "\\u200F"]) {
      expect(jsonLine).toContain(escaped);
    }
    expect(JSON.parse(output)).toEqual(value);
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
