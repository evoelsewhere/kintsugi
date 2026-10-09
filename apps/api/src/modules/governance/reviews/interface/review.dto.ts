// Interface layer: request schemas and HTTP-facing mapping (ADR-0016: Standard
// Schema; validated by `StandardSchemaValidationPipe`).

import { z } from "zod";
import { stringField } from "../../../../common/interface/dto.js";
import type { UpdateReview } from "../application/reviews.service.js";
import type { CreateReview } from "../domain/review.js";

export const createReviewSchema = z.object({
  subject: stringField(false),
  decision: stringField(false),
  status: stringField(true),
});
export type CreateReviewInput = z.infer<typeof createReviewSchema>;

export const updateReviewSchema = createReviewSchema.partial();
export type UpdateReviewInput = z.infer<typeof updateReviewSchema>;

export function toCreateCommand(input: CreateReviewInput): CreateReview {
  return { ...input };
}

export function toUpdateCommand(input: UpdateReviewInput): UpdateReview {
  return { ...input };
}
