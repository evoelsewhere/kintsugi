import { GITHUB_REST_API_VERSION, GitHubAppError, githubApiTarget, type GitHubObservationConnection, type GitHubCredentialResolver, type GitHubApiTarget, type GitHubRepositoryConnection } from "./github-app.js";
import type {
  ChangePage,
  ObservedCheckRun,
  ObservedPullRequest,
  ObservedPullRequestSummary,
  ObservedReview,
  PullRequestIdentity,
  PullRequestObserver,
  ProviderCapabilities,
  ProviderCapability,
} from "./pull-request-observer.js";
import { parseMemberAssociationClaim } from "@kintsugi/domain";

type Fetch = typeof fetch;
type JsonResponse = { body: unknown; response: Response };

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new GitHubAppError("GITHUB_RESPONSE_INVALID", `GitHub response is missing ${field}`);
  return value;
}

function requiredSha(value: unknown, field: string): string {
  const sha = requiredString(value, field);
  if (!/^([a-f0-9]{40}|[a-f0-9]{64})$/i.test(sha)) {
    throw new GitHubAppError("GITHUB_RESPONSE_INVALID", `GitHub response has an invalid ${field} commit SHA`);
  }
  return sha.toLowerCase();
}

function optionalSha(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredSha(value, field);
}

function optionalTimestamp(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new GitHubAppError("GITHUB_RESPONSE_INVALID", `GitHub response has an invalid ${field} timestamp`);
  }
  return value;
}

function stableId(value: unknown, field: string): string {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).length === 0) {
    throw new GitHubAppError("GITHUB_RESPONSE_INVALID", `GitHub response is missing ${field}`);
  }
  return String(value);
}

function optionalStableId(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return stableId(value, field);
}

function apiPath(target: GitHubApiTarget, routePath: string): string {
  const prefix = new URL(target.apiBase).pathname.replace(/\/$/, "");
  return `${prefix}${routePath}`;
}

type CursorMode = "changed-pull-list" | "all-pull-list" | "collection";

function safeCursor(raw: string, target: GitHubApiTarget, pathname: string, mode: CursorMode): URL {
  let cursor: URL;
  try {
    cursor = new URL(raw);
  } catch {
    throw new GitHubAppError("GITHUB_CURSOR_INVALID", "GitHub returned an invalid pagination cursor");
  }
  const pullList = mode !== "collection";
  const allowedParameters = pullList
    ? new Set(["state", "sort", "direction", "per_page", "page"])
    : new Set(["per_page", "page"]);
  const queryIsBounded = [...cursor.searchParams.keys()].every((name) => allowedParameters.has(name)) &&
    [...allowedParameters].every((name) => cursor.searchParams.getAll(name).length <= 1);
  const page = cursor.searchParams.get("page");
  if (
    cursor.origin !== target.origin ||
    cursor.username !== "" ||
    cursor.password !== "" ||
    cursor.hash !== "" ||
    cursor.pathname !== pathname ||
    !queryIsBounded ||
    cursor.searchParams.get("per_page") !== "100" ||
    (page === null || !/^[1-9]\d*$/.test(page)) ||
    (mode === "changed-pull-list" &&
      (cursor.searchParams.get("state") !== "all" ||
        cursor.searchParams.get("sort") !== "updated" ||
        cursor.searchParams.get("direction") !== "desc")) ||
    (mode === "all-pull-list" &&
      (cursor.searchParams.get("state") !== "all" ||
        cursor.searchParams.get("sort") !== "created" ||
        cursor.searchParams.get("direction") !== "asc"))
  ) {
    throw new GitHubAppError("GITHUB_CURSOR_INVALID", "GitHub pagination cursor does not match the registered host and pull-request route");
  }
  return cursor;
}

function nextCursor(response: Response, target: GitHubApiTarget, pathname: string, mode: CursorMode): string | undefined {
  const link = response.headers.get("link");
  if (link === null) return undefined;
  const next = /<([^>]+)>\s*;\s*rel\s*=\s*"?next"?/i.exec(link)?.[1];
  return next === undefined ? undefined : safeCursor(next, target, pathname, mode).toString();
}

