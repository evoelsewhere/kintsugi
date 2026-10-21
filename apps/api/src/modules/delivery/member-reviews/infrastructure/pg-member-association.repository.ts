import { Injectable } from "@nestjs/common";
import {
  readMemberAssociationContext,
  validateMemberAssociationClaimForTask,
  type MemberAssociationClaim,
} from "@kintsugi/domain";
import { getPool, withTransaction } from "#common/db/pool.js";
import {
  MemberAssociationRepository,
  type MemberAssociationConfirmation,
  type MemberAssociationConfirmationResult,
  type PendingMemberAssociation,
  type ProviderActorMappingResult,
} from "../domain/member-association.js";

interface PendingAssociationRow {
  server_id: string;
  repository_id: string;
  provider_repository_id: string;
  provider_pull_request_id: string;
  pull_request_number: number;
  state: PendingMemberAssociation["state"];
  author_provider_actor_id: string | null;
  head_sha: string;
  head_ref: string;
  base_ref: string;
  association_claim_status: "absent" | "invalid" | "valid";
  association_claim: MemberAssociationClaim | null;
  association_state: "needs_confirmation" | "rejected" | null;
}

@Injectable()
export class PgMemberAssociationRepository extends MemberAssociationRepository {
  async listConfirmedForTask(identity: { projectId: string; unitId: string }, limit: number) {
    const result = await getPool().query<{
      repository_id: string;
      provider_pull_request_id: string;
      state: "open" | "closed" | "merged";
      head_sha: string;
      provider_updated_at: Date;
    }>(
      "select a.repository_id, o.provider_pull_request_id, o.state, o.head_sha, o.provider_updated_at " +
        "from workflow.member_task_pull_request a " +
        "join workflow.member_provider_observation o " +
          "on o.repository_id = a.repository_id and o.server_id = a.server_id " +
          "and o.provider_repository_id = a.provider_repository_id " +
          "and o.provider_pull_request_id = a.provider_pull_request_id " +
        "where a.project_id = $1 and a.unit_id = $2 and a.association_state = 'confirmed' " +
        "order by o.provider_updated_at desc, a.repository_id, o.provider_pull_request_id " +
        "limit $3",
      [identity.projectId, identity.unitId, limit + 1],
    );
    const rows = result.rows.slice(0, limit);
    return {
      items: rows.map((row) => ({
        repositoryId: row.repository_id,
        pullRequestId: row.provider_pull_request_id,
        state: row.state,
        headRevision: row.head_sha,
        updatedAt: row.provider_updated_at.toISOString(),
      })),
      hasMore: result.rows.length > limit,
    };
  }

  async listNeedsConfirmation(projectId: string, limit: number, offset: number): Promise<{ items: PendingMemberAssociation[]; hasMore: boolean }> {
    const result = await getPool().query<PendingAssociationRow>(
      `select o.server_id, o.repository_id, o.provider_repository_id, o.provider_pull_request_id,
              o.pull_request_number, o.state, o.author_provider_actor_id, o.head_sha, o.head_ref, o.base_ref,
              case when o.association_claim_status = 'valid' and o.association_claim->>'projectId' <> $1
                   then 'project-mismatch' else o.association_claim_status end as association_claim_status,
              case when o.association_claim->>'projectId' = $1 then o.association_claim else null end as association_claim,
              a.association_state
         from admin.project_repository linked
         join workflow.member_provider_observation o on o.repository_id = linked.repository_id
         left join workflow.member_task_pull_request a
           on a.server_id = o.server_id and a.provider_repository_id = o.provider_repository_id
          and a.provider_pull_request_id = o.provider_pull_request_id
        where linked.project_id = $1
          and (a.project_id is null or (a.project_id = $1 and a.association_state in ('needs_confirmation', 'rejected')))
        order by o.provider_updated_at desc, o.server_id, o.provider_repository_id, o.pull_request_number
        limit $2 offset $3`,
      [projectId, limit + 1, offset],
    );
    return {
      items: result.rows.slice(0, limit).map((row) => ({
        serverId: row.server_id,
        repositoryId: row.repository_id,
        providerRepositoryId: row.provider_repository_id,
        providerPullRequestId: row.provider_pull_request_id,
        pullRequestNumber: row.pull_request_number,
        state: row.state,
        ...(row.author_provider_actor_id === null ? {} : { authorProviderActorId: row.author_provider_actor_id }),
        headSha: row.head_sha,
        headRef: row.head_ref,
        baseRef: row.base_ref,
        claimStatus: row.association_claim_status,
        ...(row.association_claim === null ? {} : { claim: row.association_claim }),
        ...(row.association_state === null ? {} : { associationState: row.association_state }),
      })),
      hasMore: result.rows.length > limit,
    };
  }

