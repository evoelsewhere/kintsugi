import { createHash } from "node:crypto";
import { request } from "node:http";
import { describe, expect, it } from "vitest";
import type { CliDeps } from "../src/cli.js";
import { createOAuthCallback, createPkce, OAuthSession } from "../src/oauth.js";

const profile = { id: "work", baseUrl: "https://kintsugi.example", projectId: "shop" };
const stored = JSON.stringify({ version: 1, baseUrl: profile.baseUrl, refreshToken: "knt_crt_old", connectionId: "conn", projectIds: ["shop"] });
const tokens = { accessToken: "knt_caw_new", refreshToken: "knt_crt_new", expiresIn: 300, connectionId: "conn", projectIds: ["shop"] };

function setup(options: { raw?: string; response?: Response; writeFails?: boolean } = {}) {
  let raw = options.raw ?? stored;
  let writes = 0;
  let requests = 0;
  const bodies: unknown[] = [];
  const deps = {
    credentials: {
      get: async () => raw || undefined,
      set: async (_id: string, value: string) => { writes++; if (options.writeFails && writes === 2) throw new Error("keyring unavailable"); raw = value; },
      delete: async () => { raw = ""; },
    },
    fetch: async (_url: string, init: RequestInit) => { requests++; bodies.push(JSON.parse(String(init.body))); return options.response ?? Response.json({ success: true, data: tokens }); },
    stderr: { write: () => undefined },
  } as unknown as CliDeps;
  let time = 0;
  const session = new OAuthSession(deps, () => time);
  return { session, deps, raw: () => raw, writes: () => writes, requests: () => requests, bodies, advance: (ms: number) => { time += ms; } };
}

