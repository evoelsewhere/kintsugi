export type InstallHarness = "claude-code" | "codex";
export type InstallShell = "powershell" | "posix";
export type PluginInstallMode = "native-cli" | "desktop-ui";

export interface PluginInstallCommandInput {
  baseUrl: string;
  projectId: string;
  harness: InstallHarness;
  installMode?: PluginInstallMode;
  profileId?: string;
  shell: InstallShell;
}

export interface CodingAgentAuthorizationRequest {
  projectId: string;
  clientName: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  expiresAt?: number;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true;
  }
  return false;
}

function canonicalBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Kintsugi did not provide a valid installation URL."); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash) {
    throw new Error("Kintsugi installation URL must use HTTPS, except for local loopback, and cannot contain credentials, a query, or a fragment.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function quote(value: string, shell: InstallShell): string {
  return shell === "powershell"
    ? `'${value.replace(/'/g, "''")}'`
    : `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildPluginInstallCommand(input: PluginInstallCommandInput): string {
  const baseUrl = canonicalBaseUrl(input.baseUrl);
  if (input.harness !== "claude-code" && input.harness !== "codex") throw new Error("Choose a supported AI client.");
  const installMode = input.installMode ?? "native-cli";
  if (installMode !== "native-cli" && installMode !== "desktop-ui") throw new Error("Choose a supported install mode.");
  if (installMode === "desktop-ui" && input.harness !== "codex") throw new Error("The desktop UI install is currently available for Codex Desktop.");
  if (input.shell !== "powershell" && input.shell !== "posix") throw new Error("Choose a supported terminal shell.");
  if (input.projectId.trim() !== input.projectId || input.projectId.length < 1 || input.projectId.length > 200 || hasControlCharacters(input.projectId)) {
    throw new Error("Kintsugi project ID is invalid.");
  }
  if (input.profileId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(input.profileId)) {
    throw new Error("Kintsugi profile ID is invalid.");
  }
  const parts = [
    "kintsugi plugins setup",
    ...(installMode === "desktop-ui" ? ["--install-mode", "desktop-ui"] : []),
    "--harness", input.harness,
    "--url", quote(baseUrl, input.shell),
    "--project", quote(input.projectId, input.shell),
  ];
  if (input.profileId !== undefined) parts.push("--profile", quote(input.profileId, input.shell));
  return parts.join(" ");
}

export function parseCodingAgentAuthorizationRequest(search: string): CodingAgentAuthorizationRequest | undefined {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const keys = ["projectId", "clientName", "redirectUri", "state", "codeChallenge", "codeChallengeMethod"];
  const allowed = [...keys, "expiresAt"];
  if (params.size < keys.length || params.size > keys.length + 1 || [...params.keys()].some((key) => !allowed.includes(key))
    || keys.some((key) => params.getAll(key).length !== 1) || params.getAll("expiresAt").length > 1) return undefined;
  const projectId = params.get("projectId");
  const clientName = params.get("clientName");
  const redirectUri = params.get("redirectUri");
  const state = params.get("state");
  const codeChallenge = params.get("codeChallenge");
  const method = params.get("codeChallengeMethod");
  const rawExpiry = params.get("expiresAt");
  const expiresAt = rawExpiry === null ? undefined : Number(rawExpiry);
  if (projectId === null || projectId.trim() !== projectId || projectId.length === 0 || projectId.length > 200 || hasControlCharacters(projectId)
    || clientName === null || clientName.trim() !== clientName || clientName.length === 0 || clientName.length > 80 || hasControlCharacters(clientName)
    || state === null || !/^[A-Za-z0-9_-]{43}$/.test(state)
    || codeChallenge === null || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)
    || method !== "S256" || redirectUri === null
    || (rawExpiry !== null && (!/^\d{13}$/.test(rawExpiry) || !Number.isSafeInteger(expiresAt) || expiresAt! - Date.now() > 125_000))) return undefined;
  let redirect: URL;
  try { redirect = new URL(redirectUri); } catch { return undefined; }
  const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(redirect.hostname.toLowerCase());
  if (redirect.protocol !== "http:" || !loopback || !redirect.port || redirect.username || redirect.password || redirect.pathname !== "/oauth/callback" || redirect.search || redirect.hash) return undefined;
  return { projectId, clientName, redirectUri: redirect.toString(), state, codeChallenge, codeChallengeMethod: "S256", ...(expiresAt === undefined ? {} : { expiresAt }) };
}

export function codingAgentAuthorizationPayload(request: CodingAgentAuthorizationRequest): Omit<CodingAgentAuthorizationRequest, "expiresAt"> {
  return {
    projectId: request.projectId,
    clientName: request.clientName,
    redirectUri: request.redirectUri,
    state: request.state,
    codeChallenge: request.codeChallenge,
    codeChallengeMethod: request.codeChallengeMethod,
  };
}

export function safeCodingAgentReturnTo(value: string | null): string {
  if (value === null || value.length > 2500 || !value.startsWith("/coding-agent/authorize") || value.startsWith("//") || value.includes("\\") || hasControlCharacters(value)) return "/";
  let url: URL;
  try { url = new URL(value, "https://kintsugi.invalid"); } catch { return "/"; }
  if (url.origin !== "https://kintsugi.invalid" || url.pathname !== "/coding-agent/authorize" || url.hash || parseCodingAgentAuthorizationRequest(url.search) === undefined) return "/";
  return `${url.pathname}${url.search}`;
}

export function validatedAuthorizationRedirect(value: string, request: CodingAgentAuthorizationRequest): string {
  const expected = new URL(request.redirectUri);
  let redirect: URL;
  try { redirect = new URL(value); } catch { throw new Error("Kintsugi returned an invalid sign-in callback."); }
  const code = redirect.searchParams.get("code");
  const state = redirect.searchParams.get("state");
  if (redirect.protocol !== "http:" || redirect.origin !== expected.origin || redirect.pathname !== expected.pathname
    || redirect.username || redirect.password || redirect.hash || redirect.searchParams.size !== 2
    || redirect.searchParams.getAll("code").length !== 1 || redirect.searchParams.getAll("state").length !== 1
    || code === null || !/^knt_ac_[A-Za-z0-9_-]{43}$/.test(code) || state !== request.state) {
    throw new Error("Kintsugi returned an invalid sign-in callback.");
  }
  return redirect.toString();
}
