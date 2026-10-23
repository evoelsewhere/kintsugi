import type { Pool, PoolClient } from "pg";
import type { ObservedPullRequest } from "@kintsugi/git";
import {
  readMemberAssociationContext,
  validateMemberAssociationClaim,
  validateMemberAssociationClaimForTask,
} from "@kintsugi/domain";
import type { ProviderSyncDelivery, ProviderSyncStore, ProviderSweepMode, ProviderWatermark } from "./reconcile.js";

interface WatermarkRow {
  updated_at_watermark: Date | string;
  provider_repository_id: string | null;
  cursor: string | null;
  sweep_mode: ProviderSweepMode | null;
  deep_backfill_started_at: Date | string | null;
  last_deep_backfill_at: Date | string | null;
  next_poll_at: Date | string;
  consecutive_failures: number;
}

interface DeliveryRow {
  delivery_id: string;
  pull_request_number: number | null;
  payload: unknown;
}

const iso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();

function payloadRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function providerId(value: unknown): string | undefined {
  if (typeof value !== "string" && (typeof value !== "number" || !Number.isSafeInteger(value))) return undefined;
  const id = String(value);
  return /^\d{1,200}$/.test(id) ? id : undefined;
}

async function withTransaction(client: PoolClient, operation: () => Promise<void>): Promise<void> {
  try {
    await client.query("begin");
    await operation();
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Postgres implementation of the durable provider inbox, watermark and observations. */
export class PostgresProviderSyncStore implements ProviderSyncStore {
  constructor(private readonly pool: Pool) {}

  async withRepositoryLock(repositoryId: string, work: () => Promise<void>): Promise<boolean> {
    const client = await this.pool.connect();
    let acquired = false;
    try {
      const lock = await client.query<{ locked: boolean }>(
        "select pg_try_advisory_lock(hashtextextended($1, 0)) as locked",
        [`kintsugi.provider-sync:${repositoryId}`],
      );
      acquired = lock.rows[0]?.locked === true;
      if (!acquired) return false;
      await work();
      return true;
    } finally {
      if (acquired) {
        await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [`kintsugi.provider-sync:${repositoryId}`]).catch(() => undefined);
      }
      client.release();
    }
  }

  async watermark(repositoryId: string): Promise<ProviderWatermark> {
    const created = await this.pool.query(
      `insert into workflow.member_provider_sync_watermark (server_id, repository_id)
       select server_id, id from admin.git_repository where id = $1
       on conflict (server_id, repository_id) do nothing`,
      [repositoryId],
    );
    const result = await this.pool.query<WatermarkRow>(
      `select w.updated_at_watermark, w.provider_repository_id, w.cursor, w.sweep_mode,
              w.deep_backfill_started_at, w.last_deep_backfill_at, w.next_poll_at, w.consecutive_failures
         from workflow.member_provider_sync_watermark w
        where w.repository_id = $1`,
      [repositoryId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(created.rowCount === 0 ? "provider repository no longer exists" : "provider watermark could not be created");
    return {
      updatedAtWatermark: iso(row.updated_at_watermark),
      ...(row.provider_repository_id === null ? {} : { providerRepositoryId: row.provider_repository_id }),
      ...(row.cursor === null ? {} : { cursor: row.cursor }),
      ...(row.sweep_mode === null ? {} : { sweepMode: row.sweep_mode }),
      ...(row.deep_backfill_started_at === null ? {} : { deepBackfillStartedAt: iso(row.deep_backfill_started_at) }),
      ...(row.last_deep_backfill_at === null ? {} : { lastDeepBackfillAt: iso(row.last_deep_backfill_at) }),
      nextPollAt: iso(row.next_poll_at),
      consecutiveFailures: row.consecutive_failures,
    };
  }

  async deliveries(repositoryId: string): Promise<ProviderSyncDelivery[]> {
    const result = await this.pool.query<DeliveryRow>(
      `select delivery_id, pull_request_number, payload from workflow.member_provider_delivery
        where repository_id = $1 and state in ('pending', 'failed')
        order by received_at, delivery_id limit 1000`,
      [repositoryId],
    );
    return result.rows.map((row) => {
      const payload = payloadRecord(row.payload);
      const repositoryIdHint = providerId(payload["providerRepositoryId"]);
      const pullRequestIdHint = providerId(payload["providerPullRequestId"]);
      const number = row.pull_request_number;
      return {
        deliveryId: row.delivery_id,
        ...(repositoryIdHint === undefined ? {} : { providerRepositoryId: repositoryIdHint }),
        ...(pullRequestIdHint === undefined ? {} : { providerPullRequestId: pullRequestIdHint }),
        ...(number === null || !Number.isSafeInteger(number) || number < 1 ? {} : { pullRequestNumber: number }),
      };
    });
  }

  async acknowledgeDeliveries(repositoryId: string, deliveryIds: string[]): Promise<void> {
    if (deliveryIds.length === 0) return;
    await this.pool.query(
      `update workflow.member_provider_delivery
          set state = 'processed', processed_at = clock_timestamp(), last_error = null
        where repository_id = $1 and delivery_id = any($2::text[]) and state in ('pending', 'failed')`,
      [repositoryId, deliveryIds],
    );
  }

  async saveProgress(repositoryId: string, progress: {
    sweepMode: ProviderSweepMode;
    cursor?: string;
    startedAt: string;
    deepBackfillStartedAt?: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `update workflow.member_provider_sync_watermark
          set cursor = $2,
              sweep_mode = $3,
              sweep_started_at = coalesce(sweep_started_at, $4::timestamptz),
              deep_backfill_started_at = case when $3 = 'deep' then coalesce(deep_backfill_started_at, $5::timestamptz) else null end,
              next_poll_at = clock_timestamp(),
              updated_at = clock_timestamp()
        where repository_id = $1`,
      [repositoryId, progress.cursor ?? null, progress.sweepMode, progress.startedAt, progress.deepBackfillStartedAt ?? null],
    );
    if ((result.rowCount ?? 0) !== 1) throw new Error("provider watermark disappeared while saving sweep progress");
  }

  async persistObservation(repositoryId: string, pullRequest: ObservedPullRequest): Promise<void> {
    const client = await this.pool.connect();
    await withTransaction(client, async () => {
      await client.query(
        `insert into workflow.member_provider_observation
         (server_id, repository_id, provider_repository_id, provider_pull_request_id, pull_request_number,
          state, is_draft, author_provider_actor_id, head_sha, head_ref, base_sha, base_ref,
          merge_base_sha, test_merge_sha, merge_commit_sha, merged_at, provider_updated_at, observed_at, reviews, checks,
          association_claim_status, association_claim)
       select r.server_id, r.id, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
              $16::timestamptz, clock_timestamp(), $17::jsonb, $18::jsonb, $19, $20::jsonb
         from admin.git_repository r where r.id = $1
       on conflict (server_id, provider_repository_id, provider_pull_request_id) do update set
         pull_request_number = excluded.pull_request_number,
         state = excluded.state,
         is_draft = excluded.is_draft,
         author_provider_actor_id = excluded.author_provider_actor_id,
         head_sha = excluded.head_sha,
         head_ref = excluded.head_ref,
         base_sha = excluded.base_sha,
         base_ref = excluded.base_ref,
         merge_base_sha = excluded.merge_base_sha,
         test_merge_sha = excluded.test_merge_sha,
         merge_commit_sha = excluded.merge_commit_sha,
         merged_at = excluded.merged_at,
         provider_updated_at = excluded.provider_updated_at,
         observed_at = clock_timestamp(),
         reviews = excluded.reviews,
         checks = excluded.checks,
         association_claim_status = excluded.association_claim_status,
         association_claim = excluded.association_claim
       where workflow.member_provider_observation.provider_updated_at <= excluded.provider_updated_at`,
      [
        repositoryId,
        pullRequest.repositoryId,
        pullRequest.pullRequestId,
        pullRequest.number,
        pullRequest.state,
        pullRequest.draft,
        pullRequest.authorId ?? null,
        pullRequest.headSha,
        pullRequest.headRef,
        pullRequest.baseSha,
        pullRequest.baseRef,
        pullRequest.mergeBaseSha ?? null,
        pullRequest.testMergeSha ?? null,
        pullRequest.mergeCommitSha ?? null,
        pullRequest.mergedAt ?? null,
        pullRequest.updatedAt,
        JSON.stringify(pullRequest.reviews),
        JSON.stringify(pullRequest.checks),
        pullRequest.associationClaimStatus,
        pullRequest.associationClaim === undefined ? null : JSON.stringify(pullRequest.associationClaim),
        ],
      );
      await this.#reconcileAssociation(client, repositoryId, pullRequest.repositoryId, pullRequest.pullRequestId);
    });
    // A stale overlap page may lose the conflict update because the stored provider revision is newer.
    // The upsert's WHERE clause makes that a safe no-op; association reconciliation reads the durable row.
  }

  async reconcileAssociations(repositoryId: string): Promise<void> {
    const identities = await this.pool.query<{ provider_repository_id: string; provider_pull_request_id: string }>(
      `select o.provider_repository_id, o.provider_pull_request_id
         from workflow.member_provider_observation o
         left join workflow.member_task_pull_request a
           on a.server_id = o.server_id and a.provider_repository_id = o.provider_repository_id
          and a.provider_pull_request_id = o.provider_pull_request_id
        where o.repository_id = $1 and o.association_claim_status = 'valid'
          and (a.project_id is null or a.association_state = 'needs_confirmation')
        order by o.provider_repository_id, o.provider_pull_request_id`,
      [repositoryId],
    );
    for (const identity of identities.rows) {
      const client = await this.pool.connect();
      await withTransaction(client, () => this.#reconcileAssociation(
        client, repositoryId, identity.provider_repository_id, identity.provider_pull_request_id,
      ));
    }
  }

  async #reconcileAssociation(client: PoolClient, repositoryId: string, providerRepositoryId: string, providerPullRequestId: string): Promise<void> {
    const candidate = await client.query<{
      server_id: string;
      repository_id: string;
      provider_repository_id: string;
      provider_pull_request_id: string;
      pull_request_number: number;
      project_id: string;
      unit_id: string;
      application_id: string;
      claim: unknown;
      author_provider_actor_id: string | null;
      verified_actor_id: string | null;
      base_ref: string;
      default_branch: string | null;
      context_revision: string;
      manifest: Record<string, unknown>;
      task: Record<string, unknown>;
    }>(
      `select o.server_id, o.repository_id, o.provider_repository_id, o.provider_pull_request_id,
              o.pull_request_number, t.project_id, t.unit_id, t.application_id,
              o.association_claim as claim, o.author_provider_actor_id,
              case when user_access.user_id is not null then mapping.provider_actor_id else null end as verified_actor_id,
              o.base_ref, repo.default_branch, snapshot.context_revision, snapshot.manifest, snapshot.task
         from workflow.member_provider_observation o
         join admin.git_repository repo on repo.id = o.repository_id and repo.server_id = o.server_id
         join delivery.member_task_projection t
           on t.project_id = o.association_claim->>'projectId' and t.unit_id = o.association_claim->>'unitId'
         join admin.project_repository linked
           on linked.project_id = t.project_id and linked.repository_id = o.repository_id
          and (linked.role = 'document' or (linked.role = 'target' and linked.application_id = t.application_id))
         join delivery.member_snapshot snapshot
           on snapshot.project_id = t.project_id and snapshot.unit_id = t.unit_id
          and snapshot.context_revision = o.association_claim->>'contextRevision'
          and snapshot.status = 'ready' and snapshot.pin_state = 'retained'
          and snapshot.expires_at > clock_timestamp()
         left join workflow.member_provider_actor_mapping mapping
           on mapping.project_id = t.project_id and mapping.server_id = o.server_id
          and mapping.provider_actor_id = o.author_provider_actor_id
         left join core.app_user mapped_user on mapped_user.id = mapping.user_id and mapped_user.enabled = true
         left join admin.project_access user_access
           on user_access.project_id = t.project_id and user_access.user_id = mapped_user.id
        where o.repository_id = $1 and o.provider_repository_id = $2 and o.provider_pull_request_id = $3
          and o.association_claim_status = 'valid'
        order by snapshot.created_at desc limit 1
        for update of o for key share of snapshot`,
      [repositoryId, providerRepositoryId, providerPullRequestId],
    );
    const row = candidate.rows[0];
    if (row === undefined) return;
    const claim = validateMemberAssociationClaim(row.claim);
    const fixedContext = readMemberAssociationContext({
      contextRevision: row.context_revision,
      manifest: row.manifest,
      task: row.task,
    });
    if (claim === undefined || fixedContext === undefined) return;
    const validation = validateMemberAssociationClaimForTask({
      claim,
      projectId: row.project_id,
      unitId: row.unit_id,
      repositoryId: row.repository_id,
      baseRef: row.base_ref,
      defaultBranch: row.default_branch,
      contextRevision: fixedContext.contextRevision,
      requiredDeliverableIds: fixedContext.requiredDeliverableIds,
      deliverables: fixedContext.deliverables,
    });
    if (!validation.valid) return;

    const verifiedActorId = row.author_provider_actor_id !== null && row.verified_actor_id === row.author_provider_actor_id
      ? row.verified_actor_id : null;
    const state = verifiedActorId === null ? "needs_confirmation" : "confirmed";
    await client.query(
      `insert into workflow.member_task_pull_request
         (server_id, repository_id, provider_repository_id, provider_pull_request_id, pull_request_number,
          project_id, unit_id, association_state, association_source, verified_actor_id, context_revision,
          target_branch, deliverable_ids, confirmed_by, confirmed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8,
         case when $8 = 'confirmed' then 'verified_actor' else null end,
         $9, $10, $11, $12::jsonb, null,
         case when $8 = 'confirmed' then clock_timestamp() else null end)
       on conflict (server_id, provider_repository_id, provider_pull_request_id) do update set
         association_state = 'confirmed', association_source = 'verified_actor',
         verified_actor_id = excluded.verified_actor_id, context_revision = excluded.context_revision,
         target_branch = excluded.target_branch, deliverable_ids = excluded.deliverable_ids,
         confirmed_at = clock_timestamp(), updated_at = clock_timestamp()
       where workflow.member_task_pull_request.association_state = 'needs_confirmation'
         and excluded.association_state = 'confirmed'
         and workflow.member_task_pull_request.project_id = excluded.project_id
         and workflow.member_task_pull_request.unit_id = excluded.unit_id
         and workflow.member_task_pull_request.context_revision = excluded.context_revision
         and workflow.member_task_pull_request.target_branch = excluded.target_branch
         and workflow.member_task_pull_request.deliverable_ids = excluded.deliverable_ids`,
      [row.server_id, row.repository_id, row.provider_repository_id, row.provider_pull_request_id,
        row.pull_request_number, row.project_id, row.unit_id, state, verifiedActorId,
        row.context_revision, row.base_ref, JSON.stringify(claim.deliverableIds)],
    );
  }

  async completeSweep(repositoryId: string, completed: {
    updatedAtWatermark: string;
    providerRepositoryId?: string;
    completedAt: string;
    lastDeepBackfillAt?: string;
    nextPollAt: string;
    deliveryIds: string[];
  }): Promise<void> {
    const client = await this.pool.connect();
    await withTransaction(client, async () => {
      if (completed.deliveryIds.length > 0) {
        await client.query(
          `update workflow.member_provider_delivery
              set state = 'processed', processed_at = $3::timestamptz, last_error = null
            where repository_id = $1 and delivery_id = any($2::text[]) and state in ('pending', 'failed')`,
          [repositoryId, completed.deliveryIds, completed.completedAt],
        );
      }
      const updated = await client.query(
        `update workflow.member_provider_sync_watermark
            set updated_at_watermark = greatest(updated_at_watermark, $2::timestamptz),
                provider_repository_id = coalesce($3, provider_repository_id),
                cursor = null,
                sweep_mode = null,
                sweep_started_at = null,
                deep_backfill_started_at = null,
                last_deep_backfill_at = coalesce($4::timestamptz, last_deep_backfill_at),
                next_poll_at = case when exists (
                  select 1 from workflow.member_provider_delivery d
                   where d.repository_id = $1 and d.state in ('pending', 'failed')
                ) then clock_timestamp() else $5::timestamptz end,
                consecutive_failures = 0,
                last_error = null,
                sweep_completed_at = $6::timestamptz,
                updated_at = clock_timestamp()
          where repository_id = $1`,
        [repositoryId, completed.updatedAtWatermark, completed.providerRepositoryId ?? null, completed.lastDeepBackfillAt ?? null, completed.nextPollAt, completed.completedAt],
      );
      if ((updated.rowCount ?? 0) !== 1) throw new Error("provider watermark disappeared before sweep completion");
    });
  }

  async recordFailure(repositoryId: string, failure: { errorCode: string; nextPollAt: string }): Promise<void> {
    await this.pool.query(
      `update workflow.member_provider_sync_watermark
          set consecutive_failures = consecutive_failures + 1,
              last_error = $2,
              next_poll_at = $3::timestamptz,
              updated_at = clock_timestamp()
        where repository_id = $1`,
      [repositoryId, failure.errorCode, failure.nextPollAt],
    );
    // Repository deletion cascades the watermark while a worker may be in flight.
    // Failure recording then becomes a harmless no-op instead of aborting the batch.
  }

  async failDeliveries(repositoryId: string, deliveryIds: string[], errorCode: string): Promise<void> {
    if (deliveryIds.length === 0) return;
    await this.pool.query(
      `update workflow.member_provider_delivery
          set state = 'failed', attempt_count = attempt_count + 1, last_error = $3
        where repository_id = $1 and delivery_id = any($2::text[]) and state in ('pending', 'failed')`,
      [repositoryId, deliveryIds, errorCode],
    );
  }

  async repositoriesToSync(limit: number): Promise<string[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError("provider repository batch must be between 1 and 500");
    const result = await this.pool.query<{ id: string }>(
      `select r.id
         from admin.git_repository r
         join admin.git_server s on s.id = r.server_id
         left join workflow.member_provider_sync_watermark w on w.server_id = r.server_id and w.repository_id = r.id
        where s.kind in ('github', 'github-enterprise')
          and coalesce(w.next_poll_at, 'epoch'::timestamptz) <= clock_timestamp()
        order by exists (
                   select 1 from workflow.member_provider_delivery d
                    where d.repository_id = r.id and d.state in ('pending', 'failed')
                 ) desc,
                 coalesce(w.next_poll_at, 'epoch'::timestamptz), r.id
        limit $1`,
      [limit],
    );
    return result.rows.map((row) => row.id);
  }
}
