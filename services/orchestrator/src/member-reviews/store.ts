import { githubRepositoryPathFromRemote, type ObservedPullRequest } from "@kintsugi/git";
import type { Pool, PoolClient } from "pg";
import { JOB_RUN_QUEUE } from "../queues.js";
import { recordTransition } from "../outbox/store.js";
import type { ReviewContextSnapshot, ReviewInputManifest, ReviewContextSource } from "./inputs.js";
import { validateReviewReport } from "./report.js";
import { reviewKey as canonicalReviewKey, type ReviewAttempt, type ReviewCandidate, type ReviewScheduleInput, type ReviewScheduleStore, type ResolvedReviewKey } from "./schedule.js";

type JsonRecord = Record<string, unknown>;

function jsonRecord(value: unknown, name: string): JsonRecord {
  if (value === null || Array.isArray(value) || typeof value !== "object") throw new TypeError(`${name} is invalid`);
  return value as JsonRecord;
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is invalid`);
  return value;
}

function parseContextSource(value: unknown, index: number): ReviewContextSource {
  const source = jsonRecord(value, `snapshot source ${index}`);
  const availability = source["availability"];
  const publication = source["publication"];
  const approval = source["approval"];
  if (availability !== "present" && availability !== "missing") throw new TypeError(`snapshot source ${index} availability is invalid`);
  if (publication !== "draft" && publication !== "published" && publication !== "unknown") throw new TypeError(`snapshot source ${index} publication is invalid`);
  if (approval !== "approved" && approval !== "pending" && approval !== "rejected" && approval !== "unknown" && approval !== "not-required") {
    throw new TypeError(`snapshot source ${index} approval is invalid`);
  }
  if (typeof source["required"] !== "boolean" || typeof source["readable"] !== "boolean") throw new TypeError(`snapshot source ${index} access metadata is invalid`);
  const commit = source["commit"];
  const contentHash = source["contentHash"];
  if (commit !== undefined && commit !== null && typeof commit !== "string") throw new TypeError(`snapshot source ${index} commit is invalid`);
  if (contentHash !== undefined && contentHash !== null && typeof contentHash !== "string") throw new TypeError(`snapshot source ${index} content hash is invalid`);
  return {
    sourceId: requiredText(source["sourceId"], `snapshot source ${index} id`),
    role: requiredText(source["role"], `snapshot source ${index} role`),
    repositoryId: requiredText(source["repositoryId"], `snapshot source ${index} repository`),
    path: requiredText(source["path"], `snapshot source ${index} path`),
    ...(typeof commit === "string" ? { commit } : {}),
    ...(typeof contentHash === "string" ? { contentHash } : {}),
    availability,
    publication,
    approval,
    required: source["required"],
    readable: source["readable"],
  };
}

function candidate(row: ReviewCandidateRow, agentVersion: string): ReviewCandidate {
  if (row.provider !== "github" && row.provider !== "github-enterprise") throw new TypeError("review candidate provider is unsupported");
  const manifest = jsonRecord(row.snapshot_manifest, "snapshot manifest");
  const deliverables = manifest["requiredDeliverableIds"];
  const sourceValues = manifest["sources"];
  if (!Array.isArray(deliverables) || deliverables.some((id) => typeof id !== "string" || id.trim() === "")) {
    throw new TypeError("review candidate deliverables are invalid");
  }
  if (!Array.isArray(sourceValues)) throw new TypeError("review candidate sources are invalid");
  const policyRevision = requiredText(manifest["policyRevision"], "review candidate policy revision");
  const baseUrl = new URL(row.base_url);
  if (baseUrl.username !== "" || baseUrl.password !== "") throw new TypeError("review candidate provider URL is invalid");
  const host = baseUrl.host.toLowerCase();
  const repositoryPath = githubRepositoryPathFromRemote(row.repository_url, row.provider, row.base_url);
  const task = jsonRecord(row.task, "review candidate task");
  const title = typeof task["title"] === "string" && task["title"].trim() !== ""
    ? task["title"]
    : row.unit_id.split("/").at(-1) ?? row.unit_id;
  const sources = sourceValues.map(parseContextSource);
  const snapshot: ReviewContextSnapshot = {
    snapshotId: row.snapshot_id,
    projectId: row.project_id,
    unitId: row.unit_id,
    contextRevision: row.context_revision,
    policyRevision,
    implementationRepositoryId: row.implementation_repository_id,
    task: { title, requiredDeliverableIds: deliverables as string[] },
    sources,
  };
  const updatedAt = row.provider_updated_at instanceof Date ? row.provider_updated_at.toISOString() : new Date(row.provider_updated_at).toISOString();
  if (!Number.isFinite(Date.parse(updatedAt))) throw new TypeError("review candidate provider time is invalid");
  const htmlUrl = new URL(`${repositoryPath}/pull/${row.pull_request_number}`, `${baseUrl.origin}/`).toString();
  const mergeBaseSha = row.merge_base_sha ?? undefined;
  const testMergeSha = row.test_merge_sha ?? undefined;
  const mergeCommitSha = row.merge_commit_sha ?? undefined;
  const observed: ObservedPullRequest = {
    host,
    repositoryId: row.provider_repository_id,
    repositoryPath,
    pullRequestId: row.provider_pull_request_id,
    number: row.pull_request_number,
    provider: row.provider,
    htmlUrl,
    associationClaimStatus: "absent",
    state: "open",
    draft: false,
    updatedAt,
    headSha: row.head_sha,
    headRef: row.head_ref,
    baseSha: row.base_sha,
    baseRef: row.base_ref,
    ...(mergeBaseSha === undefined ? {} : { mergeBaseSha }),
    ...(testMergeSha === undefined ? {} : { testMergeSha }),
    ...(mergeCommitSha === undefined ? {} : { mergeCommitSha }),
    ...(row.merged_at === null ? {} : { mergedAt: row.merged_at instanceof Date ? row.merged_at.toISOString() : new Date(row.merged_at).toISOString() }),
    reviews: Array.isArray(row.reviews) ? row.reviews as ObservedPullRequest["reviews"] : [],
    checks: Array.isArray(row.checks) ? row.checks as ObservedPullRequest["checks"] : [],
  };
  return {
    key: {
      projectId: row.project_id,
      unitId: row.unit_id,
      implementationRepositoryId: row.implementation_repository_id,
      provider: row.provider,
      host,
      providerRepositoryId: row.provider_repository_id,
      pullRequestId: row.provider_pull_request_id,
      pullRequestNumber: row.pull_request_number,
      headSha: row.head_sha,
      baseSha: row.base_sha,
      ...(row.merge_base_sha === null ? {} : { mergeBaseSha: row.merge_base_sha }),
      contextRevision: row.context_revision,
      policyRevision,
      agentVersion,
    },
    observed,
    snapshot,
  };
}

interface ReviewRow {
  review_id: string;
  review_key: string;
  generation: number;
  job_run_id: string | null;
  project_id: string;
  unit_id: string;
  implementation_repository_id: string;
  provider: "github" | "github-enterprise";
  provider_repository_id: string;
  provider_pull_request_id: string;
  pull_request_number: number;
  head_sha: string;
  base_sha: string;
  merge_base_sha: string;
  context_revision: string;
  policy_revision: string;
  agent_version: string;
  status: ReviewAttempt["status"];
  currentness: ReviewAttempt["currentness"];
  base_url: string;
  snapshot_id: string | null;
  input_manifest: ReviewInputManifest;
}

interface ReviewCandidateRow {
  project_id: string;
  unit_id: string;
  implementation_repository_id: string;
  provider: "github" | "github-enterprise";
  base_url: string;
  repository_url: string;
  provider_repository_id: string;
  provider_pull_request_id: string;
  pull_request_number: number;
  head_sha: string;
  head_ref: string;
  base_sha: string;
  base_ref: string;
  merge_base_sha: string | null;
  test_merge_sha: string | null;
  merge_commit_sha: string | null;
  provider_updated_at: Date | string;
  merged_at: Date | string | null;
  reviews: unknown;
  checks: unknown;
  snapshot_id: string;
  context_revision: string;
  snapshot_manifest: unknown;
  task: unknown;
}

const REVIEW_SELECT = `
  select review.review_id, review.review_key, review.generation, review.job_run_id,
         review.project_id, review.unit_id, review.implementation_repository_id,
         review.provider, review.provider_repository_id, review.provider_pull_request_id,
         review.pull_request_number, review.head_sha, review.base_sha, review.merge_base_sha,
         review.context_revision, review.policy_revision, review.agent_version,
         review.status, review.currentness, server.base_url, review.snapshot_id, review.input_manifest
    from workflow.member_review as review
    join admin.git_server as server on server.id = review.server_id`;

function attempt(row: ReviewRow): ReviewAttempt {
  let host: string;
  try {
    host = new URL(row.base_url).host.toLowerCase();
  } catch {
    throw new Error("stored GitHub server URL is invalid");
  }
  const key: ResolvedReviewKey = {
    projectId: row.project_id,
    unitId: row.unit_id,
    implementationRepositoryId: row.implementation_repository_id,
    provider: row.provider,
    host,
    providerRepositoryId: row.provider_repository_id,
    pullRequestId: row.provider_pull_request_id,
    pullRequestNumber: row.pull_request_number,
    headSha: row.head_sha,
    baseSha: row.base_sha,
    mergeBaseSha: row.merge_base_sha,
    contextRevision: row.context_revision,
    policyRevision: row.policy_revision,
    agentVersion: row.agent_version,
  };
  return {
    reviewId: row.review_id,
    jobRunId: row.job_run_id,
    reviewKey: row.review_key,
    generation: row.generation,
    status: row.status,
    currentness: row.currentness,
    key,
  };
}

function assertInput(input: ReviewScheduleInput): void {
  if (canonicalReviewKey(input.key) !== input.reviewKey) throw new TypeError("review key hash does not match its revision identity");
  const manifest = input.manifest;
  const key = input.key;
  if (manifest.projectId !== key.projectId || manifest.unitId !== key.unitId ||
      manifest.pullRequest.provider !== key.provider || manifest.pullRequest.host.toLowerCase() !== key.host.toLowerCase() ||
      manifest.pullRequest.repositoryId !== key.providerRepositoryId || manifest.pullRequest.pullRequestId !== key.pullRequestId ||
      manifest.pullRequest.number !== key.pullRequestNumber || manifest.headSha !== key.headSha || manifest.baseSha !== key.baseSha ||
      manifest.mergeBaseSha !== key.mergeBaseSha || manifest.contextRevision !== key.contextRevision || manifest.policyRevision !== key.policyRevision) {
    throw new TypeError("review input manifest does not match its revision identity");
  }
  if (manifest.snapshotId.trim() === "") throw new TypeError("review input snapshot id is invalid");
}

function reviewIdentity(key: ResolvedReviewKey): string {
  return JSON.stringify([key.host.toLowerCase(), key.providerRepositoryId, key.pullRequestId]);
}

export class ReviewScheduleRejectedError extends Error {
  constructor() {
    super("review target is no longer current, confirmed or retained");
    this.name = "ReviewScheduleRejectedError";
  }
}

/** Transactional review/job/outbox store. It never puts a source checkout or credential in the job. */
export class PostgresMemberReviewStore implements ReviewScheduleStore {
  constructor(private readonly pool: Pool) {}

  async findByKey(keyHash: string): Promise<ReviewAttempt | undefined> {
    const result = await this.pool.query<ReviewRow>(`${REVIEW_SELECT} where review.review_key = $1 order by review.generation desc limit 1`, [keyHash]);
    const row = result.rows[0];
    return row === undefined ? undefined : attempt(row);
  }

  /** Confirmed, open PRs with the exact current implementation snapshot and no automatic attempt yet. */
  async candidates(agentVersion: string, limit = 50): Promise<ReviewCandidate[]> {
    if (agentVersion.trim() === "" || agentVersion.length > 512) throw new TypeError("review agent version is invalid");
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError("review candidate limit must be from 1 to 500");
    const result = await this.pool.query<ReviewCandidateRow>(
      `select association.project_id, association.unit_id, association.repository_id as implementation_repository_id,
              server.kind as provider, server.base_url, repository.url as repository_url,
              observation.provider_repository_id, observation.provider_pull_request_id, observation.pull_request_number,
              observation.head_sha, observation.head_ref, observation.base_sha, observation.base_ref,
              observation.merge_base_sha, observation.test_merge_sha, observation.merge_commit_sha,
              observation.provider_updated_at, observation.merged_at, observation.reviews, observation.checks,
              snapshot.snapshot_id, snapshot.context_revision, snapshot.manifest as snapshot_manifest, snapshot.task
         from workflow.member_task_pull_request as association
         join workflow.member_provider_observation as observation
           on observation.server_id = association.server_id
          and observation.repository_id = association.repository_id
          and observation.provider_repository_id = association.provider_repository_id
          and observation.provider_pull_request_id = association.provider_pull_request_id
          and observation.pull_request_number = association.pull_request_number
         join admin.git_server as server on server.id = association.server_id
         join admin.git_repository as repository
           on repository.id = association.repository_id and repository.server_id = association.server_id
         join admin.project_repository as project_repository
           on project_repository.project_id = association.project_id
          and project_repository.repository_id = association.repository_id
          and project_repository.application_id = split_part(association.unit_id, '/', 1)
          and project_repository.role = 'target'
         join lateral (
           select snapshot.snapshot_id, snapshot.context_revision, snapshot.manifest, snapshot.task
             from delivery.member_snapshot as snapshot
            where snapshot.project_id = association.project_id
              and snapshot.unit_id = association.unit_id
              and snapshot.context_revision = association.context_revision
              and snapshot.activity = 'implementation'
              and snapshot.status = 'ready' and snapshot.pin_state = 'retained'
              and snapshot.expires_at > clock_timestamp()
              and snapshot.manifest->'requiredDeliverableIds' = association.deliverable_ids
            order by snapshot.ready_at desc, snapshot.snapshot_id desc
            limit 1
         ) as snapshot on true
        where association.association_state = 'confirmed'
          and association.context_revision is not null
          and server.kind in ('github', 'github-enterprise')
          and observation.state = 'open' and observation.is_draft = false
          and not exists (
            select 1 from workflow.member_review as prior
             where prior.server_id = association.server_id
               and prior.provider_repository_id = association.provider_repository_id
               and prior.provider_pull_request_id = association.provider_pull_request_id
               and prior.project_id = association.project_id and prior.unit_id = association.unit_id
               and prior.head_sha = observation.head_sha and prior.base_sha = observation.base_sha
               and prior.context_revision = association.context_revision
               and prior.policy_revision = snapshot.manifest->>'policyRevision'
               and prior.agent_version = $1
          )
        order by association.updated_at, observation.provider_updated_at, association.project_id, association.unit_id
        limit $2`,
      [agentVersion, limit],
    );
    return result.rows.map((row) => candidate(row, agentVersion));
  }

  async findByJobRun(jobRunId: string): Promise<ReviewAttempt | undefined> {
    const result = await this.pool.query<ReviewRow>(`${REVIEW_SELECT} where review.job_run_id = $1 limit 1`, [jobRunId]);
    const row = result.rows[0];
    return row === undefined ? undefined : attempt(row);
  }

  /** Idempotently moves a queued attempt to running and writes its project event. */
  async markRunning(jobRunId: string): Promise<ReviewAttempt | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query<ReviewRow>(`${REVIEW_SELECT} where review.job_run_id = $1 for update of review`, [jobRunId]);
      const row = result.rows[0];
      if (row === undefined || row.status !== "queued") {
        await client.query("commit");
        return row === undefined ? undefined : attempt(row);
      }
      await recordTransition(client, {
        transitionKey: `member-review:${row.review_id}:running`,
        projectId: row.project_id,
        unitId: row.unit_id,
        event: { kind: "member.review.running", metadata: { reviewId: row.review_id, generation: row.generation, headSha: row.head_sha } },
      }, async (tx) => {
        await tx.query(
          "update workflow.member_review set status = 'running', started_at = clock_timestamp() where review_id = $1 and status = 'queued'",
          [row.review_id],
        );
      });
      await client.query("commit");
      return { ...attempt(row), status: "running" };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Validates the runtime output and rechecks PR, association and snapshot currentness under locks. */
  async complete(jobRunId: string, value: unknown): Promise<"succeeded" | "failed" | "inconclusive"> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query<ReviewRow>(`${REVIEW_SELECT} where review.job_run_id = $1 for update of review`, [jobRunId]);
      const row = result.rows[0];
      if (row === undefined) {
        await client.query("commit");
        return "failed";
      }
      if (row.status !== "queued" && row.status !== "running") {
        await client.query("commit");
        return row.status;
      }

      const report = validateReviewReport(value, attempt(row), row.input_manifest);
      const targetCurrent = row.currentness === "current" && await this.targetIsCurrent(client, row);
      if (report === undefined) {
        await this.finish(client, row, {
          status: "failed",
          currentness: targetCurrent ? "current" : "superseded",
          failureCode: "INVALID_REPORT",
        });
        await client.query("commit");
        return "failed";
      }

      const reportCurrent = report.currentness === "current" && targetCurrent;
      const currentness = reportCurrent ? "current"
        : !targetCurrent || report.currentness === "superseded" || row.currentness === "superseded" ? "superseded"
          : "inconclusive";
      const verdict = reportCurrent ? report.verdict : "inconclusive";
      const status = reportCurrent && verdict !== "inconclusive" ? "succeeded" : "inconclusive";
      const storedReport = { ...report, currentness, verdict };
      await this.finish(client, row, { status, currentness, coverage: report.coverage, verdict, report: storedReport });
      await client.query("commit");
      return status;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async fail(jobRunId: string, failureCode: string): Promise<void> {
    if (!/^[A-Z][A-Z0-9_]{0,99}$/.test(failureCode)) throw new TypeError("review failure code is invalid");
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query<ReviewRow>(`${REVIEW_SELECT} where review.job_run_id = $1 for update of review`, [jobRunId]);
      const row = result.rows[0];
      if (row === undefined || (row.status !== "queued" && row.status !== "running")) {
        await client.query("commit");
        return;
      }
      const targetCurrent = row.currentness === "current" && await this.targetIsCurrent(client, row);
      await this.finish(client, row, { status: "failed", currentness: targetCurrent ? "current" : "superseded", failureCode });
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** The outbox may have published before a worker restart; singleton job ids make re-enqueue safe. */
  async queuedJobRuns(limit = 100): Promise<string[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError("review recovery limit must be from 1 to 500");
    const result = await this.pool.query<{ job_run_id: string }>(
      `select review.job_run_id
         from workflow.member_review as review
         join workflow.job_run as job on job.id = review.job_run_id
        where review.status = 'queued' and job.status = 'queued'
        order by review.created_at, review.review_id limit $1`,
      [limit],
    );
    return result.rows.map((row) => row.job_run_id);
  }

  /** Finishes reviews whose generic job reached a terminal state before the worker persisted its report. */
  async terminalJobRuns(limit = 100): Promise<string[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError("review recovery limit must be from 1 to 500");
    const result = await this.pool.query<{ job_run_id: string }>(
      `select review.job_run_id
         from workflow.member_review as review
         join workflow.job_run as job on job.id = review.job_run_id
        where review.status in ('queued', 'running') and job.status in ('succeeded', 'failed', 'cancelled')
        order by review.created_at, review.review_id limit $1`,
      [limit],
    );
    return result.rows.map((row) => row.job_run_id);
  }

  async schedule(input: ReviewScheduleInput): Promise<{ created: boolean; attempt: ReviewAttempt }> {
    assertInput(input);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [reviewIdentity(input.key)]);

      const duplicate = await client.query<ReviewRow>(
        `${REVIEW_SELECT} where review.review_key = $1 order by review.generation desc limit 1 for update of review`,
        [input.reviewKey],
      );
      if (input.reason === "automatic" && duplicate.rows[0] !== undefined) {
        await client.query("commit");
        return { created: false, attempt: attempt(duplicate.rows[0]) };
      }

      const current = await client.query<{ provider: string; base_url: string }>(
        `select server.kind as provider, server.base_url
           from workflow.member_task_pull_request as association
           join workflow.member_provider_observation as observation
             on observation.server_id = association.server_id
            and observation.repository_id = association.repository_id
            and observation.provider_repository_id = association.provider_repository_id
            and observation.provider_pull_request_id = association.provider_pull_request_id
            and observation.pull_request_number = association.pull_request_number
           join admin.git_server as server on server.id = association.server_id
           join admin.project_repository as project_repository
             on project_repository.project_id = association.project_id
            and project_repository.repository_id = association.repository_id
            and project_repository.application_id = split_part(association.unit_id, '/', 1)
            and project_repository.role = 'target'
           join delivery.member_snapshot as snapshot
             on snapshot.snapshot_id = $10
            and snapshot.project_id = association.project_id
            and snapshot.unit_id = association.unit_id
            and snapshot.context_revision = association.context_revision
          where association.association_state = 'confirmed'
            and association.project_id = $1 and association.unit_id = $2
            and association.repository_id = $3 and association.server_id = $4
            and association.provider_repository_id = $5 and association.provider_pull_request_id = $6
            and association.pull_request_number = $7 and association.context_revision = $8
            and (association.target_branch is null or association.target_branch = observation.base_ref)
            and association.deliverable_ids = snapshot.manifest->'requiredDeliverableIds'
            and observation.state = 'open' and observation.is_draft = false
            and observation.head_sha = $9 and observation.base_sha = $11
            and server.kind = $12
            and snapshot.activity = 'implementation' and snapshot.status = 'ready'
            and snapshot.pin_state = 'retained' and snapshot.expires_at > clock_timestamp()
            and snapshot.manifest->>'policyRevision' = $13
          for update of association, observation, snapshot`,
        [input.key.projectId, input.key.unitId, input.key.implementationRepositoryId, await this.repositoryServer(client, input.key.implementationRepositoryId), input.key.providerRepositoryId, input.key.pullRequestId, input.key.pullRequestNumber, input.key.contextRevision, input.key.headSha, input.manifest.snapshotId, input.key.baseSha, input.key.provider, input.key.policyRevision],
      );
      const currentRow = current.rows[0];
      if (currentRow === undefined || !this.hostMatches(currentRow.base_url, input.key.host)) throw new ReviewScheduleRejectedError();

      const generationResult = await client.query<{ generation: number }>(
        `select coalesce(max(generation), 0) + 1 as generation
           from workflow.member_review
          where server_id = $1 and provider_repository_id = $2 and provider_pull_request_id = $3`,
        [await this.repositoryServer(client, input.key.implementationRepositoryId), input.key.providerRepositoryId, input.key.pullRequestId],
      );
      const generation = generationResult.rows[0]?.generation;
      if (generation === undefined) throw new Error("failed to allocate review generation");
      const review: ReviewAttempt = {
        reviewId: input.reviewId,
        jobRunId: input.jobRunId,
        reviewKey: input.reviewKey,
        generation,
        status: "queued",
        currentness: "current",
        key: input.key,
      };

      const serverId = await this.repositoryServer(client, input.key.implementationRepositoryId);
      await recordTransition(client, {
        transitionKey: `member-review:${input.reviewId}:scheduled`,
        projectId: input.key.projectId,
        unitId: input.key.unitId,
        event: {
          kind: "member.review.queued",
          metadata: { reviewId: input.reviewId, generation, jobRunId: input.jobRunId, headSha: input.key.headSha, contextRevision: input.key.contextRevision },
        },
        queueIntents: [{ intentKey: `job-run:${input.jobRunId}`, queue: JOB_RUN_QUEUE, payload: { jobRunId: input.jobRunId } }],
      }, async (tx: PoolClient) => {
        await tx.query(
          `update workflow.member_review set currentness = 'superseded'
            where server_id = $1 and provider_repository_id = $2 and provider_pull_request_id = $3 and currentness = 'current'`,
          [serverId, input.key.providerRepositoryId, input.key.pullRequestId],
        );
        await tx.query(
          `insert into workflow.job_run
             (id, project_id, application_id, parent_id, kind, name, source_repository_id, source_commit, inputs, limits, agent, actor)
           values ($1, $2, null, null, 'agent', 'gate-reviewer', null, null, $3, $4, $5, 'kintsugi')`,
          [input.jobRunId, input.key.projectId, JSON.stringify(input.jobInputs(review)), JSON.stringify({ timeoutSec: 1800, maxOutputBytes: 8 * 1024 * 1024 }), `gate-reviewer@${input.key.agentVersion}`],
        );
        await tx.query(
          `insert into workflow.member_review
             (review_id, review_key, generation, project_id, unit_id, implementation_repository_id, server_id,
              provider, provider_repository_id, provider_pull_request_id, pull_request_number, snapshot_id,
              head_sha, base_sha, merge_base_sha, context_revision, policy_revision, agent_version,
              status, currentness, input_manifest, job_run_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
                   'queued', 'current', $19, $20)`,
          [input.reviewId, input.reviewKey, generation, input.key.projectId, input.key.unitId, input.key.implementationRepositoryId, serverId,
            input.key.provider, input.key.providerRepositoryId, input.key.pullRequestId, input.key.pullRequestNumber, input.manifest.snapshotId,
            input.key.headSha, input.key.baseSha, input.key.mergeBaseSha, input.key.contextRevision, input.key.policyRevision, input.key.agentVersion,
            JSON.stringify(input.manifest), input.jobRunId],
        );
        await tx.query(
          `insert into delivery.member_snapshot_lease (lease_id, snapshot_id, purpose, owner_id, expires_at)
           values (gen_random_uuid(), $1, 'review', $2, null)
           on conflict (snapshot_id, purpose, owner_id) do update set expires_at = null`,
          [input.manifest.snapshotId, input.reviewId],
        );
      });
      await client.query("commit");
      return { created: true, attempt: review };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async targetIsCurrent(client: PoolClient, row: ReviewRow): Promise<boolean> {
    if (row.snapshot_id === null) return false;
    const result = await client.query<{ base_url: string }>(
      `select server.base_url
         from workflow.member_review as review
         join workflow.member_task_pull_request as association
           on association.server_id = review.server_id
          and association.repository_id = review.implementation_repository_id
          and association.provider_repository_id = review.provider_repository_id
          and association.provider_pull_request_id = review.provider_pull_request_id
          and association.pull_request_number = review.pull_request_number
          and association.project_id = review.project_id and association.unit_id = review.unit_id
         join workflow.member_provider_observation as observation
           on observation.server_id = association.server_id
          and observation.repository_id = association.repository_id
          and observation.provider_repository_id = association.provider_repository_id
          and observation.provider_pull_request_id = association.provider_pull_request_id
          and observation.pull_request_number = association.pull_request_number
         join admin.git_server as server on server.id = review.server_id
         join admin.project_repository as project_repository
           on project_repository.project_id = review.project_id
          and project_repository.repository_id = review.implementation_repository_id
          and project_repository.application_id = split_part(review.unit_id, '/', 1)
          and project_repository.role = 'target'
         join delivery.member_snapshot as snapshot
           on snapshot.snapshot_id = review.snapshot_id
          and snapshot.project_id = review.project_id and snapshot.unit_id = review.unit_id
          and snapshot.context_revision = review.context_revision
        where review.review_id = $1
          and association.association_state = 'confirmed'
          and association.context_revision = review.context_revision
          and association.deliverable_ids = snapshot.manifest->'requiredDeliverableIds'
          and (association.target_branch is null or association.target_branch = observation.base_ref)
          and observation.state = 'open' and observation.is_draft = false
          and observation.head_sha = review.head_sha and observation.base_sha = review.base_sha
          and server.kind = review.provider
          and server.base_url is not null
          and snapshot.activity = 'implementation' and snapshot.status = 'ready' and snapshot.pin_state = 'retained'
          and snapshot.manifest->>'policyRevision' = review.policy_revision
        for update of association, observation, snapshot`,
      [row.review_id],
    );
    const current = result.rows[0];
    return current !== undefined && this.hostMatches(current.base_url, attempt(row).key.host);
  }

  private async finish(
    client: PoolClient,
    row: ReviewRow,
    outcome: {
      status: "succeeded" | "failed" | "inconclusive";
      currentness: ReviewAttempt["currentness"];
      coverage?: "complete" | "partial";
      verdict?: "pass" | "fail" | "inconclusive";
      report?: unknown;
      failureCode?: string;
    },
  ): Promise<void> {
    const eventKind = outcome.status === "failed" ? "member.review.failed"
      : outcome.status === "inconclusive" ? "member.review.inconclusive" : "member.review.completed";
    const metadata = {
      reviewId: row.review_id,
      generation: row.generation,
      headSha: row.head_sha,
      currentness: outcome.currentness,
      status: outcome.status,
      ...(outcome.verdict === undefined ? {} : { verdict: outcome.verdict }),
      ...(outcome.failureCode === undefined ? {} : { failureCode: outcome.failureCode }),
    };
    await recordTransition(client, {
      transitionKey: `member-review:${row.review_id}:finished`,
      projectId: row.project_id,
      unitId: row.unit_id,
      event: { kind: eventKind, metadata },
    }, async (tx) => {
      await tx.query(
        `update workflow.member_review
            set status = $2, currentness = $3, coverage = $4, verdict = $5,
                report = $6::jsonb, failure_code = $7, finished_at = clock_timestamp()
          where review_id = $1 and status in ('queued', 'running')`,
        [row.review_id, outcome.status, outcome.currentness, outcome.coverage ?? null, outcome.verdict ?? null,
          outcome.report === undefined ? null : JSON.stringify(outcome.report), outcome.failureCode ?? null],
      );
      if (row.snapshot_id !== null) {
        await tx.query("delete from delivery.member_snapshot_lease where snapshot_id = $1 and purpose = 'review' and owner_id = $2", [row.snapshot_id, row.review_id]);
      }
    });
  }

  private async repositoryServer(client: PoolClient, repositoryId: string): Promise<string> {
    const result = await client.query<{ server_id: string }>("select server_id from admin.git_repository where id = $1", [repositoryId]);
    const serverId = result.rows[0]?.server_id;
    if (serverId === undefined) throw new ReviewScheduleRejectedError();
    return serverId;
  }

  private hostMatches(baseUrl: string, expectedHost: string): boolean {
    try {
      return new URL(baseUrl).host.toLowerCase() === expectedHost.toLowerCase();
    } catch {
      return false;
    }
  }
}
