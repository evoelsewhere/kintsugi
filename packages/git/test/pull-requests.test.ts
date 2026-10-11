// Pull-request adapters against a mocked fetch: URLs derived from the server base URL,
// authentication headers, reuse of an existing pull request, and redacted errors.

import { describe, expect, it } from "vitest";
import { GitError, type OpenPullRequest, PullRequestsUnsupportedError, pullRequestProvider } from "../src/index.js";

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
