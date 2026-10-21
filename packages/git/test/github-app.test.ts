import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GitHubInstallationCredentialProvider, GitHubProviderCredentialProvider, githubRepositoryPathFromRemote, type GitHubAppConnection } from "../src/github-app.js";

interface RecordedCall {
  url: string;
  init?: RequestInit;
}

function keyPair(): string {
  return generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

function fakeFetch(responses: Array<{ status: number; body: unknown; url?: string }>): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    const next = responses.shift();
    if (next === undefined) throw new Error(`unexpected request ${url}`);
    const response = new Response(JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json" } });
    Object.defineProperty(response, "url", { value: next.url ?? url });
    return response;
  };
  return { fetch: fetchImpl as typeof fetch, calls };
}

function connection(privateKey = keyPair(), baseUrl = "https://github.com", kind: "github" | "github-enterprise" = "github"): GitHubAppConnection {
  return { kind, baseUrl, appId: "12345", installationId: "67890", privateKey, repositoryPath: "Acme/Billing" };
}

function tokenResponse(token: string, expiresAt = "2026-10-21T10:59:00Z", url?: string, permissions: Record<string, string> = { checks: "read" }) {
  return { status: 201, url, body: { token, expires_at: expiresAt, permissions, repository_selection: "selected", repositories: [{ full_name: "Acme/Billing" }] } };
}