  async mapProviderActor(input: {
    projectId: string;
    serverId: string;
    providerActorId: string;
    userId: string;
    confirmedBy: string;
  }): Promise<ProviderActorMappingResult> {
    return withTransaction(async (client) => {
      const linked = await client.query(
        `select 1 from admin.project_repository p
           join admin.git_repository r on r.id = p.repository_id
          where p.project_id = $1 and r.server_id = $2 limit 1`,
        [input.projectId, input.serverId],
      );
      if (linked.rowCount !== 1) return { status: "repository-not-linked" };

      const authorized = await client.query(
        `select 1 from core.app_user u join admin.project_access a on a.user_id = u.id
          where u.id = $1 and u.enabled = true and a.project_id = $2 limit 1`,
        [input.userId, input.projectId],
      );
      if (authorized.rowCount !== 1) return { status: "user-not-authorized" };

      const inserted = await client.query(
        `insert into workflow.member_provider_actor_mapping
           (project_id, server_id, provider_actor_id, user_id, confirmed_by)
         values ($1, $2, $3, $4, $5)
         on conflict (project_id, server_id, provider_actor_id) do nothing
         returning provider_actor_id`,
        [input.projectId, input.serverId, input.providerActorId, input.userId, input.confirmedBy],
      );
      if (inserted.rowCount === 1) {
        await client.query(
          `insert into workflow.member_provider_sync_watermark (server_id, repository_id, next_poll_at)
           select r.server_id, r.id, clock_timestamp()
             from admin.project_repository p join admin.git_repository r on r.id = p.repository_id
            where p.project_id = $1 and r.server_id = $2
           on conflict (server_id, repository_id) do update
             set next_poll_at = least(workflow.member_provider_sync_watermark.next_poll_at, clock_timestamp()),
                 updated_at = clock_timestamp()`,
          [input.projectId, input.serverId],
        );
        return { status: "created" };
      }

      const existing = await client.query<{ user_id: string }>(
        `select user_id from workflow.member_provider_actor_mapping
          where project_id = $1 and server_id = $2 and provider_actor_id = $3`,
        [input.projectId, input.serverId, input.providerActorId],
      );
      return existing.rows[0]?.user_id === input.userId ? { status: "unchanged" } : { status: "mapping-conflict" };
    });
  }

