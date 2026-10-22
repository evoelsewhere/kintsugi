import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import type { CliDeps, OAuthLoopbackCallback } from "./cli.js";
import { CliError, type Profile } from "./profile.js";
import { createFetchWithPrivateCa } from "./tls.js";
import { withCredentialLock } from "./oauth-lock.js";

export interface OAuthCredential {
  version: 1;
  baseUrl: string;
  refreshToken: string;
  connectionId: string;
  projectIds: string[];
  /** Written before refresh: a crash must never cause the old token to be replayed. */
  refreshPending?: true;
}

export interface OAuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  connectionId: string;
  projectIds: string[];
}

export function createPkce(): { state: string; codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString("base64url");
  return { state: randomBytes(32).toString("base64url"), codeVerifier, codeChallenge: createHash("sha256").update(codeVerifier).digest("base64url") };
}

function sameState(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function cancelled(signal?: AbortSignal): CliError {
  return signal?.reason instanceof Error && signal.reason.name === "TimeoutError"
    ? new CliError("OAUTH_TIMEOUT", "Browser sign-in timed out; run auth login again")
    : new CliError("CANCELLED", "Browser sign-in cancelled");
}
function reauthenticate(): CliError { return new CliError("REAUTHENTICATION_REQUIRED", "Sign in again with auth login; the connection expired, was revoked, or could not be saved securely", 401); }

export function parseOAuthCredential(value: string): OAuthCredential | undefined {
  if (value.startsWith("knt_caw_") || value.startsWith("knt_crt_")) throw reauthenticate();
  if (!value.startsWith("{")) return undefined;
  try {
    const item = JSON.parse(value) as Partial<OAuthCredential>;
    if (item.version === 1 && typeof item.baseUrl === "string" && typeof item.refreshToken === "string" && item.refreshToken.startsWith("knt_crt_") && typeof item.connectionId === "string" && Array.isArray(item.projectIds) && item.projectIds.every((id) => typeof id === "string") && (item.refreshPending === undefined || item.refreshPending === true)) return item as OAuthCredential;
  } catch { /* Invalid envelopes require fresh sign-in. */ }
  throw reauthenticate();
}

export async function openSystemBrowser(url: string): Promise<void> {
  const executable = process.platform === "win32" ? "rundll32.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: "ignore" });
    child.once("error", () => reject(new CliError("BROWSER_UNAVAILABLE", "Open the sign-in URL on this machine")));
    child.once("close", (code) => code === 0 ? resolve() : reject(new CliError("BROWSER_UNAVAILABLE", "Open the sign-in URL on this machine")));
  });
}

