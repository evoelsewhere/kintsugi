import { Injectable } from "@nestjs/common";
import type { GateDeliverableEvidence } from "@kintsugi/domain";
import { getPool } from "#common/db/pool.js";
import { GateDecisionEvidenceReader, type RequiredGateDeliverable } from "../domain/gate-decision-evidence.reader.js";

interface EvidenceRow {
  deliverable_id: string;
  repository_id: string;
  pull_request_id: string;
  review_result_id: string;
  reviewed_revision: string;
  merged_revision: string;
}

@Injectable()
export class PgGateDecisionEvidenceReader extends GateDecisionEvidenceReader {
  async readCompletedDeliverables(input: {
    projectId: string;
    unitId: string;
    contextRevision: string;
    policyRevision: string;
    deliverables: readonly RequiredGateDeliverable[];
  }): Promise<GateDeliverableEvidence[]> {
    if (input.deliverables.length === 0) return [];
    const required = input.deliverables.map(({ id, repositoryId, path }) => ({ id, repository_id: repositoryId, path }));
    const result = await getPool().query<EvidenceRow>(
      `with required as (
         select id, repository_id, path
           from jsonb_to_recordset($5::jsonb) as item(id text, repository_id text, path text)
       ), candidates as (
         select required.id as deliverable_id, a.server_id, a.repository_id, a.provider_repository_id,
                a.provider_pull_request_id, a.updated_at
           from required
           join workflow.member_task_pull_request a
             on a.project_id = $1 and a.unit_id = $2
            and a.association_state = 'confirmed'
            and a.context_revision = $3
            and a.repository_id = required.repository_id
            and a.deliverable_ids @> jsonb_build_array(required.id)
       ), latest as (
         select distinct on (deliverable_id) *
           from candidates
          order by deliverable_id, updated_at desc, server_id, provider_pull_request_id
       ), facts as (
         select latest.deliverable_id, latest.repository_id, latest.provider_pull_request_id,
                observation.head_sha, observation.merge_commit_sha,
                review.review_id, review.head_sha as reviewed_revision,
                approval.provider_actor_id, approval.reviewer_id, approval.reviewed_head
           from latest
           join workflow.member_provider_observation observation
             on observation.server_id = latest.server_id
            and observation.repository_id = latest.repository_id
            and observation.provider_repository_id = latest.provider_repository_id
            and observation.provider_pull_request_id = latest.provider_pull_request_id
           join lateral (
             select r.review_id, r.head_sha
               from workflow.member_review r
              where r.project_id = $1 and r.unit_id = $2
                and r.server_id = latest.server_id
                and r.provider_repository_id = latest.provider_repository_id
                and r.provider_pull_request_id = latest.provider_pull_request_id
                and r.context_revision = $3 and r.policy_revision = $4
                and r.currentness = 'current' and r.status = 'succeeded'
                and r.coverage = 'complete' and r.verdict = 'pass'
                and r.head_sha = observation.head_sha
              order by r.generation desc
              limit 1
           ) review on true
           join lateral (
             select mapping.provider_actor_id, mapping.user_id as reviewer_id,
                    provider_review.value->>'commitSha' as reviewed_head
               from jsonb_array_elements(observation.reviews) provider_review(value)
               join workflow.member_provider_actor_mapping mapping
                 on mapping.project_id = $1 and mapping.server_id = latest.server_id
                and mapping.provider_actor_id = provider_review.value->>'actorId'
               join admin.project_access access
                 on access.project_id = $1 and access.user_id = mapping.user_id
              where provider_review.value->>'state' = 'APPROVED'
                and provider_review.value->>'commitSha' = observation.head_sha
                and provider_review.value->>'actorId' is not null
                and provider_review.value->>'actorId' <> observation.author_provider_actor_id
              order by provider_review.value->>'submittedAt' desc, mapping.user_id
              limit 1
           ) approval on true
          where observation.state = 'merged'
            and observation.merge_commit_sha is not null
            and review.head_sha = observation.head_sha
       )
       select deliverable_id, repository_id, provider_pull_request_id as pull_request_id,
              review_id as review_result_id, reviewed_revision, merge_commit_sha as merged_revision
         from facts
        order by deliverable_id`,
      [input.projectId, input.unitId, input.contextRevision, input.policyRevision, JSON.stringify(required)],
    );
    return result.rows.map((row) => ({
      deliverableId: row.deliverable_id,
      repositoryId: row.repository_id,
      pullRequestId: row.pull_request_id,
      reviewResultId: row.review_result_id,
      reviewedRevision: row.reviewed_revision,
      mergedRevision: row.merged_revision,
    }));
  }
}
