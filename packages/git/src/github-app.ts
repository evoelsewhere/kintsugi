import { createHash, createPrivateKey, createSign } from "node:crypto";

/** API version is intentionally pinned for GitHub Enterprise Server compatibility. */
export const GITHUB_REST_API_VERSION = "2022-11-28";

export type GitHubAppPurpose = "pull-requests-read" | "checks-read";
export type GitHubPermission = "pull_requests" | "checks";

export interface GitHubRepositoryConnection {
  kind: "github" | "github-enterprise";
  /** Registered GitHub web base URL (`https://github.com` or a GHES origin). */
  baseUrl: string;
  /** A single repository in `owner/name` form. */
  repositoryPath: string;
  /** Merge queues are not reconciled by the initial Coding Agent Workflow pilot. */
  mergeQueueEnabled?: boolean;
}

export interface GitHubAppConnection extends GitHubRepositoryConnection {
  appId: string;
  installationId: string;
  /** PEM private key, decrypted only inside the server-side credential adapter. */
  privateKey: string;
}

export interface GitHubTokenConnection extends GitHubRepositoryConnection {
  /** Existing server-side GitHub PAT; API capability is determined by live read probes. */
  token: string;
}

export type GitHubObservationConnection = GitHubAppConnection | GitHubTokenConnection;

export interface GitHubProviderCredential {
  readonly token: string;
  readonly repositoryPath: string;
  readonly permissions: Readonly<Partial<Record<GitHubPermission, "read">>>;
  readonly expiresAt?: string;
}

export interface GitHubCredentialResolver {
  resolve(connection: GitHubObservationConnection, purpose: GitHubAppPurpose): Promise<GitHubProviderCredential>;
}

export class GitHubAppError extends Error {
  constructor(readonly code: string, message: string, readonly retryAfterMs?: number) {
    super(message);
    this.name = "GitHubAppError";
  }
}

export interface GitHubApiTarget {
  apiBase: string;
  origin: string;
  owner: string;
  repository: string;
}

const permissionSets: Record<GitHubAppPurpose, Readonly<Partial<Record<GitHubPermission, "read">>>> = {
  "pull-requests-read": { pull_requests: "read" },
  "checks-read": { checks: "read" },
};

const MAX_CACHED_INSTALLATION_TOKENS = 256;

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export function githubApiTarget(connection: GitHubRepositoryConnection): GitHubApiTarget {
  const base = githubHostUrl(connection.kind, connection.baseUrl);
  const hostname = base.hostname.toLowerCase();
  const isPublic = hostname === "github.com";
  const parts = connection.repositoryPath.split("/");
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part) || part === "." || part === "..")) {
    throw new GitHubAppError("GITHUB_REPOSITORY_INVALID", "The GitHub repository must use owner/name form");
  }
  const apiBase = isPublic ? "https://api.github.com" : `${base.origin}/api/v3`;
  return { apiBase, origin: new URL(apiBase).origin, owner: parts[0]!, repository: parts[1]! };
}

function githubHostUrl(kind: GitHubAppConnection["kind"], baseUrl: string): URL {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new GitHubAppError("GITHUB_HOST_INVALID", "The registered GitHub host URL is invalid");
  }
  if (
    base.protocol !== "https:" ||
    base.username !== "" ||
    base.password !== "" ||
    base.search !== "" ||
    base.hash !== "" ||
    (base.pathname !== "/" && base.pathname !== "")
  ) {
    throw new GitHubAppError("GITHUB_HOST_INVALID", "GitHub App credentials require a plain HTTPS host origin");
  }
  const hostname = base.hostname.toLowerCase();
  const isPublic = hostname === "github.com";
  if ((kind === "github" && !isPublic) || (kind === "github-enterprise" && isPublic)) {
    throw new GitHubAppError("GITHUB_HOST_INVALID", "The registered GitHub host does not match its server kind");
  }
  return base;
}

