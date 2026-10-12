// Pull-request REST adapters (ADR-0025: provider operations live in the Git core, no provider
// CLIs). The writer opens one pull request per `kintsugi/*` branch (ADR-0019). API base URLs
// derive from the registered server's base URL; the server's token authenticates the call
// and never appears in errors. Servers without an adapter keep the pushed branch only.

import { GitError, isLoopbackUrl } from "./cli.js";

/** Server kinds as registered in Settings -> Git (`GitServerKind` in @kintsugi/domain). */
export type PullRequestServerKind = "github" | "github-enterprise" | "azure-devops" | "gitlab" | "bitbucket" | "gitea" | "plain-git";

export interface OpenPullRequest {
  /** The server's registered base URL, e.g. https://github.com or https://dev.azure.com/org. */
  baseUrl: string;
  /** Repository path on the server, as in kintsugi.yaml: `org/repo`, `Project/_git/repo`. */
  path: string;
  token: string;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  body: string;
}

export interface PullRequest {
  url: string;
  number: number;
  /** False when an open pull request for the branch existed already (a retried write). */
  created: boolean;
}

export interface PullRequestProvider {
  open(input: OpenPullRequest): Promise<PullRequest>;
}

/** The server kind has no pull-request adapter yet. */
export class PullRequestsUnsupportedError extends GitError {
  constructor(kind: string) {
    super(`Pull requests on ${kind} servers are not supported yet; the branch was pushed`, null, "");
    this.name = "PullRequestsUnsupportedError";
  }
}

type Fetch = typeof fetch;

const trimSlash = (url: string): string => url.replace(/\/+$/, "");

/** Calls a provider API and parses JSON; errors carry the status and a short body, never the token. */
async function call(fetchImpl: Fetch, token: string, url: string, init: { method: string; headers: Record<string, string>; body?: unknown }): Promise<{ status: number; json: unknown }> {
  if (!url.startsWith("https://") && !isLoopbackUrl(url)) throw new GitError("Pull-request APIs are only called over https: tokens never travel over plain http", null, "");
  const response = await fetchImpl(url, {
    method: init.method,
    headers: { accept: "application/json", ...(init.body === undefined ? {} : { "content-type": "application/json" }), ...init.headers },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = text === "" ? undefined : JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, json: json ?? { message: text.slice(0, 500).split(token).join("[redacted]") } };
}

const fail = (provider: string, status: number, json: unknown, token: string): never => {
  const detail = JSON.stringify(json).slice(0, 500).split(token).join("[redacted]");
  throw new GitError(`${provider} refused the pull request (HTTP ${status}): ${detail}`, null, "");
};

const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});

function ownerAndRepo(path: string): [string, string] {
  const parts = path.split("/");
  if (parts.length !== 2 || parts.some((part) => part === "")) throw new GitError(`Expected an owner/repo path, got "${path}"`, null, "");
  return [parts[0]!, parts[1]!];
}

/** GitHub and GitHub Enterprise Server (REST v3). */
class GitHubPullRequests implements PullRequestProvider {
  constructor(
    private readonly fetchImpl: Fetch,
    private readonly enterprise: boolean,
  ) {}

  apiBase(baseUrl: string): string {
    const base = trimSlash(baseUrl);
    if (!this.enterprise && /^https:\/\/(www\.)?github\.com$/i.test(base)) return "https://api.github.com";
    return /\/api\/v3$/.test(base) ? base : `${base}/api/v3`;
  }