describe("OAuth browser connection", () => {
  it("serializes independent sessions and rereads the rotated keyring value", async () => {
    const h = setup();
    const seen: string[] = [];
    let next = "knt_crt_old";
    let sequence = 0;
    h.deps.fetch = async (_url, init) => {
      const refresh = (JSON.parse(String(init?.body)) as { refreshToken: string }).refreshToken;
      seen.push(refresh);
      if (refresh !== next) return Response.json({ success: false }, { status: 401 });
      const generation = ++sequence;
      next = `knt_crt_${generation}`;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return Response.json({ success: true, data: { ...tokens, accessToken: `knt_caw_${generation}`, refreshToken: next } });
    };
    const second = new OAuthSession(h.deps);
    const results = await Promise.allSettled([h.session.accessTokenFor(profile), second.accessTokenFor(profile)]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(seen).toEqual(["knt_crt_old", "knt_crt_1"]);
    expect(JSON.parse(h.raw()).refreshToken).toBe("knt_crt_2");
  });

  it("never replays a refresh left uncertain by a crashed process", async () => {
    const h = setup({ raw: JSON.stringify({ ...JSON.parse(stored), refreshPending: true }) });
    const routes: string[] = [];
    h.deps.fetch = async (url) => { routes.push(String(url)); return new Response(null, { status: 204 }); };
    await expect(h.session.accessTokenFor(profile)).rejects.toMatchObject({ code: "REAUTHENTICATION_REQUIRED" });
    expect(routes).toEqual(["https://kintsugi.example/api/auth/coding-agent/revoke"]);
    expect(h.raw()).toBe("");
  });

  it("does not consume refresh if the keyring cannot first save its pending marker", async () => {
    const h = setup();
    h.deps.credentials.set = async () => { throw new Error("keyring unavailable"); };
    await expect(h.session.accessTokenFor(profile)).rejects.toMatchObject({ code: "REAUTHENTICATION_REQUIRED" });
    expect(h.requests()).toBe(0);
    expect(h.raw()).toBe("");
  });
  it("generates independent random state and the S256 verifier challenge", () => {
    const first = createPkce();
    const second = createPkce();
    expect(first.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.state).not.toBe(first.codeVerifier);
    expect(first.state).not.toBe(second.state);
    expect(first.codeVerifier).not.toBe(second.codeVerifier);
    expect(first.codeChallenge).toBe(createHash("sha256").update(first.codeVerifier).digest("base64url"));
  });

  it("refreshes once for concurrent calls and keeps access tokens out of storage", async () => {
    const h = setup();
    expect(await Promise.all(Array.from({ length: 10 }, () => h.session.accessTokenFor(profile)))).toEqual(Array(10).fill("knt_caw_new"));
    expect(h.requests()).toBe(1);
    expect(h.bodies).toEqual([{ grantType: "refresh_token", refreshToken: "knt_crt_old" }]);
    expect(h.raw()).not.toContain("knt_caw_");
    expect(JSON.parse(h.raw()).refreshToken).toBe("knt_crt_new");
  });

  it("proactively rotates again during the final thirty seconds of access validity", async () => {
    const h = setup();
    await h.session.accessTokenFor(profile);
    h.advance(269_000);
    await h.session.accessTokenFor(profile);
    expect(h.requests()).toBe(1);
    h.advance(1000);
    await h.session.accessTokenFor(profile);
    expect(h.requests()).toBe(2);
    expect(h.bodies[1]).toEqual({ grantType: "refresh_token", refreshToken: "knt_crt_new" });
  });

  it("discards access on keyring rotation failure and requires sign-in without replay", async () => {
    const h = setup({ writeFails: true });
    await expect(h.session.accessTokenFor(profile)).rejects.toMatchObject({ code: "REAUTHENTICATION_REQUIRED" });
    await expect(h.session.accessTokenFor(profile)).rejects.toMatchObject({ code: "REAUTHENTICATION_REQUIRED" });
    expect(h.requests()).toBe(2);
    expect(h.bodies[1]).toEqual({ refreshToken: "knt_crt_new" });
    expect(h.raw()).toBe("");
  });

  it.each([400, 401, 403])("requires sign-in after server policy cap/revocation rejection %s", async (status) => {
    const h = setup({ response: Response.json({ success: false, message: "sensitive server detail" }, { status }) });
    await expect(h.session.accessTokenFor(profile)).rejects.toMatchObject({ code: "REAUTHENTICATION_REQUIRED" });
    expect(h.raw()).toBe("");
    await expect(h.session.accessTokenFor(profile)).rejects.toMatchObject({ code: "REAUTHENTICATION_REQUIRED" });
    expect(h.requests()).toBe(1);
  });

  it("passes an existing PAT through without refresh", async () => {
    const h = setup({ raw: "knt_pat_legacy" });
    expect(await h.session.accessTokenFor(profile)).toBe("knt_pat_legacy");
    expect(h.requests()).toBe(0);
    expect(h.writes()).toBe(0);
  });

  it.each(["knt_caw_unpersistable", "knt_crt_not-an-envelope"])("rejects a raw OAuth secret in place of a refresh envelope: %s", async (raw) => {
    const h = setup({ raw });
    await expect(h.session.accessTokenFor(profile)).rejects.toMatchObject({ code: "REAUTHENTICATION_REQUIRED" });
    expect(h.requests()).toBe(0);
  });

  it("rejects cross-installation refresh credentials without network calls", async () => {
    const h = setup();
    await expect(h.session.accessTokenFor({ ...profile, baseUrl: "https://other.example" })).rejects.toMatchObject({ code: "PROFILE_INSTALLATION_MISMATCH" });
    expect(h.requests()).toBe(0);
  });

  it("revokes before clearing local state and retains the credential on failure", async () => {
    const h = setup({ response: new Response(null, { status: 204 }) });
    let rawAtRevocation: string | undefined;
    h.deps.fetch = async (url, init) => {
      expect(String(url)).toBe("https://kintsugi.example/api/auth/coding-agent/revoke");
      expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: "knt_crt_old" });
      expect(new Headers(init?.headers).get("x-kintsugi-csrf")).toBe("1");
      expect(init?.credentials).toBe("omit");
      rawAtRevocation = h.raw();
      return new Response(null, { status: 204 });
    };
    expect(await h.session.logout(profile)).toBe(false);
    expect(rawAtRevocation).toBe(stored);
    expect(h.raw()).toBe("");
    const rejected = setup({ response: new Response(null, { status: 503 }) });
    await expect(rejected.session.logout(profile)).rejects.toMatchObject({ code: "OAUTH_REVOCATION_FAILED" });
    expect(rejected.raw()).toBe(stored);
  });

  it("clears legacy PAT locally without a revocation request", async () => {
    const h = setup({ raw: "knt_pat_legacy" });
    expect(await h.session.logout(profile)).toBe(true);
    expect(h.raw()).toBe("");
    expect(h.requests()).toBe(0);
  });

  it("rejects a callback state mismatch before code exchange and closes the listener", async () => {
    const h = setup();
    let closed = false;
    let completion: string | undefined;
    h.deps.createOAuthCallback = async () => ({ redirectUri: "http://127.0.0.1:54321/oauth/callback", waitForCode: async () => ({ code: "code", state: "wrong" }), complete: async (outcome) => { completion = outcome; }, close: async () => { closed = true; } });
    h.deps.openBrowser = async () => undefined;
    await expect(h.session.beginBrowserLogin(profile, "shop")).rejects.toMatchObject({ code: "OAUTH_CALLBACK_INVALID" });
    expect(completion).toBe("error");
    expect(closed).toBe(true);
    expect(h.requests()).toBe(0);
  });

  it("prints an actionable local URL on stderr when automatic browser launch is unavailable", async () => {
    const h = setup();
    let output = "";
    let completion: string | undefined;
    let credentialAtCompletion = "";
    h.deps.stderr.write = (value) => { output += value; };
    h.deps.openBrowser = async () => { throw new Error("sensitive launcher detail"); };
    h.deps.createOAuthCallback = async ({ state }) => ({ redirectUri: "http://127.0.0.1:54321/oauth/callback", waitForCode: async () => ({ code: "manual-code", state }), complete: async (outcome) => { completion = outcome; credentialAtCompletion = h.raw(); }, close: async () => undefined });
    await h.session.beginBrowserLogin(profile, "shop");
    expect(completion).toBe("success");
    expect(credentialAtCompletion).toContain("knt_crt_new");
    expect(output).toContain("https://kintsugi.example/member/authorize?");
    const authorizationUrl = output.match(/https:\/\/[^\s]+/)?.[0];
    expect(authorizationUrl).toBeDefined();
    expect(Number(new URL(authorizationUrl!).searchParams.get("expiresAt"))).toBeGreaterThan(Date.now());
    expect(output).toContain("Open the URL above on this machine");
    expect(output).not.toContain("sensitive launcher detail");
    expect(output).not.toContain("knt_crt_");
    expect(h.requests()).toBe(1);
  });

  it("cancels an injected pending callback without reading stdin", async () => {
    const h = setup();
    const controller = new AbortController();
    h.deps.signal = controller.signal;
    let closed = false;
    h.deps.createOAuthCallback = async () => ({ redirectUri: "http://127.0.0.1:54321/oauth/callback", waitForCode: () => new Promise(() => undefined), close: async () => { closed = true; } });
    h.deps.openBrowser = async () => { controller.abort(); };
    await expect(h.session.beginBrowserLogin(profile, "shop")).rejects.toMatchObject({ code: "CANCELLED" });
    expect(closed).toBe(true);
    expect(h.requests()).toBe(0);
  });

  it("reports an actionable timeout when the injected callback never completes", async () => {
    const h = setup();
    let opened!: () => void;
    const browserOpened = new Promise<void>((resolve) => { opened = resolve; });
    h.deps.createOAuthCallback = async () => ({ redirectUri: "http://127.0.0.1:54321/oauth/callback", waitForCode: () => new Promise(() => undefined), close: async () => undefined });
    h.deps.openBrowser = async () => { opened(); };
    const controller = new AbortController();
    h.deps.signal = controller.signal;
    const waiting = expect(h.session.beginBrowserLogin(profile, "shop")).rejects.toMatchObject({ code: "OAUTH_TIMEOUT", message: expect.stringContaining("2 minutes") });
    await browserOpened;
    controller.abort(new DOMException("Deadline exceeded", "TimeoutError"));
    await waiting;
  });
});

