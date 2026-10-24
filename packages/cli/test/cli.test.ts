import { describe, expect, it, vi } from "vitest";
import { createDefaultCliDeps, runCli } from "../src/cli.js";
import { getNativeClientVersion } from "../src/client-version.js";
import { EventEmitter } from "node:events";
import * as cliModule from "../src/cli.js";
import type { MemberPort } from "@kintsugi/harness-sdk";
import { stableProjectProfileId } from "../src/profile.js";

describe("native client version detection", () => {
  it("uses direct execution for Windows client executables", async () => {
    const execute = vi.fn(async () => ({ stdout: "2.1.278\n", stderr: "" }));

    await expect(getNativeClientVersion("claude", "win32", execute as never)).resolves.toBe("2.1.278");
    expect(execute).toHaveBeenCalledWith("claude", ["--version"], expect.objectContaining({ shell: false }));
  });

  it("starts a client that is only a .cmd shim through PowerShell on Windows", async () => {
    const missing = Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });
    const execute = vi.fn()
      .mockRejectedValueOnce(missing)
      .mockResolvedValueOnce({ stdout: "2.1.260 (Claude Code)\n", stderr: "" });
    const previous = process.env.SystemRoot;
    process.env.SystemRoot = "C:\\Windows";
    try {
      await expect(getNativeClientVersion("claude", "win32", execute as never)).resolves.toBe("2.1.260");
    } finally {
      if (previous === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = previous;
    }
    expect(execute.mock.calls[1]![0]).toMatch(/powershell\.exe$/);
    expect(execute.mock.calls[1]![2]).toMatchObject({ env: { KINTSUGI_NATIVE_EXECUTABLE: "claude", KINTSUGI_NATIVE_ARGS: '["--version"]' } });
    // A client that is not installed at all still fails, and Unix never retries.
    await expect(getNativeClientVersion("claude", "linux", vi.fn().mockRejectedValue(missing) as never)).rejects.toBe(missing);
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
    serveMcp: async (_member: MemberPort) => undefined,
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
      serveMcp: async (access: MemberPort) => { await access.listProjects({ limit: 5 }); return undefined; },
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
    expect(authorization?.pathname).toBe("/member/authorize");
    expect(authorization?.searchParams.get("projectId")).toBe("shop");
    expect(authorization?.searchParams.get("codeChallengeMethod")).toBe("S256");
    expect(requests[0]?.url).toBe("https://kintsugi.example/api/auth/coding-agent/token");
    expect(new Headers(requests[0]?.init?.headers).get("x-kintsugi-csrf")).toBe("1");
    // The profile of a project is the one init and connect use for it.
    const profile = stableProjectProfileId("https://kintsugi.example", "shop");
    expect(JSON.parse(state.credentials.values.get(profile)!)).toMatchObject({ version: 1, refreshToken: "knt_crt_test", connectionId: "connection-1", projectIds: ["shop"] });
    expect(state.credentials.values.get(profile)).not.toContain("knt_caw_test");
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
      serveMcp: async (access: MemberPort) => {
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
      serveMcp: async (access: MemberPort) => {
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

  it("serves MCP with the selected profile and reloads its credential for every request", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ok({ schemaVersion: "1", items: [], limit: 25 }));
    const state = harness(fetch, { profile: true, token: "TEST-mcp-token" });
    let observedAccess: MemberPort | undefined;
    state.deps.serveMcp = async (access) => {
      observedAccess = access;
      await access.listProjects({ limit: 5 });
      state.credentials.values.delete("work");
      await expect(access.listProjects({ limit: 5 })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    };
    const code = await runCli(["mcp", "serve", "--profile", "work"], state.deps as never);
    expect(code).toBe(0);
    expect(observedAccess).toBeDefined();
    expect(fetch).toHaveBeenCalledOnce();
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer TEST-mcp-token");
    expect(state.credentials.get).toHaveBeenCalledTimes(2);
    expect(state.output().stdout + state.output().stderr).not.toContain("TEST-mcp-token");
  });

  it("rejects a connection-level project selector so MCP calls stay explicit", async () => {
    const state = harness(async () => ok({ schemaVersion: "1", items: [], limit: 25 }), { profile: true, token: "TEST-token" });
    const serveMcp = vi.fn(async (_member: MemberPort) => undefined);
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
