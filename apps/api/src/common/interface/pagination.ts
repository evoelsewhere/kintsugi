// Shared interface kernel: the pagination query schema (ADR-0016: Standard Schema).
// Pair with common/application/pagination.ts → response { success: true, data: Page<T> }.

import { z } from "zod";
import type { PageQuery } from "../application/pagination.js";

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function parsePageQuery(input: unknown): PageQuery {
  return pageQuerySchema.parse(input);
}

export type { Page, PageQuery } from "../application/pagination.js";
