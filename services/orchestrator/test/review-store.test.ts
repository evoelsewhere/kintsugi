import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ReviewInputManifest } from "../src/member-reviews/inputs.js";
import { reviewKey, type ResolvedReviewKey, type ReviewScheduleInput } from "../src/member-reviews/schedule.js";
import { PostgresMemberReviewStore } from "../src/member-reviews/store.js";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./support/database.js";

const contextRevision = `sha256:${"1".repeat(64)}`;
const snapshotId = "ctx_0199abc0-1234-7123-8123-123456789abc";

describe.skipIf(!hasDatabase)("Postgres member review scheduling (integration)", () => {
  let db: TestDatabase;
  let store: PostgresMemberReviewStore;
  let nextNumber = 100;

  beforeAll(async () => {
    db = await createTestDatabase();
    store = new PostgresMemberReviewStore(db.pool);
    await db.pool.query("insert into core.app_user (id, username, password_hash, password_salt) values ('review-admin', 'review-admin', 'test-hash', 'test-salt')");
    await db.pool.query("insert into admin.project (id, name) values ('billing', 'Billing')");
    await db.pool.query("insert into admin.application (project_id, id, name, disposition) values ('billing', 'billing-api', 'Billing API', 'refactor')");
    await db.pool.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('review-store-server', 'github', 'GitHub', 'https://github.com', 'none')");
    await db.pool.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('review-store-code', 'review-store-server', 'https://github.com/Acme/Billing.git', 'main')");
    await db.pool.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('review-store-docs-server', 'plain-git', 'Docs', 'https://docs.example', 'none')");
    await db.pool.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('review-store-docs', 'review-store-docs-server', 'https://docs.example/Billing.git', 'main')");
    await db.pool.query("insert into admin.project_repository (project_id, application_id, repository_id, role, component) values ('billing', 'billing-api', 'review-store-code', 'target', 'billing-api')");
    await db.pool.query("insert into admin.project_repository (project_id, repository_id, role) values ('billing', 'review-store-docs', 'document')");
    await db.pool.query(
      `insert into delivery.member_snapshot
         (snapshot_id, project_id, unit_id, activity, requested_by_user_id, context_revision, task, readiness,
          manifest, status, pin_state, created_at, expires_at, ready_at)
       values ($1, 'billing', 'billing-api/tax/calculate', 'implementation', 'review-admin', $2,
          '{"title":"Tax rounding"}'::jsonb, '{}'::jsonb,
          '{"requiredDeliverableIds":["code:tax"],"policyRevision":"review-policy-v1","sources":[]}'::jsonb,
          'ready', 'retained', clock_timestamp(), clock_timestamp() + interval '1 day', clock_timestamp())`,
      [snapshotId, contextRevision],
    );
  });

  afterAll(async () => db?.drop());

  async function seedPullRequest(headSha = "a".repeat(40)): Promise<ResolvedReviewKey> {
    const number = nextNumber++;
    const pullRequestId = `review-store-pr-${number}`;
    await db.pool.query(
      `insert into workflow.member_provider_observation
         (server_id, repository_id, provider_repository_id, provider_pull_request_id, pull_request_number,
          state, is_draft, head_sha, head_ref, base_sha, base_ref, provider_updated_at)
       values ('review-store-server', 'review-store-code', '42', $1, $2, 'open', false, $3,
          'feature/tax', $4, 'main', clock_timestamp())`,
      [pullRequestId, number, headSha, "b".repeat(40)],
    );
    await db.pool.query(
      `insert into workflow.member_task_pull_request
         (server_id, repository_id, provider_repository_id, provider_pull_request_id, pull_request_number,
          project_id, unit_id, association_state, association_source, context_revision, target_branch,
          deliverable_ids, confirmed_by, confirmed_at)
       values ('review-store-server', 'review-store-code', '42', $1, $2, 'billing',
          'billing-api/tax/calculate', 'confirmed', 'maintainer', $3, 'main', '["code:tax"]'::jsonb,
          'review-admin', clock_timestamp())`,
      [pullRequestId, number, contextRevision],
    );
    return {
      projectId: "billing",
      unitId: "billing-api/tax/calculate",
      implementationRepositoryId: "review-store-code",
      provider: "github",
      host: "github.com",
      providerRepositoryId: "42",
      pullRequestId,
      pullRequestNumber: number,
      headSha,
      baseSha: "b".repeat(40),
      mergeBaseSha: "b".repeat(40),
      contextRevision,
      policyRevision: "review-policy-v1",
      agentVersion: "1.0.0",
    };
  }

  function input(key: ResolvedReviewKey, reason: ReviewScheduleInput["reason"], suffix: string): ReviewScheduleInput {
    const jobRunId = randomUUID();
    return {
      key,
      reviewKey: reviewKey(key),
      reason,
      reviewId: `rev_${randomUUID()}`,
      jobRunId,
      manifest: {
        schemaVersion: "1",
        projectId: key.projectId,
        unitId: key.unitId,
        snapshotId,
        contextRevision: key.contextRevision,
        policyRevision: key.policyRevision,
        pullRequest: { provider: key.provider, host: key.host, repositoryId: key.providerRepositoryId, pullRequestId: key.pullRequestId, number: key.pullRequestNumber },
        headSha: key.headSha,
        baseSha: key.baseSha,
        mergeBaseSha: key.mergeBaseSha,
        changedFileCount: 1,
        changedFiles: [{ path: "src/tax.ts", status: "M", binary: false, generated: false, mode: { old: "100644", next: "100644" } }],
        omittedChangedFileCount: 0,
        patchPath: "changes.patch",
        patchBytes: 100,
        sources: [],
        task: { title: "Tax rounding", objective: "Use decimal arithmetic.", acceptanceCriteria: ["Round half up"], requiredDeliverableIds: ["code:tax"] },
        coverage: { status: "complete", generatedFiles: 0, binaryFiles: 0, submodules: 0, symlinks: 0, excludedFiles: [], sourceExclusions: [], incompleteReasons: [] },
      } satisfies ReviewInputManifest,
      outputSchema: { type: "object" },
      jobInputs: (attempt) => ({ task: `Review ${suffix}`, schema: { type: "object" }, expectedAgentVersion: attempt.key.agentVersion }),
    };
  }

  function reportFor(attempt: Awaited<ReturnType<PostgresMemberReviewStore["schedule"]>>["attempt"]) {
    return {
      schemaVersion: "1",
      projectId: attempt.key.projectId,
      unitId: attempt.key.unitId,
      reviewId: attempt.reviewId,
      generation: attempt.generation,
      currentness: "current",
      verdict: "pass",
      reviewedHead: attempt.key.headSha,
      reviewedBase: attempt.key.baseSha,
      mergeBase: attempt.key.mergeBaseSha,
      contextRevision: attempt.key.contextRevision,
      policyRevision: attempt.key.policyRevision,
      agentVersion: attempt.key.agentVersion,
      coverage: "complete",
      findings: [],
    };
  }

  it("atomically suppresses duplicates, allocates reruns and revisions, and emits one job outbox intent per generation", async () => {
    const firstKey = await seedPullRequest();
    const first = await store.schedule(input(firstKey, "automatic", "first"));
    const duplicate = await store.schedule(input(firstKey, "automatic", "duplicate"));
    const rerun = await store.schedule(input(firstKey, "authorized-rerun", "rerun"));

    expect(first).toMatchObject({ created: true, attempt: { generation: 1, status: "queued", currentness: "current" } });
    expect(duplicate).toMatchObject({ created: false, attempt: { reviewId: first.attempt.reviewId, generation: 1 } });
    expect(rerun).toMatchObject({ created: true, attempt: { generation: 2, currentness: "current" } });
    const rows = await db.pool.query<{ currentness: string; status: string }>(
      `select currentness, status from workflow.member_review where provider_pull_request_id = $1 order by generation`,
      [firstKey.pullRequestId],
    );
    expect(rows.rows).toEqual([{ currentness: "superseded", status: "queued" }, { currentness: "current", status: "queued" }]);

    const jobs = await db.pool.query<{ id: string; source_repository_id: string | null; name: string; inputs: Record<string, unknown> }>(
      "select id, source_repository_id, name, inputs from workflow.job_run where id = any($1)",
      [[first.attempt.jobRunId, rerun.attempt.jobRunId]],
    );
    expect(jobs.rows).toHaveLength(2);
    expect(jobs.rows.every((job) => job.name === "gate-reviewer" && job.source_repository_id === null)).toBe(true);
    expect(jobs.rows.every((job) => !JSON.stringify(job.inputs).toLowerCase().includes("token"))).toBe(true);

    const outbox = await db.pool.query<{ queue: string; payload: Record<string, unknown> }>(
      `select queue, payload from workflow.outbox where payload->>'jobRunId' = any($1) order by created_at`,
      [[first.attempt.jobRunId, rerun.attempt.jobRunId]],
    );
    expect(outbox.rows).toHaveLength(2);
    expect(outbox.rows.every((operation) => operation.queue === "job-run")).toBe(true);
    const leases = await db.pool.query<{ count: number }>(
      "select count(*)::int as count from delivery.member_snapshot_lease where snapshot_id = $1 and purpose = 'review'",
      [snapshotId],
    );
    expect(leases.rows[0]?.count).toBe(2);
  });

  it("rejects a stale provider head and leaves no job, review, lease or outbox intent", async () => {
    const current = await seedPullRequest();
    const stale = { ...current, headSha: "c".repeat(40) };
    const staleInput = input(stale, "automatic", "stale");

    await expect(store.schedule(staleInput)).rejects.toThrow(/no longer current/);
    const review = await db.pool.query("select 1 from workflow.member_review where provider_pull_request_id = $1", [current.pullRequestId]);
    expect(review.rows).toHaveLength(0);
    const lease = await db.pool.query(
      "select 1 from delivery.member_snapshot_lease where snapshot_id = $1 and purpose = 'review' and owner_id = $2",
      [snapshotId, staleInput.reviewId],
    );
    expect(lease.rows).toHaveLength(0);
  });

  it("loads only current confirmed open PRs and suppresses them after one review is scheduled", async () => {
    const current = await seedPullRequest();
    const candidates = await store.candidates("1.0.0");
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: expect.objectContaining({ projectId: "billing", unitId: current.unitId, pullRequestId: current.pullRequestId, agentVersion: "1.0.0" }),
        snapshot: expect.objectContaining({ snapshotId, policyRevision: "review-policy-v1", task: { title: "Tax rounding", requiredDeliverableIds: ["code:tax"] } }),
        observed: expect.objectContaining({ state: "open", draft: false, provider: "github" }),
      }),
    ]));

    const scheduled = await store.schedule(input(current, "automatic", "candidate"));
    const next = await store.candidates("1.0.0");
    expect(next.some((candidate) => candidate.key.pullRequestId === current.pullRequestId)).toBe(false);
    expect(scheduled.created).toBe(true);
  });

  it("persists a validated current report and releases its snapshot lease", async () => {
    const key = await seedPullRequest();
    const scheduled = await store.schedule(input(key, "automatic", "complete"));
    const jobRunId = scheduled.attempt.jobRunId;
    if (jobRunId === null) throw new Error("scheduled review has no job run");
    await store.markRunning(jobRunId);

    const status = await store.complete(jobRunId, reportFor(scheduled.attempt));

    expect(status).toBe("succeeded");
    const row = await db.pool.query<{ status: string; currentness: string; verdict: string; report: Record<string, unknown> }>(
      "select status, currentness, verdict, report from workflow.member_review where review_id = $1",
      [scheduled.attempt.reviewId],
    );
    expect(row.rows[0]).toMatchObject({ status: "succeeded", currentness: "current", verdict: "pass", report: { reviewId: scheduled.attempt.reviewId } });
    const leases = await db.pool.query<{ count: number }>(
      "select count(*)::int as count from delivery.member_snapshot_lease where snapshot_id = $1 and purpose = 'review' and owner_id = $2",
      [snapshotId, scheduled.attempt.reviewId],
    );
    expect(leases.rows[0]?.count).toBe(0);
  });

  it("downgrades a report if the provider head changed while review was running", async () => {
    const key = await seedPullRequest();
    const scheduled = await store.schedule(input(key, "automatic", "stale-result"));
    const jobRunId = scheduled.attempt.jobRunId;
    if (jobRunId === null) throw new Error("scheduled review has no job run");
    await store.markRunning(jobRunId);
    await db.pool.query(
      `update workflow.member_provider_observation set head_sha = $2
        where server_id = 'review-store-server' and provider_repository_id = $1 and provider_pull_request_id = $3`,
      [key.providerRepositoryId, "c".repeat(40), key.pullRequestId],
    );

    const status = await store.complete(jobRunId, reportFor(scheduled.attempt));

    expect(status).toBe("inconclusive");
    const row = await db.pool.query<{ currentness: string; verdict: string; report: Record<string, unknown> }>(
      "select currentness, verdict, report from workflow.member_review where review_id = $1",
      [scheduled.attempt.reviewId],
    );
    expect(row.rows[0]).toMatchObject({ currentness: "superseded", verdict: "inconclusive", report: { currentness: "superseded", verdict: "inconclusive" } });
  });

  it("fails invalid reports and runtime failures while releasing the snapshot lease", async () => {
    const key = await seedPullRequest();
    const scheduled = await store.schedule(input(key, "automatic", "invalid-report"));
    const jobRunId = scheduled.attempt.jobRunId;
    if (jobRunId === null) throw new Error("scheduled review has no job run");
    await store.markRunning(jobRunId);
    expect(await store.complete(jobRunId, { ...reportFor(scheduled.attempt), reviewedHead: "f".repeat(40) })).toBe("failed");
    await store.fail(jobRunId, "JOB_FAILED");

    const row = await db.pool.query<{ failure_code: string; report: unknown }>(
      "select failure_code, report from workflow.member_review where review_id = $1",
      [scheduled.attempt.reviewId],
    );
    expect(row.rows[0]).toEqual({ failure_code: "INVALID_REPORT", report: null });
    const leases = await db.pool.query<{ count: number }>(
      "select count(*)::int as count from delivery.member_snapshot_lease where snapshot_id = $1 and purpose = 'review' and owner_id = $2",
      [snapshotId, scheduled.attempt.reviewId],
    );
    expect(leases.rows[0]?.count).toBe(0);
  });
});