function pullPath(target: GitHubApiTarget): string {
  return `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}/pulls`;
}

function mapPullRequest(value: unknown, connection: GitHubRepositoryConnection, target: GitHubApiTarget): ObservedPullRequestSummary {
  const pull = record(value);
  const number = pull["number"];
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) {
    throw new GitHubAppError("GITHUB_RESPONSE_INVALID", "GitHub pull request response has an invalid number");
  }
  const head = record(pull["head"]);
  const base = record(pull["base"]);
  const repository = record(base["repo"]);
  const author = record(pull["user"]);
  const authorId = optionalStableId(author["id"], "user.id");
  const authorLogin = typeof author["login"] === "string" && author["login"].length > 0 ? author["login"] : undefined;
  const repositoryPath = requiredString(repository["full_name"], "base.repo.full_name");
  if (repositoryPath.toLowerCase() !== connection.repositoryPath.toLowerCase()) {
    throw new GitHubAppError("GITHUB_IDENTITY_MISMATCH", "GitHub returned a pull request for a different repository");
  }
  const rawState = pull["state"];
  if (rawState !== "open" && rawState !== "closed") {
    throw new GitHubAppError("GITHUB_RESPONSE_INVALID", "GitHub pull request response has an invalid state");
  }
  const draft = pull["draft"];
  if (typeof draft !== "boolean") {
    throw new GitHubAppError("GITHUB_RESPONSE_INVALID", "GitHub pull request response has invalid draft metadata");
  }
  const rawMergedAt = pull["merged_at"];
  if (rawMergedAt !== null && typeof rawMergedAt !== "string") {
    throw new GitHubAppError("GITHUB_RESPONSE_INVALID", "GitHub pull request response has invalid merged_at metadata");
  }
  const mergedAt = optionalTimestamp(rawMergedAt, "merged_at");
  if (mergedAt !== undefined && (!Number.isFinite(Date.parse(mergedAt)) || rawState !== "closed")) {
    throw new GitHubAppError("GITHUB_RESPONSE_INVALID", "GitHub pull request response has inconsistent merge metadata");
  }
  const state: ObservedPullRequestSummary["state"] = mergedAt !== undefined ? "merged" : rawState;
  const updatedAt = requiredString(pull["updated_at"], "updated_at");
  if (!Number.isFinite(Date.parse(updatedAt))) throw new GitHubAppError("GITHUB_RESPONSE_INVALID", "GitHub pull request response has an invalid updated_at timestamp");
  const mergeCommitSha = optionalSha(pull["merge_commit_sha"], "merge_commit_sha");
  const mergeBaseSha = optionalSha(pull["merge_base_sha"], "merge_base_sha");
  const identityHost = new URL(connection.baseUrl).hostname.toLowerCase();
  const htmlUrl = new URL(`/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}/pull/${number}`, new URL(connection.baseUrl).origin).toString();
  const associationClaim = parseMemberAssociationClaim(pull["body"]);
  return {
    provider: connection.kind,
    host: identityHost,
    repositoryId: stableId(repository["id"], "base.repo.id"),
    repositoryPath: connection.repositoryPath,
    pullRequestId: stableId(pull["id"], "id"),
    number,
    htmlUrl,
    ...(authorId === undefined ? {} : { authorId }),
    ...(authorLogin === undefined ? {} : { authorLogin }),
    associationClaimStatus: associationClaim.status,
    ...(associationClaim.status === "valid" ? { associationClaim: associationClaim.claim } : {}),
    state,
    draft,
    updatedAt,
    headSha: requiredSha(head["sha"], "head.sha"),
    headRef: requiredString(head["ref"], "head.ref"),
    baseSha: requiredSha(base["sha"], "base.sha"),
    baseRef: requiredString(base["ref"], "base.ref"),
    ...(mergeBaseSha === undefined ? {} : { mergeBaseSha }),
    ...(state === "open" && mergeCommitSha !== undefined ? { testMergeSha: mergeCommitSha } : {}),
    ...(state === "merged" && mergeCommitSha !== undefined ? { mergeCommitSha } : {}),
    ...(mergedAt === undefined ? {} : { mergedAt }),
  };
}