export async function createOAuthCallback(options: { state: string; signal?: AbortSignal; timeoutMs?: number }): Promise<OAuthLoopbackCallback> {
  if (options.signal?.aborted) throw cancelled(options.signal);
  let resolveCode!: (result: { code: string; state: string }) => void;
  let rejectCode!: (error: Error) => void;
  let settled = false;
  const code = new Promise<{ code: string; state: string }>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  // The callback can receive a request before the browser launcher returns.
  void code.catch(() => undefined);
  const server = createServer((request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-type", "text/plain; charset=utf-8");
    if (settled) { response.writeHead(410).end("Sign-in callback already consumed"); return; }
    const address = server.address();
    if (address === null || typeof address === "string" || request.headers.host !== `127.0.0.1:${address.port}` || !request.url?.startsWith("/") || request.url.startsWith("//")) { response.writeHead(400).end("Invalid callback origin"); return; }
    let url: URL;
    try { url = new URL(request.url, "http://127.0.0.1"); }
    catch { response.writeHead(400).end("Invalid callback URL"); return; }
    if (request.method !== "GET" || url.pathname !== "/oauth/callback") { response.writeHead(404).end("Unknown callback"); return; }
    const authorizationCode = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!authorizationCode || authorizationCode.length > 200 || !/^[A-Za-z0-9_-]+$/.test(authorizationCode) || url.searchParams.getAll("code").length !== 1 || url.searchParams.getAll("state").length !== 1 || state === null || !sameState(state, options.state)) {
      settled = true;
      response.writeHead(400).end("Invalid sign-in callback");
      rejectCode(new CliError("OAUTH_CALLBACK_INVALID", "The sign-in callback was invalid; start sign-in again"));
      return;
    }
    settled = true;
    response.writeHead(200).end("Kintsugi sign-in complete. You can close this page.");
    resolveCode({ code: authorizationCode, state });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", () => reject(new CliError("OAUTH_CALLBACK_UNAVAILABLE", "A local callback listener is required; run sign-in on this machine")));
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new CliError("OAUTH_CALLBACK_UNAVAILABLE", "No local callback address");
  const close = async () => {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    if (!settled) { settled = true; rejectCode(cancelled()); }
    await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
  };
  const onAbort = () => { if (!settled) { settled = true; rejectCode(cancelled(options.signal)); } void close(); };
  const timer = setTimeout(() => {
    if (!settled) { settled = true; rejectCode(new CliError("OAUTH_TIMEOUT", "Browser sign-in timed out; run auth login again")); }
    void close();
  }, options.timeoutMs ?? 120_000);
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  return { redirectUri: `http://127.0.0.1:${address.port}/oauth/callback`, waitForCode: () => code, close };
}

async function awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw cancelled(signal);
  let onAbort!: () => void;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => { onAbort = () => reject(cancelled(signal)); signal.addEventListener("abort", onAbort, { once: true }); })]);
  } finally { signal.removeEventListener("abort", onAbort); }
}

export class OAuthSession {
  private readonly access = new Map<string, { token: string; expiresAt: number; credential: string }>();
  private readonly flights = new Map<string, Promise<string>>();
  private readonly unusable = new Set<string>();
  constructor(private readonly deps: CliDeps, private readonly now: () => number = Date.now) {}

  private async request(profile: Profile, route: "token" | "revoke", body: unknown, signal?: AbortSignal): Promise<Response> {
    const fetcher = profile.caFile === undefined ? this.deps.fetch : await createFetchWithPrivateCa(profile.caFile);
    const requestSignal = AbortSignal.any([AbortSignal.timeout(60_000), ...(signal === undefined ? [] : [signal])]);
    try {
      return await fetcher(`${profile.baseUrl}/api/auth/coding-agent/${route}`, { method: "POST", headers: { "content-type": "application/json", "x-kintsugi-csrf": "1" }, credentials: "omit", redirect: "error", body: JSON.stringify(body), signal: requestSignal });
    } catch { throw requestSignal.aborted ? cancelled(requestSignal) : new CliError("OAUTH_NETWORK_ERROR", "Could not contact Kintsugi; check the installation URL and retry"); }
  }

  private async accept(profile: Profile, response: Response): Promise<OAuthCredential> {
    if (!response.ok) throw reauthenticate();
    let token: OAuthTokenResponse;
    try {
      const result = await response.json() as { success?: boolean; data?: OAuthTokenResponse };
      if (result.success !== true || result.data === undefined) throw new Error();
      token = result.data;
      if (typeof token.accessToken !== "string" || !token.accessToken.startsWith("knt_caw_") || typeof token.refreshToken !== "string" || !token.refreshToken.startsWith("knt_crt_") || token.expiresIn !== 300 || typeof token.connectionId !== "string" || !token.connectionId || !Array.isArray(token.projectIds) || token.projectIds.length === 0 || !token.projectIds.every((id) => typeof id === "string" && id.length > 0)) throw new Error();
    } catch { throw reauthenticate(); }
    const envelope: OAuthCredential = { version: 1, baseUrl: profile.baseUrl, refreshToken: token.refreshToken, connectionId: token.connectionId, projectIds: token.projectIds };
    const serialized = JSON.stringify(envelope);
    try { await this.deps.credentials.set(profile.id, serialized); }
    catch {
      this.access.delete(profile.id);
      this.unusable.add(profile.id);
      await this.request(profile, "revoke", { refreshToken: token.refreshToken }, AbortSignal.timeout(5000)).catch(() => undefined);
      await this.deps.credentials.delete(profile.id).catch(() => undefined);
      throw reauthenticate();
    }
    this.unusable.delete(profile.id);
    this.access.set(profile.id, { token: token.accessToken, expiresAt: this.now() + token.expiresIn * 1000, credential: serialized });
    return envelope;
  }