describe("GitHub App installation credentials", () => {
  it("passes a legacy server token through without claiming unprobed permissions", async () => {
    const provider = new GitHubProviderCredentialProvider();
    const credential = await provider.resolve({
      kind: "github",
      baseUrl: "https://github.com",
      repositoryPath: "Acme/Billing",
      token: "TEST-legacy-token",
    }, "checks-read");

    expect(credential).toMatchObject({ token: "TEST-legacy-token", repositoryPath: "Acme/Billing", permissions: {} });
    expect(credential.expiresAt).toBeUndefined();
  });

  it("derives only a single owner/repository path bound to the registered GitHub host", () => {
    expect(githubRepositoryPathFromRemote("https://github.com/Acme/Billing.git", "github", "https://github.com")).toBe("Acme/Billing");
    expect(githubRepositoryPathFromRemote("git@github.com:Acme/Billing.git", "github", "https://github.com")).toBe("Acme/Billing");
    expect(githubRepositoryPathFromRemote("ssh://git@ghe.example.com/Acme/Billing.git", "github-enterprise", "https://ghe.example.com")).toBe("Acme/Billing");
    expect(() => githubRepositoryPathFromRemote("https://github.com.attacker.example/Acme/Billing.git", "github", "https://github.com")).toThrowError(expect.objectContaining({ code: "GITHUB_REPOSITORY_HOST_MISMATCH" }));
    expect(() => githubRepositoryPathFromRemote("https://github.com/Acme/Team/Billing.git", "github", "https://github.com")).toThrowError(expect.objectContaining({ code: "GITHUB_REPOSITORY_INVALID" }));
  });

  it("uses the GitHub.com and GHE API roots, and narrows each token by repo and purpose", async () => {
    const publicFetch = fakeFetch([tokenResponse("TEST-public-token")]);
    const enterpriseFetch = fakeFetch([tokenResponse("TEST-enterprise-token", undefined, undefined, { pull_requests: "read" })]);
    const now = () => new Date("2026-10-21T10:00:00Z");
    const publicProvider = new GitHubInstallationCredentialProvider({ fetch: publicFetch.fetch, now });
    const enterpriseProvider = new GitHubInstallationCredentialProvider({ fetch: enterpriseFetch.fetch, now });

    const publicCredential = await publicProvider.resolve(connection(), "checks-read");
    const enterpriseCredential = await enterpriseProvider.resolve(connection(keyPair(), "https://ghe.example.com", "github-enterprise"), "pull-requests-read");

    expect(publicCredential).toMatchObject({ token: "TEST-public-token", permissions: { checks: "read" }, repositoryPath: "Acme/Billing" });
    expect(enterpriseCredential).toMatchObject({ token: "TEST-enterprise-token", permissions: { pull_requests: "read" } });
    expect(publicFetch.calls[0]?.url).toBe("https://api.github.com/app/installations/67890/access_tokens");
    expect(enterpriseFetch.calls[0]?.url).toBe("https://ghe.example.com/api/v3/app/installations/67890/access_tokens");
    expect(publicFetch.calls[0]?.init?.redirect).toBe("error");
    expect(publicFetch.calls[0]?.init?.body).toBeDefined();
    expect(JSON.parse(String(publicFetch.calls[0]?.init?.body))).toMatchObject({
      repositories: ["Acme/Billing"],
      permissions: { checks: "read" },
    });
    expect(JSON.parse(String(enterpriseFetch.calls[0]?.init?.body))).toMatchObject({
      repositories: ["Acme/Billing"],
      permissions: { pull_requests: "read" },
    });
    const jwt = String((publicFetch.calls[0]?.init?.headers as Record<string, string>).authorization).replace("Bearer ", "");
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString("utf8")) as { iss: string; iat: number; exp: number };
    expect(claims.iss).toBe("12345");
    expect(claims.iat).toBeLessThanOrEqual(Date.parse("2026-10-21T10:00:00Z") / 1000 - 60);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
  });

  it("reuses a live token but refreshes before its one-hour expiry", async () => {
    let current = new Date("2026-10-21T10:00:00Z");
    const mock = fakeFetch([
      tokenResponse("TEST-first-token", "2026-10-21T11:00:00Z"),
      tokenResponse("TEST-refreshed-token", "2026-10-21T11:58:00Z"),
    ]);
    const provider = new GitHubInstallationCredentialProvider({ fetch: mock.fetch, now: () => current });
    const app = connection();

    const first = await provider.resolve(app, "checks-read");
    const cached = await provider.resolve(app, "checks-read");
    current = new Date("2026-10-21T10:59:00Z");
    const refreshed = await provider.resolve(app, "checks-read");

    expect(first.token).toBe("TEST-first-token");
    expect(cached.token).toBe(first.token);
    expect(refreshed.token).toBe("TEST-refreshed-token");
    expect(mock.calls).toHaveLength(2);
  });

  it("deduplicates concurrent installation-token requests", async () => {
    const mock = fakeFetch([tokenResponse("TEST-shared-token")]);
    const provider = new GitHubInstallationCredentialProvider({ fetch: mock.fetch });
    const app = connection();

    const [first, second] = await Promise.all([
      provider.resolve(app, "checks-read"),
      provider.resolve(app, "checks-read"),
    ]);

    expect(first.token).toBe(second.token);
    expect(mock.calls).toHaveLength(1);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.permissions)).toBe(true);
  });

  it("rejects a token response that is not scoped to exactly the requested repository", async () => {
    const mock = fakeFetch([{
      ...tokenResponse("TEST-token"),
      body: {
        ...tokenResponse("TEST-token").body,
        repositories: [{ full_name: "Acme/Other" }],
      },
    }]);
    const provider = new GitHubInstallationCredentialProvider({ fetch: mock.fetch });

    await expect(provider.resolve(connection(), "checks-read")).rejects.toMatchObject({ code: "GITHUB_TOKEN_SCOPE_INVALID" });
  });

  it("rejects weak RSA App keys before making a provider request", async () => {
    const weakKey = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const mock = fakeFetch([]);
    const provider = new GitHubInstallationCredentialProvider({ fetch: mock.fetch });

    await expect(provider.resolve(connection(weakKey), "checks-read")).rejects.toMatchObject({ code: "GITHUB_APP_KEY_INVALID" });
    expect(mock.calls).toHaveLength(0);
  });

  it("rejects a public-host mismatch and refuses redirected token endpoints", async () => {
    const mock = fakeFetch([tokenResponse("TEST-token", undefined, "https://attacker.example/token")]);
    const provider = new GitHubInstallationCredentialProvider({ fetch: mock.fetch });

    await expect(provider.resolve(connection(keyPair(), "https://attacker.example", "github"), "checks-read")).rejects.toMatchObject({ code: "GITHUB_HOST_INVALID" });
    await expect(provider.resolve(connection(), "checks-read")).rejects.toMatchObject({ code: "GITHUB_REDIRECT_REJECTED" });
    expect(mock.calls).toHaveLength(1);
  });

  it("redacts the App key and bearer JWT from provider error messages", async () => {
    const privateKey = keyPair();
    const mock = fakeFetch([{ status: 422, body: { message: `TEST-provider-error ${privateKey}` } }]);
    const provider = new GitHubInstallationCredentialProvider({ fetch: mock.fetch });
    const error = await provider.resolve(connection(privateKey), "checks-read").catch((caught: unknown) => caught);
    const message = error instanceof Error ? error.message : String(error);

    expect(message).toContain("HTTP 422");
    expect(message).not.toContain(privateKey);
    expect(message).not.toContain("TEST-provider-error");
    expect(message).not.toContain(String((mock.calls[0]?.init?.headers as Record<string, string>).authorization));
  });
});
