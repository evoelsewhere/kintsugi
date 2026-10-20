// Pull-request adapters against a mocked fetch: URLs derived from the server base URL,
// authentication headers, reuse of an existing pull request, and redacted errors.

import { describe, expect, it } from "vitest";
import { GitError, isLoopbackUrl, type OpenPullRequest, PullRequestsUnsupportedError, pullRequestProvider } from "../src/index.js";

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch that answers queued responses in order and records each request. */
function mockFetch(...responses: Array<{ status: number; json: unknown }>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({
      method: init?.method ?? "GET",
      url: String(url),
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [key.toLowerCase(), value])),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const next = responses.shift();
    if (next === undefined) throw new Error(`unexpected request ${String(url)}`);
    return new Response(JSON.stringify(next.json), { status: next.status, headers: { "content-type": "application/json" } });
  };
  return { fetch: impl as typeof fetch, calls };
}

const token = "TEST-pr-token-0123456789";
const input = (baseUrl: string, path: string): OpenPullRequest => ({
  baseUrl,
  path,
  token,
  sourceBranch: "kintsugi/alice/w-1",
  targetBranch: "main",
  title: "Publish kintsugi.yaml",
  body: "Rendered by Kintsugi.",
});

describe("GitHub", () => {
  it("opens a pull request on api.github.com", async () => {
    const mock = mockFetch({ status: 201, json: { html_url: "https://github.com/org/docs/pull/7", number: 7 } });
    const pr = await pullRequestProvider("github", mock.fetch)!.open(input("https://github.com", "org/docs"));
    expect(pr).toEqual({ url: "https://github.com/org/docs/pull/7", number: 7, created: true });
    expect(mock.calls[0]).toMatchObject({
      method: "POST",
      url: "https://api.github.com/repos/org/docs/pulls",
      headers: { authorization: `Bearer ${token}` },
      body: { head: "kintsugi/alice/w-1", base: "main", title: "Publish kintsugi.yaml" },
    });
  });

  it("uses /api/v3 on GitHub Enterprise and reuses an open pull request", async () => {
    const mock = mockFetch({ status: 422, json: { message: "A pull request already exists" } }, { status: 200, json: [{ html_url: "https://ghe.example.com/org/docs/pull/3", number: 3 }] });
    const pr = await pullRequestProvider("github-enterprise", mock.fetch)!.open(input("https://ghe.example.com/", "org/docs"));
    expect(pr).toEqual({ url: "https://ghe.example.com/org/docs/pull/3", number: 3, created: false });
    expect(mock.calls.map((call) => call.url)).toEqual([
      "https://ghe.example.com/api/v3/repos/org/docs/pulls",
      "https://ghe.example.com/api/v3/repos/org/docs/pulls?head=org%3Akintsugi%2Falice%2Fw-1&base=main&state=open",
    ]);
  });

  it("reports refusals without the token", async () => {
    const mock = mockFetch({ status: 401, json: { message: `bad credentials ${token}` } });
    const error = await pullRequestProvider("github", mock.fetch)!.open(input("https://github.com", "org/docs")).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GitError);
    expect((error as Error).message).toMatch(/HTTP 401/);
    expect((error as Error).message).not.toContain(token);
  });

  it("never sends a token over plain http", async () => {
    const mock = mockFetch();
    await expect(pullRequestProvider("github-enterprise", mock.fetch)!.open(input("http://ghe.example.com", "org/docs"))).rejects.toThrow(/https/);
    expect(mock.calls).toHaveLength(0);
  });

  it("calls a server on this machine over plain http (a local test server)", async () => {
    const mock = mockFetch({ status: 201, json: { html_url: "http://localhost:3300/org/docs/pulls/1", number: 1 } });
    expect(await pullRequestProvider("gitea", mock.fetch)!.open(input("http://localhost:3300", "org/docs"))).toMatchObject({ number: 1 });
    expect(isLoopbackUrl("http://127.0.0.1:8080/x")).toBe(true);
    expect(isLoopbackUrl("http://localhost.example.com/x")).toBe(false);
    expect(isLoopbackUrl("http://10.0.0.5/x")).toBe(false);
  });
});

describe("GitLab", () => {
  it("opens a merge request with the URL-encoded project path", async () => {
    const mock = mockFetch({ status: 201, json: { web_url: "https://gitlab.example.com/team/sub/docs/-/merge_requests/5", iid: 5 } });
    const pr = await pullRequestProvider("gitlab", mock.fetch)!.open(input("https://gitlab.example.com", "team/sub/docs"));
    expect(pr).toEqual({ url: "https://gitlab.example.com/team/sub/docs/-/merge_requests/5", number: 5, created: true });
    expect(mock.calls[0]).toMatchObject({
      url: "https://gitlab.example.com/api/v4/projects/team%2Fsub%2Fdocs/merge_requests",
      headers: { "private-token": token },
      body: { source_branch: "kintsugi/alice/w-1", target_branch: "main", remove_source_branch: true },
    });
  });

  it("reuses an open merge request on 409", async () => {
    const mock = mockFetch({ status: 409, json: { message: ["Another open merge request already exists"] } }, { status: 200, json: [{ web_url: "https://gitlab.example.com/x/-/merge_requests/2", iid: 2 }] });
    expect(await pullRequestProvider("gitlab", mock.fetch)!.open(input("https://gitlab.example.com", "team/docs"))).toMatchObject({ number: 2, created: false });
  });
});