  async beginBrowserLogin(profile: Profile, projectId: string, reuseExisting = false): Promise<OAuthCredential> {
    return await withCredentialLock(profile.id, async () => {
      // A waiting MCP process must reuse another process's completed consent.
      if (reuseExisting) {
        const raw = await this.deps.credentials.get(profile.id);
        let existing: OAuthCredential | undefined;
        try { existing = raw === undefined ? undefined : parseOAuthCredential(raw); }
        catch { /* Invalid credentials still need browser sign-in. */ }
        if (existing?.baseUrl === profile.baseUrl && existing.projectIds.includes(projectId)) {
          this.unusable.delete(profile.id);
          try {
            await this.resolveAccessUnlocked(profile);
            return parseOAuthCredential((await this.deps.credentials.get(profile.id))!)!;
          } catch (error) {
            if (!(error instanceof CliError) || error.code !== "REAUTHENTICATION_REQUIRED") throw error;
          }
        }
      }
      return await this.browserLoginUnlocked(profile, projectId);
    }, { ...(this.deps.signal === undefined ? {} : { signal: this.deps.signal }) });
  }

  private async browserLoginUnlocked(profile: Profile, projectId: string): Promise<OAuthCredential> {
    const pkce = createPkce();
    const signal = AbortSignal.any([AbortSignal.timeout(120_000), ...(this.deps.signal === undefined ? [] : [this.deps.signal])]);
    const callback = await (this.deps.createOAuthCallback ?? createOAuthCallback)({ state: pkce.state, signal });
    try {
      const redirect = new URL(callback.redirectUri);
      if (redirect.protocol !== "http:" || redirect.hostname !== "127.0.0.1" || !redirect.port || redirect.pathname !== "/oauth/callback" || redirect.search || redirect.hash || redirect.username || redirect.password) throw new CliError("OAUTH_CALLBACK_INVALID", "Sign-in requires a local loopback callback");
      const url = new URL(`${profile.baseUrl}/coding-agent/authorize`);
      for (const [key, value] of Object.entries({ projectId, clientName: "Kintsugi CLI", redirectUri: callback.redirectUri, state: pkce.state, codeChallenge: pkce.codeChallenge, codeChallengeMethod: "S256" })) url.searchParams.set(key, value);
      this.deps.stderr.write(`Sign in to Kintsugi in your browser:\n${url.href}\n`);
      try { await awaitWithSignal((this.deps.openBrowser ?? openSystemBrowser)(url.href), signal); }
      catch (error) { if (signal.aborted) throw error; this.deps.stderr.write("Browser could not open automatically. Open the URL above on this machine.\n"); }
      const result = await awaitWithSignal(callback.waitForCode(), signal);
      if (!result.code || !sameState(result.state, pkce.state)) throw new CliError("OAUTH_CALLBACK_INVALID", "The sign-in callback was invalid; start sign-in again");
      const response = await this.request(profile, "token", { grantType: "authorization_code", code: result.code, codeVerifier: pkce.codeVerifier, redirectUri: callback.redirectUri }, signal);
      return await this.accept(profile, response);
    } finally { await callback.close(); }
  }

  accessTokenFor(profile: Profile): Promise<string> {
    const running = this.flights.get(profile.id);
    if (running !== undefined) return running;
    const flight = this.resolveAccess(profile).finally(() => this.flights.delete(profile.id));
    this.flights.set(profile.id, flight);
    return flight;
  }