function errorCapability(error: unknown): ProviderCapability {
  const code = error instanceof GitHubAppError ? error.code : (error as { code?: unknown } | null)?.code;
  return {
    state: "unknown",
    reason: code === "GITHUB_PERMISSION_UNAVAILABLE" || code === "GITHUB_HTTP_401" || code === "GITHUB_HTTP_403" ? "permission-unavailable" : "provider-unavailable",
  };
}

/** Read-only GitHub/GHES observation. Provider payloads stay inside this adapter. */
export class GitHubPullRequestObserver implements PullRequestObserver<GitHubObservationConnection> {
  readonly #credentials: GitHubCredentialResolver;
  readonly #fetch: Fetch;

  constructor(options: { credentials: GitHubCredentialResolver; fetch?: Fetch }) {
    this.#credentials = options.credentials;
    this.#fetch = options.fetch ?? fetch;
  }

  async capabilities(connection: GitHubObservationConnection): Promise<ProviderCapabilities> {
    if (connection.mergeQueueEnabled === true) {
      throw new GitHubAppError("GITHUB_MERGE_QUEUE_UNSUPPORTED", "The Coding Agent Workflow pilot does not support merge queues");
    }
    githubApiTarget(connection);
    let pullRequest: ProviderCapability;
    let reviews: ProviderCapability = { state: "unknown", reason: "provider-unavailable" };
    let checks: ProviderCapability = { state: "unknown", reason: "provider-unavailable" };
    const target = githubApiTarget(connection);
    let firstPull: Record<string, unknown> | undefined;
    try {
      const credential = await this.#credential(connection, "pull-requests-read");
      const pathname = pullPath(target);
      const url = new URL(`${target.apiBase}${pathname}`);
      url.search = new URLSearchParams({ state: "all", sort: "updated", direction: "desc", per_page: "1" }).toString();
      const response = await this.#getJson(target, credential.token, url.toString(), apiPath(target, pathname));
      if (!Array.isArray(response.body)) throw new GitHubAppError("GITHUB_RESPONSE_INVALID", "GitHub pull-request capability response is not an array");
      pullRequest = { state: "supported" };
      firstPull = response.body.length === 0 ? undefined : record(response.body[0]);
      if (firstPull !== undefined) {
        const number = firstPull["number"];
        if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) {
          throw new GitHubAppError("GITHUB_RESPONSE_INVALID", "GitHub pull-request capability response has an invalid number");
        }
        const reviewsPath = `${pathname}/${number}/reviews`;
        reviews = await this.#probeRequest(target, credential.token, `${target.apiBase}${reviewsPath}?per_page=1`, apiPath(target, reviewsPath));
      }
    } catch (error) {
      pullRequest = errorCapability(error);
      reviews = pullRequest;
    }
    if (firstPull !== undefined) {
      const headSha = record(firstPull["head"])["sha"];
      if (typeof headSha === "string" && headSha.length > 0) {
        try {
          const credential = await this.#credential(connection, "checks-read");
          const checksPath = `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}/commits/${encodeURIComponent(headSha)}/check-runs`;
          checks = await this.#probeRequest(target, credential.token, `${target.apiBase}${checksPath}?per_page=1`, apiPath(target, checksPath));
        } catch (error) {
          checks = errorCapability(error);
        }
      }
    }
    return {
      pullRequests: pullRequest,
      reviews,
      checks,
      mergeQueue: { state: "unsupported", reason: "pilot-scope" },
    };
  }

  async listChanged(connection: GitHubObservationConnection, watermark: string, cursor?: string): Promise<ChangePage> {
    const watermarkTime = Date.parse(watermark);
    if (!Number.isFinite(watermarkTime)) throw new GitHubAppError("GITHUB_WATERMARK_INVALID", "The pull-request watermark must be a valid timestamp");
    const target = githubApiTarget(connection);
    if (connection.mergeQueueEnabled === true) throw new GitHubAppError("GITHUB_MERGE_QUEUE_UNSUPPORTED", "The Coding Agent Workflow pilot does not support merge queues");
    const pathname = pullPath(target);
    const url = cursor === undefined
      ? new URL(`${target.apiBase}${pathname}`)
      : safeCursor(cursor, target, apiPath(target, pathname), "changed-pull-list");
    if (cursor === undefined) {
      url.search = new URLSearchParams({ state: "all", sort: "updated", direction: "desc", per_page: "100" }).toString();
    }
    const credential = await this.#credential(connection, "pull-requests-read");
    const expectedPath = apiPath(target, pathname);
    const { body, response } = await this.#getJson(target, credential.token, url.toString(), expectedPath);
    if (!Array.isArray(body)) throw new GitHubAppError("GITHUB_RESPONSE_INVALID", "GitHub pull-request list response is not an array");

    const items: ObservedPullRequestSummary[] = [];
    let latestUpdatedAt = watermark;
    let reachedWatermark = false;
    for (const raw of body) {
      const pull = mapPullRequest(raw, connection, target);
      const updated = Date.parse(pull.updatedAt);
      if (updated < watermarkTime) {
        reachedWatermark = true;
        break;
      }
      items.push(pull);
      if (updated > Date.parse(latestUpdatedAt)) latestUpdatedAt = pull.updatedAt;
    }
    const next = reachedWatermark ? undefined : nextCursor(response, target, expectedPath, "changed-pull-list");
    return {
      items,
      latestUpdatedAt,
      complete: reachedWatermark || next === undefined,
      ...(next === undefined ? {} : { nextCursor: next }),
    };
  }

  /** Full all-state recovery scan in immutable creation order, so updates cannot shift older items between pages. */
  async listAll(connection: GitHubObservationConnection, cursor?: string): Promise<ChangePage> {
    const target = githubApiTarget(connection);
    if (connection.mergeQueueEnabled === true) throw new GitHubAppError("GITHUB_MERGE_QUEUE_UNSUPPORTED", "The Coding Agent Workflow pilot does not support merge queues");
    const pathname = pullPath(target);
    const expectedPath = apiPath(target, pathname);
    const url = cursor === undefined
      ? new URL(`${target.apiBase}${pathname}`)
      : safeCursor(cursor, target, expectedPath, "all-pull-list");
    if (cursor === undefined) {
      url.search = new URLSearchParams({ state: "all", sort: "created", direction: "asc", per_page: "100" }).toString();
    }
    const credential = await this.#credential(connection, "pull-requests-read");
    const { body, response } = await this.#getJson(target, credential.token, url.toString(), expectedPath);
    if (!Array.isArray(body)) throw new GitHubAppError("GITHUB_RESPONSE_INVALID", "GitHub pull-request list response is not an array");

    const items = body.map((raw) => mapPullRequest(raw, connection, target));
    const latestUpdatedAt = items.reduce(
      (latest, item) => Date.parse(item.updatedAt) > Date.parse(latest) ? item.updatedAt : latest,
      "1970-01-01T00:00:00.000Z",
    );
    const next = nextCursor(response, target, expectedPath, "all-pull-list");
    return { items, latestUpdatedAt, complete: next === undefined, ...(next === undefined ? {} : { nextCursor: next }) };
  }

  async get(connection: GitHubObservationConnection, identity: PullRequestIdentity): Promise<ObservedPullRequest> {
    const target = githubApiTarget(connection);
    const host = new URL(connection.baseUrl).hostname.toLowerCase();
    if (
      identity.host.toLowerCase() !== host ||
      identity.repositoryPath.toLowerCase() !== connection.repositoryPath.toLowerCase() ||
      !/^\d+$/.test(identity.repositoryId) ||
      !/^\d+$/.test(identity.pullRequestId) ||
      !Number.isSafeInteger(identity.number) || identity.number < 1
    ) {
      throw new GitHubAppError("GITHUB_IDENTITY_MISMATCH", "Pull-request identity does not match the registered repository");
    }
    if (connection.mergeQueueEnabled === true) throw new GitHubAppError("GITHUB_MERGE_QUEUE_UNSUPPORTED", "The Coding Agent Workflow pilot does not support merge queues");
    const path = `${pullPath(target)}/${identity.number}`;
    const prCredential = await this.#credential(connection, "pull-requests-read");
    const apiPullPath = apiPath(target, path);
    const { body: rawPull } = await this.#getJson(target, prCredential.token, `${target.apiBase}${path}`, apiPullPath);
    const summary = mapPullRequest(rawPull, connection, target);
    if (summary.pullRequestId !== identity.pullRequestId || summary.repositoryId !== identity.repositoryId) {
      throw new GitHubAppError("GITHUB_IDENTITY_MISMATCH", "GitHub returned a pull request with a different stable identity");
    }

    const reviewsPath = `${path}/reviews`;
    const apiReviewsPath = apiPath(target, reviewsPath);
    const reviews = await this.#getAllPages(target, prCredential.token, `${target.apiBase}${reviewsPath}?per_page=100`, apiReviewsPath, (value) => {
      if (!Array.isArray(value)) throw new GitHubAppError("GITHUB_RESPONSE_INVALID", "GitHub review response is not an array");
      return value.map(mapReview);
    });

    const normalizedChecksPath = `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}/commits/${encodeURIComponent(summary.headSha)}/check-runs`;
    const checkCredential = await this.#credential(connection, "checks-read");
    const apiChecksPath = apiPath(target, normalizedChecksPath);
    const checks = await this.#getAllPages(
      target,
      checkCredential.token,
      `${target.apiBase}${normalizedChecksPath}?per_page=100`,
      apiChecksPath,
      (value) => {
        const runs = record(value)["check_runs"];
        if (!Array.isArray(runs)) throw new GitHubAppError("GITHUB_RESPONSE_INVALID", "GitHub check-run response has no check_runs array");
        return runs.map(mapCheckRun);
      },
    );
    return { ...summary, reviews, checks };
  }

  async #probeRequest(target: GitHubApiTarget, token: string, url: string, pathname: string): Promise<ProviderCapability> {
    try {
      await this.#getJson(target, token, url, pathname);
      return { state: "supported" };
    } catch (error) {
      return errorCapability(error);
    }
  }

  async #credential(connection: GitHubObservationConnection, purpose: "pull-requests-read" | "checks-read") {
    const credential = await this.#credentials.resolve(connection, purpose);
    if (
      typeof credential.token !== "string" || credential.token.trim() === "" ||
      typeof credential.repositoryPath !== "string" ||
      credential.repositoryPath.toLowerCase() !== connection.repositoryPath.toLowerCase()
    ) {
      throw new GitHubAppError("GITHUB_TOKEN_SCOPE_INVALID", "The provider credential is not bound to the registered repository");
    }
    return credential;
  }

  async #getJson(target: GitHubApiTarget, token: string, url: string, expectedPath: string): Promise<JsonResponse> {
    const parsed = new URL(url);
    if (parsed.origin !== target.origin || parsed.pathname !== expectedPath) {
      throw new GitHubAppError("GITHUB_CURSOR_INVALID", "GitHub API URL is outside the registered host and route");
    }
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": GITHUB_REST_API_VERSION,
        },
      });
    } catch {
      throw new GitHubAppError("GITHUB_REQUEST_FAILED", "GitHub observation request failed before a response was received");
    }
    let finalUrl: URL;
    try {
      finalUrl = new URL(response.url);
    } catch {
      throw new GitHubAppError("GITHUB_RESPONSE_HOST_INVALID", "GitHub returned a response without a verifiable API URL");
    }
    if (finalUrl.origin !== target.origin || finalUrl.pathname !== expectedPath) {
      throw new GitHubAppError("GITHUB_REDIRECT_REJECTED", "GitHub observation response left the registered API route");
    }
    if (response.status !== 200) {
      const retryAfterMs = this.#retryAfterMs(response.headers);
      throw new GitHubAppError(
        `GITHUB_HTTP_${response.status}`,
        `GitHub observation request failed (HTTP ${response.status})`,
        retryAfterMs,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new GitHubAppError("GITHUB_RESPONSE_INVALID", "GitHub returned invalid JSON for an observation request");
    }
    return { body, response };
  }

  #retryAfterMs(headers: Headers): number | undefined {
    const retryAfter = headers.get("retry-after");
    if (retryAfter !== null) {
      const seconds = Number(retryAfter);
      const delay = Number.isFinite(seconds) && seconds >= 0
        ? seconds * 1000
        : Date.parse(retryAfter) - Date.now();
      if (Number.isFinite(delay) && delay >= 0) return Math.min(delay, 24 * 60 * 60 * 1000);
    }
    if (headers.get("x-ratelimit-remaining") === "0") {
      const resetSeconds = Number(headers.get("x-ratelimit-reset"));
      const delay = resetSeconds * 1000 - Date.now();
      if (Number.isFinite(delay) && delay >= 0) return Math.min(delay, 24 * 60 * 60 * 1000);
    }
    return undefined;
  }

  async #getAllPages<T>(target: GitHubApiTarget, token: string, startUrl: string, pathname: string, parse: (body: unknown) => T[]): Promise<T[]> {
    const values: T[] = [];
    const visited = new Set<string>();
    let url: string | undefined = startUrl;
    for (let page = 0; url !== undefined && page < 100; page += 1) {
      if (visited.has(url)) throw new GitHubAppError("GITHUB_PAGINATION_INVALID", "GitHub repeated an observation pagination cursor");
      visited.add(url);
      const { body, response } = await this.#getJson(target, token, url, pathname);
      values.push(...parse(body));
      const next = nextCursor(response, target, pathname, "collection");
      url = next;
    }
    if (url !== undefined) throw new GitHubAppError("GITHUB_PAGINATION_LIMIT", "GitHub observation exceeded the safe pagination limit");
    return values;
  }
}