  async confirm(input: MemberAssociationConfirmation): Promise<MemberAssociationConfirmationResult> {
    return withTransaction(async (client) => {
      const observation = await client.query<{
        repository_id: string;
        base_ref: string;
        default_branch: string | null;
        pull_request_number: number;
      }>(
        `select o.repository_id, o.base_ref, r.default_branch, o.pull_request_number
           from workflow.member_provider_observation o
           join admin.git_repository r on r.id = o.repository_id and r.server_id = o.server_id
          where o.server_id = $1 and o.provider_repository_id = $2 and o.provider_pull_request_id = $3
          for update of o`,
        [input.serverId, input.providerRepositoryId, input.providerPullRequestId],
      );
      const observed = observation.rows[0];
      if (observed === undefined) return { status: "observation-not-found" };

      const task = await client.query<{ application_id: string }>(
        `select application_id from delivery.member_task_projection where project_id = $1 and unit_id = $2`,
        [input.projectId, input.unitId],
      );
      const projectedTask = task.rows[0];
      if (projectedTask === undefined) return { status: "task-not-found" };

      const linkedRepository = await client.query(
        `select 1 from admin.project_repository p
          where p.project_id = $1 and p.repository_id = $2
            and (p.role = 'document' or (p.role = 'target' and p.application_id = $3))
          limit 1`,
        [input.projectId, observed.repository_id, projectedTask.application_id],
      );
      if (linkedRepository.rowCount !== 1) return { status: "repository-not-linked" };

      const snapshot = await client.query<{ task: Record<string, unknown>; manifest: Record<string, unknown>; context_revision: string }>(
        `select task, manifest, context_revision from delivery.member_snapshot
          where project_id = $1 and unit_id = $2 and context_revision = $3
            and status = 'ready' and pin_state = 'retained' and expires_at > clock_timestamp()
          order by created_at desc limit 1 for key share`,
        [input.projectId, input.unitId, input.contextRevision],
      );
      const row = snapshot.rows[0];
      if (row === undefined) return { status: "context-unavailable" };
      const fixedContext = readMemberAssociationContext({
        contextRevision: row.context_revision,
        manifest: row.manifest,
        task: row.task,
      });
      if (fixedContext === undefined) return { status: "invalid-association" };

      const validated = validateInput(input, observed.base_ref, observed.default_branch, fixedContext,
        observed.repository_id);
      if (!validated) return { status: "invalid-association" };

      const existing = await client.query<{
        project_id: string; unit_id: string; association_state: string; context_revision: string | null;
        target_branch: string | null; deliverable_ids: string[];
      }>(
        `select project_id, unit_id, association_state, context_revision, target_branch, deliverable_ids
           from workflow.member_task_pull_request
          where server_id = $1 and provider_repository_id = $2 and provider_pull_request_id = $3
          for update`,
        [input.serverId, input.providerRepositoryId, input.providerPullRequestId],
      );
      const current = existing.rows[0];
      if (current?.association_state === "confirmed") {
        const same = current.project_id === input.projectId && current.unit_id === input.unitId &&
          current.context_revision === input.contextRevision && current.target_branch === observed.base_ref &&
          sameStrings(current.deliverable_ids, input.deliverableIds);
        return same ? { status: "unchanged" } : { status: "association-conflict" };
      }

      const saved = await client.query(
        `insert into workflow.member_task_pull_request
           (server_id, repository_id, provider_repository_id, provider_pull_request_id, pull_request_number,
            project_id, unit_id, association_state, association_source, verified_actor_id, context_revision,
            target_branch, deliverable_ids, confirmed_by, confirmed_at)
         values ($1, $2, $3, $4, $5, $6, $7, 'confirmed', 'maintainer', null, $8, $9, $10::jsonb, $11, clock_timestamp())
         on conflict (server_id, provider_repository_id, provider_pull_request_id) do update set
           repository_id = excluded.repository_id,
           pull_request_number = excluded.pull_request_number,
           project_id = excluded.project_id,
           unit_id = excluded.unit_id,
           association_state = 'confirmed',
           association_source = 'maintainer',
           verified_actor_id = null,
           context_revision = excluded.context_revision,
           target_branch = excluded.target_branch,
           deliverable_ids = excluded.deliverable_ids,
           confirmed_by = excluded.confirmed_by,
           confirmed_at = clock_timestamp(),
           updated_at = clock_timestamp()
         where workflow.member_task_pull_request.association_state in ('needs_confirmation', 'rejected')
         returning provider_pull_request_id`,
        [input.serverId, observed.repository_id, input.providerRepositoryId, input.providerPullRequestId,
          observed.pull_request_number, input.projectId, input.unitId, input.contextRevision, observed.base_ref,
          JSON.stringify(input.deliverableIds), input.confirmedBy],
      );
      return saved.rowCount === 1 ? { status: "confirmed" } : { status: "association-conflict" };
    });
  }
}

function validateInput(
  input: MemberAssociationConfirmation,
  baseRef: string,
  defaultBranch: string | null,
  fixedContext: NonNullable<ReturnType<typeof readMemberAssociationContext>>,
  repositoryId: string,
): boolean {
  // This service uses the same pure validator as the worker auto-link path.
  const claim: MemberAssociationClaim = {
    projectId: input.projectId,
    unitId: input.unitId,
    contextRevision: input.contextRevision,
    deliverableIds: input.deliverableIds,
  };
  return validateMemberAssociationClaimForTask({
    claim,
    projectId: input.projectId,
    unitId: input.unitId,
    repositoryId,
    baseRef,
    defaultBranch,
    contextRevision: fixedContext.contextRevision,
    requiredDeliverableIds: fixedContext.requiredDeliverableIds,
    deliverables: fixedContext.deliverables,
  }).valid;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}
