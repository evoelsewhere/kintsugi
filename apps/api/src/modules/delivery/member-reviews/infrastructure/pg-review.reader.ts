import { Injectable } from "@nestjs/common";
import type { TaskIdentity } from "@kintsugi/harness-sdk";
import { getPool } from "#common/db/pool.js";
import { ReviewReadRepository, type StoredMemberReview } from "../domain/review-read.repository.js";

interface ReviewRow {
  project_id: string;
  unit_id: string;
  review_id: string;
  generation: number;
  status: StoredMemberReview["status"];
  currentness: StoredMemberReview["currentness"];
  report: unknown | null;
}

@Injectable()
export class PgReviewReader extends ReviewReadRepository {
  async find(projectId: string, reviewId: string): Promise<StoredMemberReview | undefined> {
    const result = await getPool().query<ReviewRow>(
      `select project_id, unit_id, review_id, generation, status, currentness, report
         from workflow.member_review
        where project_id = $1 and review_id = $2`,
      [projectId, reviewId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapReview(row);
  }

  async listCurrentIds(identity: TaskIdentity): Promise<string[]> {
    const result = await getPool().query<{ review_id: string }>(
      `select review_id
         from workflow.member_review
        where project_id = $1 and unit_id = $2 and currentness = 'current'
          and status in ('succeeded', 'inconclusive') and report is not null
        order by created_at desc, review_id
        limit 100`,
      [identity.projectId, identity.unitId],
    );
    return result.rows.map((row) => row.review_id);
  }
}

function mapReview(row: ReviewRow): StoredMemberReview {
  return {
    projectId: row.project_id,
    unitId: row.unit_id,
    reviewId: row.review_id,
    generation: row.generation,
    status: row.status,
    currentness: row.currentness,
    report: row.report,
  };
}
