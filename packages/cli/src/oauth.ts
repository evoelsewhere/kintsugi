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

const OAUTH_LOGIN_TIMEOUT_MS = 120_000;

function timeoutMessage(timeoutMs = OAUTH_LOGIN_TIMEOUT_MS): string {
  const count = timeoutMs >= 60_000 ? Math.ceil(timeoutMs / 60_000) : Math.ceil(timeoutMs / 1000);
  const unit = timeoutMs >= 60_000 ? (count === 1 ? "minute" : "minutes") : (count === 1 ? "second" : "seconds");
  const duration = `${count} ${unit}`;
  return `Browser sign-in timed out after ${duration}; return to your coding agent and retry the Kintsugi request, or run kintsugi auth login`;
}

function cancelled(signal?: AbortSignal): CliError {
  return signal?.reason instanceof Error && signal.reason.name === "TimeoutError"
    ? new CliError("OAUTH_TIMEOUT", timeoutMessage())
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

function oauthCallbackPage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Kintsugi sign-in</title>
<style nonce="${nonce}">
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color-scheme:light dark;background:#f7f7f7;color:#171717;font-synthesis:none;text-rendering:optimizeLegibility}
*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;background:#f7f7f7;color:#171717}
main{width:min(100%,460px);padding:24px;border:1px solid #e5e5e5;border-radius:12px;background:#fff;box-shadow:0 8px 28px #0000000a}
.mark{width:40px;height:40px;display:grid;place-items:center;border-radius:9px;background:#f3f4f6;color:#0072f5}.mark svg{width:21px;height:21px}
.eyebrow{margin:20px 0 6px;color:#606060;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
h1{margin:0;font-size:22px;line-height:1.25;letter-spacing:-.02em}p{margin:10px 0 0;color:#555;font-size:14px;line-height:1.55}
.progress{display:flex;align-items:center;gap:9px;margin-top:20px;padding-top:14px;border-top:1px solid #ededed;color:#555;font-size:12px}
.dot{width:8px;height:8px;border-radius:50%;background:#0072f5;animation:pulse 1.2s ease-in-out infinite}.done .dot{background:#16803c;animation:none}.failed .dot{background:#c2362b;animation:none}
.hint{margin-top:16px;color:#777;font-size:12px}
@keyframes pulse{50%{opacity:.35}}
@media(prefers-reduced-motion:reduce){.dot{animation:none}}
@media(prefers-color-scheme:dark){:root,body{background:#101010;color:#f5f5f5}main{border-color:#2a2a2a;background:#171717;box-shadow:none}.mark{background:#222;color:#70aaff}p,.progress{color:#bbb}.eyebrow,.hint{color:#999}.progress{border-color:#2a2a2a}}
</style>
</head>
<body>
<main id="panel" aria-labelledby="title">
  <div class="mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 19 6v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/></svg></div>
  <p class="eyebrow" id="phase">Project access approved</p>
  <h1 id="title">Completing your Kintsugi sign-in</h1>
  <p id="message">Kintsugi is securely saving your connection. Keep this page open for a moment.</p>
  <div class="progress" role="status" aria-live="polite"><span class="dot" aria-hidden="true"></span><span id="detail">Waiting for Kintsugi to finish saving the connection…</span></div>
  <p class="hint" id="hint">Keep this page open while Kintsugi finishes sign-in.</p>
</main>
<script nonce="${nonce}">
history.replaceState(null,"","/oauth/complete");
const panel=document.getElementById("panel"),phase=document.getElementById("phase"),title=document.getElementById("title"),message=document.getElementById("message"),detail=document.getElementById("detail"),hint=document.getElementById("hint");
const started=Date.now();
function show(status){
  if(status==="success"){panel.classList.add("done");phase.textContent="Sign-in complete";title.textContent="Kintsugi connection ready";message.textContent="Your connection has been saved securely. Return to your coding agent and retry your request.";detail.textContent="Your connection is ready.";hint.textContent="You can close this page.";document.title="Kintsugi connection ready";return true}
  if(status==="error"){panel.classList.add("failed");phase.textContent="Sign-in not completed";title.textContent="Kintsugi could not finish sign-in";message.textContent="Check the terminal for details, then ask your coding agent to retry the request.";detail.textContent="Check the terminal for next steps.";hint.textContent="You can close this page and retry from your coding agent.";document.title="Kintsugi sign-in not completed";return true}
  return false
}
async function poll(){
  try{const response=await fetch("/oauth/status",{cache:"no-store"});if(response.ok){const value=await response.json();if(show(value.status))return}}catch{}
  if(Date.now()-started>90000){show("error");return}
  window.setTimeout(poll,500)
}
poll();
</script>
</body>
</html>`;
}

export async function createOAuthCallback(options: { state: string; signal?: AbortSignal; timeoutMs?: number }): Promise<OAuthLoopbackCallback> {
  if (options.signal?.aborted) throw cancelled(options.signal);
  let resolveCode!: (result: { code: string; state: string }) => void;
  let rejectCode!: (error: Error) => void;
  let settled = false;
  let callbackAccepted = false;
  let closed = false;
  let completion: "pending" | "success" | "error" = "pending";
  let acknowledgeFinalStatus!: () => void;
  const finalStatusAcknowledged = new Promise<void>((resolve) => { acknowledgeFinalStatus = resolve; });
  const code = new Promise<{ code: string; state: string }>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  void code.catch(() => undefined);
  const nonce = randomBytes(18).toString("base64url");
  const page = oauthCallbackPage(nonce);
  const server = createServer((request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    const address = server.address();
    if (address === null || typeof address === "string" || request.headers.host !== `127.0.0.1:${address.port}` || !request.url?.startsWith("/") || request.url.startsWith("//")) { response.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("Invalid callback origin"); return; }
    let url: URL;
    try { url = new URL(request.url, "http://127.0.0.1"); }
    catch { response.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("Invalid callback URL"); return; }
    if (request.method !== "GET") { response.writeHead(405, { "content-type": "text/plain; charset=utf-8", allow: "GET" }).end("Method not allowed"); return; }
    if (url.pathname === "/oauth/status" && url.search === "") {
      response.setHeader("content-type", "application/json; charset=utf-8");
      if (completion !== "pending") response.once("finish", acknowledgeFinalStatus);
      response.writeHead(200).end(JSON.stringify({ status: completion }));
      return;
    }
    if (url.pathname === "/oauth/complete" && url.search === "") {
      if (!callbackAccepted) { response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Unknown callback"); return; }
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      }).end(page);
      return;
    }    if (url.pathname !== "/oauth/callback") { response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Unknown callback"); return; }
    if (settled) { response.writeHead(410, { "content-type": "text/plain; charset=utf-8" }).end("Sign-in callback already consumed"); return; }
    const authorizationCode = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!authorizationCode || authorizationCode.length > 200 || !/^[A-Za-z0-9_-]+$/.test(authorizationCode) || url.searchParams.getAll("code").length !== 1 || url.searchParams.getAll("state").length !== 1 || state === null || !sameState(state, options.state)) {
      settled = true;
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("Invalid sign-in callback");
      rejectCode(new CliError("OAUTH_CALLBACK_INVALID", "The sign-in callback was invalid; start sign-in again"));
      return;
    }
    settled = true;
    callbackAccepted = true;
    response.writeHead(303, { location: "/oauth/complete", "content-type": "text/plain; charset=utf-8" }).end();
    resolveCode({ code: authorizationCode, state });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", () => reject(new CliError("OAUTH_CALLBACK_UNAVAILABLE", "A local callback listener is required; run sign-in on this machine")));
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new CliError("OAUTH_CALLBACK_UNAVAILABLE", "No local callback address");
  const close = async () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    if (!settled) { settled = true; rejectCode(cancelled()); }
    await new Promise<void>((resolve) => {
      if (!server.listening) { resolve(); return; }
      server.close(() => resolve());
      server.closeAllConnections();
    });
  };
  const complete = async (outcome: "success" | "error") => {
    if (closed || !settled) return;
    completion = outcome;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3000);
      void finalStatusAcknowledged.then(() => { clearTimeout(timer); resolve(); });
    });
  };
  const onAbort = () => { if (!settled) { settled = true; rejectCode(cancelled(options.signal)); } void close(); };
  const timeoutMs = options.timeoutMs ?? OAUTH_LOGIN_TIMEOUT_MS;
  const timer = setTimeout(() => {
    if (!settled) { settled = true; rejectCode(new CliError("OAUTH_TIMEOUT", timeoutMessage(timeoutMs))); }
    void close();
  }, timeoutMs);
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  return { redirectUri: `http://127.0.0.1:${address.port}/oauth/callback`, waitForCode: () => code, complete, close };
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
    const expiresAt = Date.now() + OAUTH_LOGIN_TIMEOUT_MS;
    const signal = AbortSignal.any([AbortSignal.timeout(OAUTH_LOGIN_TIMEOUT_MS), ...(this.deps.signal === undefined ? [] : [this.deps.signal])]);
    const callback = await (this.deps.createOAuthCallback ?? createOAuthCallback)({ state: pkce.state, signal });
    let outcome: "success" | "error" = "error";
    try {
      const redirect = new URL(callback.redirectUri);
      if (redirect.protocol !== "http:" || redirect.hostname !== "127.0.0.1" || !redirect.port || redirect.pathname !== "/oauth/callback" || redirect.search || redirect.hash || redirect.username || redirect.password) throw new CliError("OAUTH_CALLBACK_INVALID", "Sign-in requires a local loopback callback");
      const url = new URL(`${profile.baseUrl}/coding-agent/authorize`);
      for (const [key, value] of Object.entries({ projectId, clientName: "Kintsugi CLI", redirectUri: callback.redirectUri, state: pkce.state, codeChallenge: pkce.codeChallenge, codeChallengeMethod: "S256", expiresAt: String(expiresAt) })) url.searchParams.set(key, value);
      this.deps.stderr.write(`Sign in to Kintsugi in your browser:\n${url.href}\n`);
      try { await awaitWithSignal((this.deps.openBrowser ?? openSystemBrowser)(url.href), signal); }
      catch (error) { if (signal.aborted) throw error; this.deps.stderr.write("Browser could not open automatically. Open the URL above on this machine.\n"); }
      const result = await awaitWithSignal(callback.waitForCode(), signal);
      if (!result.code || !sameState(result.state, pkce.state)) throw new CliError("OAUTH_CALLBACK_INVALID", "The sign-in callback was invalid; start sign-in again");
      const response = await this.request(profile, "token", { grantType: "authorization_code", code: result.code, codeVerifier: pkce.codeVerifier, redirectUri: callback.redirectUri }, signal);
      const credential = await this.accept(profile, response);
      outcome = "success";
      return credential;
    } finally {
      try { await callback.complete?.(outcome); } catch { /* Browser feedback must not change CLI authentication. */ }
      await callback.close();
    }
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