/** Derives the GitHub REST path from a registered HTTPS, SSH, or scp-like clone URL. */
export function githubRepositoryPathFromRemote(remoteUrl: string, kind: GitHubRepositoryConnection["kind"], baseUrl: string): string {
  const base = githubHostUrl(kind, baseUrl);
  let host: string;
  let path: string;
  try {
    const remote = new URL(remoteUrl);
    if (remote.protocol !== "https:" && remote.protocol !== "ssh:") {
      throw new GitHubAppError("GITHUB_REPOSITORY_INVALID", "GitHub repositories must use HTTPS or SSH clone URLs");
    }
    if (remote.password !== "" || remote.search !== "" || remote.hash !== "") {
      throw new GitHubAppError("GITHUB_REPOSITORY_INVALID", "GitHub clone URL must not contain credentials, query or fragment data");
    }
    if (remote.protocol === "https:" && remote.username !== "") {
      throw new GitHubAppError("GITHUB_REPOSITORY_INVALID", "GitHub HTTPS clone URL must not contain credentials");
    }
    if (remote.protocol === "https:" && remote.port !== base.port) {
      throw new GitHubAppError("GITHUB_REPOSITORY_HOST_MISMATCH", "GitHub clone URL does not use the registered server port");
    }
    host = remote.hostname.toLowerCase();
    path = remote.pathname.replace(/^\/+/, "");
  } catch (error) {
    if (error instanceof GitHubAppError) throw error;
    const scp = /^(?:[^@/:]+@)?([^:/]+):(.+)$/.exec(remoteUrl);
    if (scp === null) throw new GitHubAppError("GITHUB_REPOSITORY_INVALID", "GitHub repository URL is not a supported clone URL");
    host = scp[1]!.toLowerCase();
    path = scp[2]!;
  }
  if (host !== base.hostname.toLowerCase()) {
    throw new GitHubAppError("GITHUB_REPOSITORY_HOST_MISMATCH", "GitHub repository host does not match the registered server");
  }
  const parts = path.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length === 2) parts[1] = parts[1]!.replace(/\.git$/i, "");
  let decoded: string[];
  try {
    decoded = parts.map((part) => decodeURIComponent(part));
  } catch {
    throw new GitHubAppError("GITHUB_REPOSITORY_INVALID", "GitHub repository path contains invalid URL encoding");
  }
  if (decoded.length !== 2 || decoded.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part) || part === "." || part === "..")) {
    throw new GitHubAppError("GITHUB_REPOSITORY_INVALID", "GitHub repository URL must identify exactly one owner and repository");
  }
  return `${decoded[0]}/${decoded[1]}`;
}

