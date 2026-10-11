// Interface layer: request schemas and HTTP-facing mapping (ADR-0016: Standard
// Schema; validated by `StandardSchemaValidationPipe`).

import { z } from "zod";
import { stringField } from "#common/interface/dto.js";
import type { UpdatePortfolioItem } from "../application/portfolio-items.service.js";
import type { CreatePortfolioItem } from "../domain/portfolio-item.js";

export const createPortfolioItemSchema = z.object({
  unit: stringField(false),
  disposition: stringField(false),
  status: stringField(true),
});
export type CreatePortfolioItemInput = z.infer<typeof createPortfolioItemSchema>;

export const updatePortfolioItemSchema = createPortfolioItemSchema.partial();
export type UpdatePortfolioItemInput = z.infer<typeof updatePortfolioItemSchema>;

export function toCreateCommand(input: CreatePortfolioItemInput): CreatePortfolioItem {
  return { ...input };
}

export function toUpdateCommand(input: UpdatePortfolioItemInput): UpdatePortfolioItem {
  return { ...input };
}
