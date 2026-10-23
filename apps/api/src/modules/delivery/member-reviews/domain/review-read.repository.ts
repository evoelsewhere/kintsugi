import type { TaskIdentity, ReviewReport } from "@kintsugi/harness-sdk";

export interface StoredMemberReview {
  projectId: string;
  unitId: string;
  reviewId: string;
  generation: number;
  status: "queued" | "running" | "succeeded" | "failed" | "inconclusive";
  currentness: "current" | "superseded" | "inconclusive";
  report: unknown | null;
}

export abstract class ReviewReadRepository {
  abstract find(projectId: string, reviewId: string): Promise<StoredMemberReview | undefined>;
  abstract listCurrentIds(identity: TaskIdentity): Promise<string[]>;
}

export type ReviewQueryResult = ReviewReport;
