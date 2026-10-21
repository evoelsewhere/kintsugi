import { describe, expect, it } from "vitest";
import { GitHubProviderCredentialProvider, type GitHubAppConnection, type GitHubAppPurpose, type GitHubCredentialResolver, type GitHubProviderCredential, type GitHubTokenConnection } from "../src/github-app.js";
import { GitHubPullRequestObserver } from "../src/github-observer.js";

interface ApiResponse {
  status: number;
  body: unknown;
  url?: string;
  headers?: Record<string, string>;
}

interface RecordedCall {
  url: string;
  init?: RequestInit;
}

function fakeFetch(responses: ApiResponse[]): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    const next = responses.shift();
    if (next === undefined) throw new Error(`unexpected request ${url}`);
    const response = new Response(JSON.stringify(next.body), { status: next.status, headers: next.headers });
    Object.defineProperty(response, "url", { value: next.url ?? url });
    return response;
  };
  return { fetch: fetchImpl as typeof fetch, calls };
}

function connection(baseUrl = "https://github.com", kind: "github" | "github-enterprise" = "github"): GitHubAppConnection {
  return { kind, baseUrl, appId: "12345", installationId: "67890", privateKey: "not-used-by-the-observer", repositoryPath: "Acme/Billing" };
}

function tokenConnection(): GitHubTokenConnection {
  return { kind: "github", baseUrl: "https://github.com", repositoryPath: "Acme/Billing", token: "TEST-legacy-token" };
}

const HEAD_SHA = "a".repeat(40);
const BASE_SHA = "b".repeat(40);
const TEST_MERGE_SHA = "c".repeat(40);
const FINAL_MERGE_SHA = "d".repeat(40);
const REVIEWED_SHA = "e".repeat(40);

function resolver(resolve?: (purpose: GitHubAppPurpose) => GitHubProviderCredential | Promise<GitHubProviderCredential>): GitHubCredentialResolver {
  return {
    resolve: async (_connection, purpose) =>
      resolve?.(purpose) ?? {
        token: `TEST-${purpose}`,
        repositoryPath: "Acme/Billing",
        permissions: purpose === "checks-read" ? { checks: "read" } : { pull_requests: "read" },
        expiresAt: "2026-10-21T12:00:00.000Z",
      },
  };
}

const pr = (values: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 987,
  number: 12,
  state: "open",
  merged_at: null,
  draft: false,
  updated_at: "2026-10-21T10:30:00Z",
  merge_commit_sha: TEST_MERGE_SHA,
  user: { id: 88, login: "contributor" },
  head: { sha: HEAD_SHA, ref: "feature/work" },
  base: { sha: BASE_SHA, ref: "main", repo: { id: 42, full_name: "Acme/Billing" } },
  ...values,
});