describe("other servers", () => {
  it("Gitea opens a pull request under /api/v1", async () => {
    const mock = mockFetch({ status: 201, json: { html_url: "https://gitea.example.com/org/docs/pulls/4", number: 4 } });
    expect(await pullRequestProvider("gitea", mock.fetch)!.open(input("https://gitea.example.com", "org/docs"))).toMatchObject({ number: 4 });
    expect(mock.calls[0]).toMatchObject({ url: "https://gitea.example.com/api/v1/repos/org/docs/pulls", headers: { authorization: `token ${token}` } });
  });

  it("Azure DevOps opens a pull request in the project of the repository path", async () => {
    const mock = mockFetch({ status: 201, json: { pullRequestId: 12 } });
    const pr = await pullRequestProvider("azure-devops", mock.fetch)!.open(input("https://dev.azure.com/acme", "Billing/_git/docs"));
    expect(pr).toEqual({ url: "https://dev.azure.com/acme/Billing/_git/docs/pullrequest/12", number: 12, created: true });
    expect(mock.calls[0]).toMatchObject({
      url: "https://dev.azure.com/acme/Billing/_apis/git/repositories/docs/pullrequests?api-version=7.1",
      body: { sourceRefName: "refs/heads/kintsugi/alice/w-1", targetRefName: "refs/heads/main" },
    });
    expect(mock.calls[0]!.headers["authorization"]).toBe(`Basic ${Buffer.from(`:${token}`).toString("base64")}`);
  });

  it("plain-git has no pull requests and Bitbucket is not supported yet", async () => {
    expect(pullRequestProvider("plain-git")).toBeUndefined();
    await expect(pullRequestProvider("bitbucket")!.open(input("https://bitbucket.org", "org/docs"))).rejects.toBeInstanceOf(PullRequestsUnsupportedError);
  });
});

describe("pull request state", () => {
  const query = (baseUrl: string, path: string, url: string) => ({ baseUrl, path, token, url });

  it("GitHub: merged_at means merged (squash merges included), closed without it means closed", async () => {
    const mock = mockFetch({ status: 200, json: { state: "closed", merged_at: "2026-10-20T10:00:00Z" } }, { status: 200, json: { state: "closed", merged_at: null } }, { status: 200, json: { state: "open", merged_at: null } });
    const provider = pullRequestProvider("github", mock.fetch)!;
    const url = "https://github.com/org/docs/pull/12";
    expect(await provider.state(query("https://github.com", "org/docs", url))).toBe("merged");
    expect(await provider.state(query("https://github.com", "org/docs", url))).toBe("closed");
    expect(await provider.state(query("https://github.com", "org/docs", url))).toBe("open");
    expect(mock.calls[0]).toMatchObject({ method: "GET", url: "https://api.github.com/repos/org/docs/pulls/12" });
    expect(mock.calls[0]?.headers["authorization"]).toBe(`Bearer ${token}`);
  });

  it("GitLab: merged, closed and opened merge requests", async () => {
    const mock = mockFetch({ status: 200, json: { state: "merged" } }, { status: 200, json: { state: "closed" } }, { status: 200, json: { state: "opened" } });
    const provider = pullRequestProvider("gitlab", mock.fetch)!;
    const url = "https://gitlab.example.com/team/docs/-/merge_requests/7";
    expect(await provider.state(query("https://gitlab.example.com", "team/docs", url))).toBe("merged");
    expect(await provider.state(query("https://gitlab.example.com", "team/docs", url))).toBe("closed");
    expect(await provider.state(query("https://gitlab.example.com", "team/docs", url))).toBe("open");
    expect(mock.calls[0]?.url).toBe("https://gitlab.example.com/api/v4/projects/team%2Fdocs/merge_requests/7");
  });

  it("Gitea and Azure DevOps read their own merged markers", async () => {
    const gitea = mockFetch({ status: 200, json: { merged: true, state: "closed" } });
    expect(await pullRequestProvider("gitea", gitea.fetch)!.state(query("https://gitea.example.com", "org/docs", "https://gitea.example.com/org/docs/pulls/4"))).toBe("merged");
    const azure = mockFetch({ status: 200, json: { status: "completed" } }, { status: 200, json: { status: "abandoned" } });
    const provider = pullRequestProvider("azure-devops", azure.fetch)!;
    const url = "https://dev.azure.com/acme/Billing/_git/docs/pullrequest/9";
    expect(await provider.state(query("https://dev.azure.com/acme", "Billing/_git/docs", url))).toBe("merged");
    expect(await provider.state(query("https://dev.azure.com/acme", "Billing/_git/docs", url))).toBe("closed");
    expect(azure.calls[0]?.url).toBe("https://dev.azure.com/acme/Billing/_apis/git/repositories/docs/pullrequests/9?api-version=7.1");
  });

  it("an unknown pull request (404) has no state, other refusals are errors without the token", async () => {
    const mock = mockFetch({ status: 404, json: { message: "Not Found" } }, { status: 500, json: { message: `boom ${token}` } });
    const provider = pullRequestProvider("github", mock.fetch)!;
    const q = query("https://github.com", "org/docs", "https://github.com/org/docs/pull/3");
    expect(await provider.state(q)).toBeUndefined();
    const error = await provider.state(q).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GitError);
    expect(String((error as Error).message)).not.toContain(token);
  });

  it("refuses a URL without a number and reports no state for unsupported servers", async () => {
    await expect(pullRequestProvider("github", mockFetch().fetch)!.state(query("https://github.com", "org/docs", "https://github.com/org/docs/pulls"))).rejects.toThrow(/No pull request number/);
    expect(await pullRequestProvider("bitbucket")!.state(query("https://bitbucket.org", "org/docs", "https://bitbucket.org/org/docs/pull-requests/1"))).toBeUndefined();
  });
});