  private async resolveAccess(profile: Profile): Promise<string> {
    // Reading a PAT or a still-valid access token cannot consume a rotating secret.
    // Avoid serializing ordinary reads (and independent watch lifetimes) unnecessarily.
    const raw = await this.deps.credentials.get(profile.id);
    const cached = this.cachedAccess(profile, raw);
    if (cached !== undefined) return cached;
    return await withCredentialLock(profile.id, () => this.resolveAccessUnlocked(profile), { ...(this.deps.signal === undefined ? {} : { signal: this.deps.signal }) });
  }

  private cachedAccess(profile: Profile, raw: string | undefined): string | undefined {
    if (this.unusable.has(profile.id)) throw reauthenticate();
    if (!raw) { this.access.delete(profile.id); throw new CliError("CREDENTIAL_REQUIRED", "No credential is stored for this profile; run auth login", 401); }
    const credential = parseOAuthCredential(raw);
    // Pre-existing raw PATs (including older installations' opaque tokens) never refresh.
    if (credential === undefined) return raw;
    if (credential.baseUrl !== profile.baseUrl) throw new CliError("PROFILE_INSTALLATION_MISMATCH", "The credential belongs to another Kintsugi installation");
    const current = this.access.get(profile.id);
    return current?.credential === raw && current.expiresAt - this.now() > 30_000 ? current.token : undefined;
  }

  private async resolveAccessUnlocked(profile: Profile): Promise<string> {
    const raw = await this.deps.credentials.get(profile.id);
    const cached = this.cachedAccess(profile, raw);
    if (cached !== undefined) return cached;
    const credential = parseOAuthCredential(raw!)!;
    if (credential.refreshPending) {
      this.access.delete(profile.id);
      this.unusable.add(profile.id);
      await this.request(profile, "revoke", { refreshToken: credential.refreshToken }, AbortSignal.timeout(5000)).catch(() => undefined);
      await this.deps.credentials.delete(profile.id).catch(() => undefined);
      throw reauthenticate();
    }
    this.access.delete(profile.id);
    try { await this.deps.credentials.set(profile.id, JSON.stringify({ ...credential, refreshPending: true })); }
    catch {
      this.unusable.add(profile.id);
      await this.deps.credentials.delete(profile.id).catch(() => undefined);
      throw reauthenticate();
    }
    const response = await this.request(profile, "token", { grantType: "refresh_token", refreshToken: credential.refreshToken }, this.deps.signal);
    if (!response.ok) {
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        this.unusable.add(profile.id);
        await this.deps.credentials.delete(profile.id).catch(() => undefined);
      }
      throw reauthenticate();
    }
    await this.accept(profile, response);
    return this.access.get(profile.id)!.token;
  }

  async logout(profile: Profile): Promise<boolean> {
    return await withCredentialLock(profile.id, () => this.logoutUnlocked(profile), { ...(this.deps.signal === undefined ? {} : { signal: this.deps.signal }) });
  }

  private async logoutUnlocked(profile: Profile): Promise<boolean> {
    const raw = await this.deps.credentials.get(profile.id);
    const credential = raw === undefined ? undefined : parseOAuthCredential(raw);
    if (credential !== undefined) {
      if (credential.baseUrl !== profile.baseUrl) throw new CliError("PROFILE_INSTALLATION_MISMATCH", "The credential belongs to another Kintsugi installation");
      const response = await this.request(profile, "revoke", { refreshToken: credential.refreshToken }, this.deps.signal);
      if (!response.ok) throw new CliError("OAUTH_REVOCATION_FAILED", "Could not revoke the connection; local credential retained. Revoke it in Kintsugi and retry");
    }
    await this.deps.credentials.delete(profile.id);
    this.access.delete(profile.id);
    this.unusable.delete(profile.id);
    return raw !== undefined && credential === undefined;
  }
}

const sessions = new WeakMap<CliDeps, OAuthSession>();
export function oauthFor(deps: CliDeps): OAuthSession {
  let session = sessions.get(deps);
  if (session === undefined) { session = new OAuthSession(deps); sessions.set(deps, session); }
  return session;
}