function mapReview(value: unknown): ObservedReview {
  const review = record(value);
  const user = record(review["user"]);
  const id = stableId(review["id"], "review.id");
  const actorId = (typeof user["id"] === "number" || typeof user["id"] === "string") ? String(user["id"]) : undefined;
  const actorLogin = typeof user["login"] === "string" ? user["login"] : undefined;
  const commitSha = optionalSha(review["commit_id"], "review.commit_id");
  const submittedAt = optionalTimestamp(review["submitted_at"], "review.submitted_at");
  return {
    id,
    ...(actorId === undefined ? {} : { actorId }),
    ...(actorLogin === undefined ? {} : { actorLogin }),
    state: requiredString(review["state"], "review.state"),
    ...(commitSha === undefined ? {} : { commitSha }),
    ...(submittedAt === undefined ? {} : { submittedAt }),
  };
}

function mapCheckRun(value: unknown): ObservedCheckRun {
  const run = record(value);
  const app = record(run["app"]);
  const id = stableId(run["id"], "check_run.id");
  const appId = (typeof app["id"] === "number" || typeof app["id"] === "string") ? String(app["id"]) : undefined;
  const appSlug = typeof app["slug"] === "string" ? app["slug"] : undefined;
  const conclusion = typeof run["conclusion"] === "string" ? run["conclusion"] : undefined;
  const completedAt = optionalTimestamp(run["completed_at"], "check_run.completed_at");
  return {
    id,
    name: requiredString(run["name"], "check_run.name"),
    ...(appId === undefined ? {} : { appId }),
    ...(appSlug === undefined ? {} : { appSlug }),
    headSha: requiredSha(run["head_sha"], "check_run.head_sha"),
    status: requiredString(run["status"], "check_run.status"),
    ...(conclusion === undefined ? {} : { conclusion }),
    ...(completedAt === undefined ? {} : { completedAt }),
  };
}