  async open(input: OpenPullRequest): Promise<PullRequest> {
    const [owner, repo] = ownerAndRepo(input.path);
    const pulls = `${this.apiBase(input.baseUrl)}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`;
    const headers = { authorization: `Bearer ${input.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
    const created = await call(this.fetchImpl, input.token, pulls, {
      method: "POST",
      headers,
      body: { title: input.title, head: input.sourceBranch, base: input.targetBranch, body: input.body },
    });
    if (created.status === 201) return { url: String(record(created.json)["html_url"]), number: Number(record(created.json)["number"]), created: true };
    if (created.status === 422) {
      const query = new URLSearchParams({ head: `${owner}:${input.sourceBranch}`, base: input.targetBranch, state: "open" });
      const existing = await call(this.fetchImpl, input.token, `${pulls}?${query}`, { method: "GET", headers });
      const first = Array.isArray(existing.json) ? record(existing.json[0]) : {};
      if (existing.status === 200 && typeof first["html_url"] === "string") return { url: first["html_url"], number: Number(first["number"]), created: false };
    }
    return fail("GitHub", created.status, created.json, input.token);
  }
}

/** GitLab (REST v4 merge requests), gitlab.com or self-managed. */
class GitLabMergeRequests implements PullRequestProvider {
  constructor(private readonly fetchImpl: Fetch) {}

  async open(input: OpenPullRequest): Promise<PullRequest> {
    const requests = `${trimSlash(input.baseUrl)}/api/v4/projects/${encodeURIComponent(input.path)}/merge_requests`;
    const headers = { "private-token": input.token };
    const created = await call(this.fetchImpl, input.token, requests, {
      method: "POST",
      headers,
      body: { source_branch: input.sourceBranch, target_branch: input.targetBranch, title: input.title, description: input.body, remove_source_branch: true },
    });
    if (created.status === 201) return { url: String(record(created.json)["web_url"]), number: Number(record(created.json)["iid"]), created: true };
    if (created.status === 409) {
      const query = new URLSearchParams({ source_branch: input.sourceBranch, target_branch: input.targetBranch, state: "opened" });
      const existing = await call(this.fetchImpl, input.token, `${requests}?${query}`, { method: "GET", headers });
      const first = Array.isArray(existing.json) ? record(existing.json[0]) : {};
      if (existing.status === 200 && typeof first["web_url"] === "string") return { url: first["web_url"], number: Number(first["iid"]), created: false };
    }
    return fail("GitLab", created.status, created.json, input.token);
  }
}

/** Gitea and Forgejo (REST v1, GitHub-like). */
class GiteaPullRequests implements PullRequestProvider {
  constructor(private readonly fetchImpl: Fetch) {}

  async open(input: OpenPullRequest): Promise<PullRequest> {
    const [owner, repo] = ownerAndRepo(input.path);
    const pulls = `${trimSlash(input.baseUrl)}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`;
    const headers = { authorization: `token ${input.token}` };
    const created = await call(this.fetchImpl, input.token, pulls, {
      method: "POST",
      headers,
      body: { title: input.title, head: input.sourceBranch, base: input.targetBranch, body: input.body },
    });
    if (created.status === 201) return { url: String(record(created.json)["html_url"]), number: Number(record(created.json)["number"]), created: true };
    if (created.status === 409) {
      const existing = await call(this.fetchImpl, input.token, `${pulls}?state=open&limit=50`, { method: "GET", headers });
      const match = Array.isArray(existing.json)
        ? existing.json.map(record).find((pull) => record(pull["head"])["ref"] === input.sourceBranch && record(pull["base"])["ref"] === input.targetBranch)
        : undefined;
      if (match !== undefined && typeof match["html_url"] === "string") return { url: match["html_url"], number: Number(match["number"]), created: false };
    }
    return fail("Gitea", created.status, created.json, input.token);
  }
}

/** Azure DevOps Services / Server (REST 7.1); the base URL is the organization or collection. */
class AzureDevOpsPullRequests implements PullRequestProvider {
  constructor(private readonly fetchImpl: Fetch) {}

  async open(input: OpenPullRequest): Promise<PullRequest> {
    const match = /^([^/]+)\/_git\/([^/]+)$/.exec(input.path);
    if (match === null) throw new GitError(`Expected a <project>/_git/<repo> path, got "${input.path}"`, null, "");
    const [project, repo] = [match[1]!, match[2]!];
    const base = trimSlash(input.baseUrl);
    const repository = `${base}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests`;
    const headers = { authorization: `Basic ${Buffer.from(`:${input.token}`).toString("base64")}` };
    const web = (id: number): string => `${base}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequest/${id}`;
    const created = await call(this.fetchImpl, input.token, `${repository}?api-version=7.1`, {
      method: "POST",
      headers,
      body: { sourceRefName: `refs/heads/${input.sourceBranch}`, targetRefName: `refs/heads/${input.targetBranch}`, title: input.title, description: input.body },
    });
    if (created.status === 201) {
      const id = Number(record(created.json)["pullRequestId"]);
      return { url: web(id), number: id, created: true };
    }
    if (created.status === 409) {
      const query = new URLSearchParams({
        "searchCriteria.sourceRefName": `refs/heads/${input.sourceBranch}`,
        "searchCriteria.targetRefName": `refs/heads/${input.targetBranch}`,
        "searchCriteria.status": "active",
        "api-version": "7.1",
      });
      const existing = await call(this.fetchImpl, input.token, `${repository}?${query}`, { method: "GET", headers });
      const values = record(existing.json)["value"];
      const first = Array.isArray(values) ? record(values[0]) : {};
      if (existing.status === 200 && typeof first["pullRequestId"] === "number") return { url: web(first["pullRequestId"]), number: first["pullRequestId"], created: false };
    }
    return fail("Azure DevOps", created.status, created.json, input.token);
  }
}

/**
 * The pull-request adapter for a server kind. `plain-git` has no pull requests (the writer
 * just pushes the branch, ADR-0019); Bitbucket throws PullRequestsUnsupportedError for now.
 */
export function pullRequestProvider(kind: PullRequestServerKind, fetchImpl: Fetch = fetch): PullRequestProvider | undefined {
  switch (kind) {
    case "github":
      return new GitHubPullRequests(fetchImpl, false);
    case "github-enterprise":
      return new GitHubPullRequests(fetchImpl, true);
    case "gitlab":
      return new GitLabMergeRequests(fetchImpl);
    case "gitea":
      return new GiteaPullRequests(fetchImpl);
    case "azure-devops":
      return new AzureDevOpsPullRequests(fetchImpl);
    case "plain-git":
      return undefined;
    default:
      return { open: () => Promise.reject(new PullRequestsUnsupportedError(kind)) };
  }
}