function signedAppJwt(appId: string, privateKey: string, now: Date): string {
  let key: ReturnType<typeof createPrivateKey>;
  try {
    key = createPrivateKey(privateKey);
  } catch {
    throw new GitHubAppError("GITHUB_APP_KEY_INVALID", "The configured GitHub App private key is invalid");
  }
  if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
    throw new GitHubAppError("GITHUB_APP_KEY_INVALID", "The configured GitHub App key must be RSA with at least 2048 bits");
  }
  const issuedAt = Math.floor(now.getTime() / 1000) - 60;
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ iss: appId, iat: issuedAt, exp: issuedAt + 600 })).toString("base64url");
  const unsigned = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(key, "base64url")}`;
}

function cacheKey(connection: GitHubAppConnection, purpose: GitHubAppPurpose, target: GitHubApiTarget): string {
  const keyDigest = createHash("sha256").update(connection.privateKey).digest("hex");
  return [target.origin, connection.appId, connection.installationId, connection.repositoryPath.toLowerCase(), purpose, keyDigest].join("\0");
}

/**
 * Mints narrowly scoped GitHub App installation tokens for read-only provider observation.
 * Private keys and JWTs are kept inside this adapter and are never included in errors.
 */
export class GitHubInstallationCredentialProvider {
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  readonly #cache = new Map<string, GitHubProviderCredential>();
  readonly #inFlight = new Map<string, Promise<GitHubProviderCredential>>();

  constructor(options: { fetch?: typeof fetch; now?: () => Date } = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? (() => new Date());
  }

  async resolve(connection: GitHubAppConnection, purpose: GitHubAppPurpose): Promise<GitHubProviderCredential> {
    if (connection.mergeQueueEnabled === true) {
      throw new GitHubAppError("GITHUB_MERGE_QUEUE_UNSUPPORTED", "The Coding Agent Workflow pilot does not support merge queues");
    }
    const target = githubApiTarget(connection);
    if (!/^\d+$/.test(connection.appId) || !/^\d+$/.test(connection.installationId)) {
      throw new GitHubAppError("GITHUB_APP_CONFIG_INVALID", "GitHub App and installation IDs must be numeric");
    }
    const key = cacheKey(connection, purpose, target);
    const refreshBefore = this.#now().getTime() + 120_000;
    for (const [cachedKey, credential] of this.#cache) {
      if (credential.expiresAt === undefined || Date.parse(credential.expiresAt) <= refreshBefore) this.#cache.delete(cachedKey);
    }
    const cached = this.#cache.get(key);
    if (cached !== undefined) {
      this.#cache.delete(key);
      this.#cache.set(key, cached);
      return cached;
    }
    const current = this.#inFlight.get(key);
    if (current !== undefined) return current;
    const pending = this.#mint(connection, purpose, target);
    this.#inFlight.set(key, pending);
    try {
      const credential = await pending;
      this.#cache.set(key, credential);
      while (this.#cache.size > MAX_CACHED_INSTALLATION_TOKENS) {
        const oldest = this.#cache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.#cache.delete(oldest);
      }
      return credential;
    } finally {
      this.#inFlight.delete(key);
    }
  }

  async #mint(connection: GitHubAppConnection, purpose: GitHubAppPurpose, target: GitHubApiTarget): Promise<GitHubProviderCredential> {
    const url = `${target.apiBase}/app/installations/${encodeURIComponent(connection.installationId)}/access_tokens`;
    const authorization = `Bearer ${signedAppJwt(connection.appId, connection.privateKey, this.#now())}`;
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          accept: "application/vnd.github+json",
          authorization,
          "content-type": "application/json",
          "x-github-api-version": GITHUB_REST_API_VERSION,
        },
        body: JSON.stringify({
          repositories: [connection.repositoryPath],
          permissions: permissionSets[purpose],
        }),
      });
    } catch {
      throw new GitHubAppError("GITHUB_TOKEN_REQUEST_FAILED", "GitHub App token request failed before a response was received");
    }

    let finalUrl: URL;
    try {
      finalUrl = new URL(response.url);
    } catch {
      throw new GitHubAppError("GITHUB_RESPONSE_HOST_INVALID", "GitHub returned a response without a verifiable API URL");
    }
    const requestUrl = new URL(url);
    if (finalUrl.origin !== target.origin || finalUrl.pathname !== requestUrl.pathname) {
      throw new GitHubAppError("GITHUB_REDIRECT_REJECTED", "GitHub token endpoint redirected outside the registered API route");
    }
    if (response.status !== 201) {
      throw new GitHubAppError(`GITHUB_HTTP_${response.status}`, `GitHub App token request failed (HTTP ${response.status})`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new GitHubAppError("GITHUB_RESPONSE_INVALID", "GitHub returned an invalid installation token response");
    }
    const value = record(body);
    const token = value["token"];
    const expiresAt = value["expires_at"];
    const rawPermissions = record(value["permissions"]);
    const repositories = value["repositories"];
    const requested = permissionSets[purpose];
    const grantedNames = Object.keys(rawPermissions).sort();
    const requestedNames = Object.keys(requested).sort();
    const leastPrivilege =
      grantedNames.length === requestedNames.length &&
      grantedNames.every((permission, index) => permission === requestedNames[index] && rawPermissions[permission] === "read");
    const expiry = typeof expiresAt === "string" ? Date.parse(expiresAt) : Number.NaN;
    if (!leastPrivilege) throw new GitHubAppError("GITHUB_PERMISSION_UNAVAILABLE", "The GitHub App installation does not grant the requested read permissions");
    const returnedRepositoryNames = Array.isArray(repositories)
      ? repositories.map((repository) => record(repository)["full_name"])
      : [];
    if (
      returnedRepositoryNames.length !== 1 ||
      typeof returnedRepositoryNames[0] !== "string" ||
      returnedRepositoryNames[0].toLowerCase() !== connection.repositoryPath.toLowerCase()
    ) {
      throw new GitHubAppError("GITHUB_TOKEN_SCOPE_INVALID", "GitHub returned an installation token scoped to a different repository set");
    }
    if (typeof token !== "string" || token.length === 0 || !Number.isFinite(expiry) || expiry <= this.#now().getTime() + 120_000) {
      throw new GitHubAppError("GITHUB_TOKEN_RESPONSE_INVALID", "GitHub returned a token with invalid scope or expiry");
    }
    const permissions = Object.fromEntries(requestedNames.map((name) => [name, "read" as const])) as Record<GitHubPermission, "read">;
    return Object.freeze({ token, repositoryPath: connection.repositoryPath, permissions: Object.freeze(permissions), expiresAt: new Date(expiry).toISOString() });
  }
}

/** Resolves installation App tokens or forwards a legacy server PAT without claiming its scopes. */
export class GitHubProviderCredentialProvider implements GitHubCredentialResolver {
  readonly #apps: GitHubInstallationCredentialProvider;

  constructor(options: { apps?: GitHubInstallationCredentialProvider } = {}) {
    this.#apps = options.apps ?? new GitHubInstallationCredentialProvider();
  }

  resolve(connection: GitHubObservationConnection, purpose: GitHubAppPurpose): Promise<GitHubProviderCredential> {
    if ("token" in connection) {
      return Promise.resolve({ token: connection.token, repositoryPath: connection.repositoryPath, permissions: {} });
    }
    return this.#apps.resolve(connection, purpose);
  }
}