describe("loopback callback", () => {
  it("shows a branded completion page and reports success only after the CLI finishes sign-in", async () => {
    const listener = await createOAuthCallback({ state: "expected" });
    try {
      const response = await fetch(listener.redirectUri + "?code=one-time-code&state=expected");
      expect(new URL(response.url).pathname).toBe("/oauth/complete");
      expect(new URL(response.url).search).toBe("");
      const body = await response.text();
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-security-policy")).toContain("script-src 'nonce-");
      expect(response.headers.get("content-type")).toContain("text/html");
      const pending = await fetch(new URL("/oauth/status", listener.redirectUri));
      expect(await pending.json()).toEqual({ status: "pending" });

      expect(body).toContain("Completing your Kintsugi sign-in");
      expect(body).toContain("Kintsugi connection ready");
      const nonce = response.headers.get("content-security-policy")?.match(/script-src 'nonce-([^']+)'/)?.[1];
      expect(nonce).toBeDefined();
      expect(body).toContain(`style nonce="${nonce}"`);
      expect(body).toContain(`script nonce="${nonce}"`);
      expect(body).toContain("Return to your coding agent and retry your request");
      expect(body).not.toContain("one-time-code");
      const complete = (listener as unknown as { complete?: (outcome: "success" | "error") => Promise<void> }).complete;
      expect(complete).toBeTypeOf("function");
      if (typeof complete !== "function") return;
      const completion = complete("success");
      const status = await fetch(new URL("/oauth/status", listener.redirectUri));
      expect(await status.json()).toEqual({ status: "success" });
      await completion;
    } finally { await listener.close(); }
  });
  it("shows an error state when the CLI cannot finish exchanging the authorization code", async () => {
    const listener = await createOAuthCallback({ state: "expected" });
    try {
      const response = await fetch(listener.redirectUri + "?code=one-time-code&state=expected");
      expect(response.status).toBe(200);
      expect(new URL(response.url).pathname).toBe("/oauth/complete");
      expect(new URL(response.url).search).toBe("");
      const body = await response.text();
      expect(body).toContain("Kintsugi could not finish sign-in");
      const complete = (listener as unknown as { complete?: (outcome: "success" | "error") => Promise<void> }).complete;
      expect(complete).toBeTypeOf("function");
      if (typeof complete !== "function") return;
      const completion = complete("error");
      const status = await fetch(new URL("/oauth/status", listener.redirectUri));
      expect(await status.json()).toEqual({ status: "error" });
      await completion;
    } finally { await listener.close(); }
  });
  it("rejects an untrusted Host without consuming the real loopback callback", async () => {
    const listener = await createOAuthCallback({ state: "expected" });
    try {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const outgoing = request(listener.redirectUri + "?code=code&state=expected", { headers: { host: "evil.example" } }, (response) => { response.resume(); resolve(response.statusCode); });
        outgoing.once("error", reject);
        outgoing.end();
      });
      expect(status).toBe(400);
      expect((await fetch(listener.redirectUri + "?code=code&state=expected")).status).toBe(200);
      expect(await listener.waitForCode()).toEqual({ code: "code", state: "expected" });
    } finally { await listener.close(); }
  });
  it("only accepts the callback route once and rejects replay", async () => {
    const listener = await createOAuthCallback({ state: "expected" });
    try {
      expect(new URL(listener.redirectUri).hostname).toBe("127.0.0.1");
      expect((await fetch(listener.redirectUri.replace("/oauth/callback", "/elsewhere") + "?code=code&state=expected")).status).toBe(404);
      expect((await fetch(listener.redirectUri + "?code=code&state=expected")).status).toBe(200);
      expect(await listener.waitForCode()).toEqual({ code: "code", state: "expected" });
      expect((await fetch(listener.redirectUri + "?code=code&state=expected")).status).toBe(410);
    } finally { await listener.close(); }
  });

  it.each(["code=code&state=wrong", "code=code&code=second&state=expected", "state=expected", "code=code&state=expected&state=expected"])("rejects malformed callbacks: %s", async (query) => {
    const listener = await createOAuthCallback({ state: "expected" });
    try {
      const waiting = expect(listener.waitForCode()).rejects.toMatchObject({ code: "OAUTH_CALLBACK_INVALID" });
      expect((await fetch(listener.redirectUri + "?" + query)).status).toBe(400);
      await waiting;
    } finally { await listener.close(); }
  });

  it("times out and closes the listening port", async () => {
    const listener = await createOAuthCallback({ state: "expected", timeoutMs: 10 });
    await expect(listener.waitForCode()).rejects.toMatchObject({ code: "OAUTH_TIMEOUT", message: expect.stringContaining("1 second") });
    await expect(fetch(listener.redirectUri)).rejects.toThrow();
    await listener.close();
  });

  it("cleans up an aborted listener", async () => {
    const controller = new AbortController();
    const listener = await createOAuthCallback({ state: "expected", signal: controller.signal });
    const waiting = expect(listener.waitForCode()).rejects.toMatchObject({ code: "CANCELLED" });
    controller.abort();
    await waiting;
    await expect(fetch(listener.redirectUri)).rejects.toThrow();
    await listener.close();
  });
});