describe("GitHub pull-request observation", () => {
  it("lists all PR states with pinned public and GHE API roots and follows only repository-bound cursors", async () => {
    const publicNext = "https://api.github.com/repos/Acme/Billing/pulls?state=all&sort=updated&direction=desc&per_page=100&page=2";
    const publicFetch = fakeFetch([
      { status: 200, body: [pr()], headers: { link: `<${publicNext}>; rel="next"` } },
      { status: 200, body: [pr({ id: 988, number: 13, state: "closed", updated_at: "2026-10-21T10:20:00Z" })] },
      { status: 200, body: [pr({ id: 989, number: 14, state: "closed", merged_at: "2026-10-21T10:25:00Z", updated_at: "2026-10-21T10:25:00Z" })] },
    ]);
    const observer = new GitHubPullRequestObserver({ credentials: resolver(), fetch: publicFetch.fetch });

    const first = await observer.listChanged(connection(), "2026-10-21T10:00:00Z");
    const second = await observer.listChanged(connection(), "2026-10-21T10:00:00Z", first.nextCursor);
    const third = await observer.listChanged(connection(), "2026-10-21T10:00:00Z", second.nextCursor);

    expect(new URL(publicFetch.calls[0]!.url).origin).toBe("https://api.github.com");
    expect(new URL(publicFetch.calls[0]!.url).searchParams.get("state")).toBe("all");
    expect(first).toMatchObject({ complete: false, items: [{ pullRequestId: "987", number: 12, state: "open", authorId: "88", authorLogin: "contributor", headSha: HEAD_SHA, baseSha: BASE_SHA, testMergeSha: TEST_MERGE_SHA }] });
    expect(new URL(first.nextCursor!).origin).toBe("https://api.github.com");
    expect(second.items[0]).toMatchObject({ pullRequestId: "988", state: "closed" });
    expect(third.items[0]).toMatchObject({ pullRequestId: "989", state: "merged", mergeCommitSha: TEST_MERGE_SHA });
    expect(third.complete).toBe(true);

    const enterpriseFetch = fakeFetch([{ status: 200, body: [pr()] }]);
    const enterprise = new GitHubPullRequestObserver({ credentials: resolver(), fetch: enterpriseFetch.fetch });
    await enterprise.listChanged(connection("https://ghe.example.com", "github-enterprise"), "2026-10-21T10:00:00Z");
    expect(enterpriseFetch.calls[0]?.url).toMatch(/^https:\/\/ghe\.example\.com\/api\/v3\/repos\/Acme\/Billing\/pulls\?/);
  });

  it("preserves check producer and evaluated SHAs and review actor identity", async () => {
    const fetch = fakeFetch([
      { status: 200, body: pr({ state: "closed", merged_at: "2026-10-21T10:45:00Z", merge_commit_sha: FINAL_MERGE_SHA }) },
      {
        status: 200,
        body: [{ id: 51, user: { id: 77, login: "reviewer" }, state: "APPROVED", commit_id: REVIEWED_SHA, submitted_at: "2026-10-21T10:40:00Z" }],
      },
      {
        status: 200,
        body: { total_count: 1, check_runs: [{ id: 61, name: "ci", app: { id: 91, slug: "ci-bot" }, head_sha: REVIEWED_SHA, status: "completed", conclusion: "success", completed_at: "2026-10-21T10:42:00Z" }] },
      },
    ]);
    const observer = new GitHubPullRequestObserver({ credentials: resolver(), fetch: fetch.fetch });

    const result = await observer.get(connection(), {
      host: "github.com",
      repositoryId: "42",
      repositoryPath: "Acme/Billing",
      pullRequestId: "987",
      number: 12,
    });

    expect(result).toMatchObject({ state: "merged", mergeCommitSha: FINAL_MERGE_SHA, mergedAt: "2026-10-21T10:45:00Z" });
    expect(result.reviews).toEqual([{ id: "51", actorId: "77", actorLogin: "reviewer", state: "APPROVED", commitSha: REVIEWED_SHA, submittedAt: "2026-10-21T10:40:00Z" }]);
    expect(result.checks).toEqual([{ id: "61", name: "ci", appId: "91", appSlug: "ci-bot", headSha: REVIEWED_SHA, status: "completed", conclusion: "success", completedAt: "2026-10-21T10:42:00Z" }]);
    expect(fetch.calls[2]?.url).toContain(`/commits/${HEAD_SHA}/check-runs`);
    expect(fetch.calls.every((call) => call.init?.redirect === "error")).toBe(true);
  });

  it("rejects a foreign cursor before sending the installation credential", async () => {
    const fetch = fakeFetch([]);
    const observer = new GitHubPullRequestObserver({ credentials: resolver(), fetch: fetch.fetch });

    await expect(observer.listChanged(connection(), "2026-10-21T10:00:00Z", "https://attacker.example/collect")).rejects.toMatchObject({ code: "GITHUB_CURSOR_INVALID" });
    expect(fetch.calls).toHaveLength(0);
  });

  it("rejects an invalid watermark and a pull request returned for another repository", async () => {
    const emptyFetch = fakeFetch([]);
    const emptyObserver = new GitHubPullRequestObserver({ credentials: resolver(), fetch: emptyFetch.fetch });
    await expect(emptyObserver.listChanged(connection(), "not-a-timestamp")).rejects.toMatchObject({ code: "GITHUB_WATERMARK_INVALID" });
    expect(emptyFetch.calls).toHaveLength(0);

    const foreignFetch = fakeFetch([{ status: 200, body: [pr({ base: { sha: BASE_SHA, ref: "main", repo: { id: 42, full_name: "Acme/Other" } } })] }]);
    const foreignObserver = new GitHubPullRequestObserver({ credentials: resolver(), fetch: foreignFetch.fetch });
    await expect(foreignObserver.listChanged(connection(), "2026-10-21T10:00:00Z")).rejects.toMatchObject({ code: "GITHUB_IDENTITY_MISMATCH" });
  });

  it("refuses a credential resolver result bound to another repository", async () => {
    const fetch = fakeFetch([]);
    const observer = new GitHubPullRequestObserver({
      credentials: resolver(() => ({ token: "TEST-token", repositoryPath: "Acme/Other", permissions: {} })),
      fetch: fetch.fetch,
    });

    await expect(observer.listChanged(connection(), "2026-10-21T10:00:00Z")).rejects.toMatchObject({ code: "GITHUB_TOKEN_SCOPE_INVALID" });
    expect(fetch.calls).toHaveLength(0);
  });

  it("keeps provider author IDs for verified actor mapping and tolerates deleted authors without inventing identity", async () => {
    const fetch = fakeFetch([{ status: 200, body: [pr({ user: null })] }]);
    const observer = new GitHubPullRequestObserver({ credentials: resolver(), fetch: fetch.fetch });
    const page = await observer.listChanged(connection(), "2026-10-21T10:00:00Z");

    expect(page.items[0]).not.toHaveProperty("authorId");
    expect(page.items[0]).not.toHaveProperty("authorLogin");
  });

  it("does not coerce unknown PR state or missing draft metadata into an open, non-draft PR", async () => {
    for (const invalidPull of [pr({ state: "queued" }), pr({ draft: undefined }), pr({ merged_at: "not-a-timestamp" }), pr({ head: { sha: "not-a-sha", ref: "feature/work" } })]) {
      const fetch = fakeFetch([{ status: 200, body: [invalidPull] }]);
      const observer = new GitHubPullRequestObserver({ credentials: resolver(), fetch: fetch.fetch });

      await expect(observer.listChanged(connection(), "2026-10-21T10:00:00Z")).rejects.toMatchObject({ code: "GITHUB_RESPONSE_INVALID" });
    }
  });

  it("rejects same-origin pagination cursors with token-like query parameters", async () => {
    const fetch = fakeFetch([]);
    const observer = new GitHubPullRequestObserver({ credentials: resolver(), fetch: fetch.fetch });

    await expect(observer.listChanged(
      connection(),
      "2026-10-21T10:00:00Z",
      "https://api.github.com/repos/Acme/Billing/pulls?state=all&sort=updated&direction=desc&per_page=100&page=2&access_token=TEST-exfiltration",
    )).rejects.toMatchObject({ code: "GITHUB_CURSOR_INVALID" });
    expect(fetch.calls).toHaveLength(0);
  });

  it("requires a concrete page number before following provider pagination", async () => {
    const fetch = fakeFetch([]);
    const observer = new GitHubPullRequestObserver({ credentials: resolver(), fetch: fetch.fetch });

    await expect(observer.listChanged(
      connection(),
      "2026-10-21T10:00:00Z",
      "https://api.github.com/repos/Acme/Billing/pulls?state=all&sort=updated&direction=desc&per_page=100",
    )).rejects.toMatchObject({ code: "GITHUB_CURSOR_INVALID" });
    expect(fetch.calls).toHaveLength(0);
  });

  it("rejects pagination cursors containing embedded credentials or fragments", async () => {
    const fetch = fakeFetch([]);
    const observer = new GitHubPullRequestObserver({ credentials: resolver(), fetch: fetch.fetch });
    for (const cursor of [
      "https://TEST-user:TEST-password@api.github.com/repos/Acme/Billing/pulls?state=all&sort=updated&direction=desc&per_page=100&page=2",
      "https://api.github.com/repos/Acme/Billing/pulls?state=all&sort=updated&direction=desc&per_page=100&page=2#TEST-fragment",
    ]) {
      await expect(observer.listChanged(connection(), "2026-10-21T10:00:00Z", cursor)).rejects.toMatchObject({ code: "GITHUB_CURSOR_INVALID" });
    }
    expect(fetch.calls).toHaveLength(0);
  });

  it("reports inaccessible capabilities as unknown and merge-queue support as unsupported", async () => {
    const observer = new GitHubPullRequestObserver({
      credentials: resolver((purpose) => {
        if (purpose === "checks-read") throw Object.assign(new Error("permission unavailable"), { code: "GITHUB_PERMISSION_UNAVAILABLE" });
        return {
          token: "TEST-pr-token",
          repositoryPath: "Acme/Billing",
          permissions: { pull_requests: "read" },
          expiresAt: "2026-10-21T12:00:00.000Z",
        };
      }),
      fetch: fakeFetch([
        { status: 200, body: [pr()] },
        { status: 200, body: [] },
      ]).fetch,
    });

    await expect(observer.capabilities(connection())).resolves.toEqual({
      pullRequests: { state: "supported" },
      reviews: { state: "supported" },
      checks: { state: "unknown", reason: "permission-unavailable" },
      mergeQueue: { state: "unsupported", reason: "pilot-scope" },
    });
    await expect(observer.capabilities({ ...connection(), mergeQueueEnabled: true })).rejects.toMatchObject({ code: "GITHUB_MERGE_QUEUE_UNSUPPORTED" });
  });

  it("tests a legacy PAT against the actual PR, review, and Checks read endpoints", async () => {
    const fetch = fakeFetch([
      { status: 200, body: [pr()] },
      { status: 200, body: [] },
      { status: 200, body: { total_count: 0, check_runs: [] } },
    ]);
    const observer = new GitHubPullRequestObserver({ credentials: new GitHubProviderCredentialProvider(), fetch: fetch.fetch });

    const capabilities = await observer.capabilities(tokenConnection());

    expect(capabilities).toEqual({
      pullRequests: { state: "supported" },
      reviews: { state: "supported" },
      checks: { state: "supported" },
      mergeQueue: { state: "unsupported", reason: "pilot-scope" },
    });
    expect(fetch.calls).toHaveLength(3);
    expect(fetch.calls.every((call) => (call.init?.headers as Record<string, string>).authorization === "Bearer TEST-legacy-token")).toBe(true);
  });
});
