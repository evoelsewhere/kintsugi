// Request schemas of document repo reads (ADR-0016: Standard Schema via zod). The service checks
// refs against the mirror and paths against the repository-path rules; these bound the input.

import { z } from "zod";
import { GAP_STATUSES } from "@kintsugi/domain";

/** A commit id or `refs/heads/<branch>`. */
const refSchema = z
  .string()
  .max(300)
  .regex(/^([0-9a-f]{40}|[0-9a-f]{64}|refs\/heads\/[A-Za-z0-9._/-]+)$/, "must be a commit id or refs/heads/<branch>")
  .optional();

/** `?ref&path` of the tree listing (path defaults to the root). */
export const treeQuerySchema = z.object({ ref: refSchema, path: z.string().max(1000).default("") });
export type TreeQuery = z.infer<typeof treeQuerySchema>;

/** `?ref&path` of a file. */
export const fileQuerySchema = z.object({ ref: refSchema, path: z.string().min(1).max(1000) });
export type FileQuery = z.infer<typeof fileQuerySchema>;

/** `?ref&compare` of a stage's results; compare=true adds the previous run's counts. */
export const resultsQuerySchema = z.object({
  ref: refSchema,
  compare: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((value) => value === "true" || value === "1"),
});
export type ResultsQuery = z.infer<typeof resultsQuerySchema>;

/** `?view&item&ref` of the understand results: the view, and one catalog item or the whole application. */
export const understandResultsQuerySchema = z.object({
  view: z.enum(["map", "extract-rules", "harden", "understand", "gaps"]).default("understand"),
  item: z.string().min(3).max(130).optional(),
  ref: refSchema,
});
export type UnderstandResultsQuery = z.infer<typeof understandResultsQuerySchema>;

/** Answers stay on the gap's row in the original specification; arbitrary paths/content cannot be supplied. */
// eslint-disable-next-line no-control-regex -- answers must not contain line breaks or control characters
const answerText = z.string().trim().min(1).max(2000).regex(/^[^\r\n\u0000-\u001f\u007f]+$/, "must be one line");
export const gapAnswerSchema = z.object({
  item: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}\/[a-z0-9][a-z0-9-]{0,62}$/),
  gap: z.string().max(160).regex(/^GAP-[A-Za-z0-9][A-Za-z0-9._-]*-\d{2,}$/),
  commit: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
  answer: answerText,
  evidence: answerText,
  status: z.enum(GAP_STATUSES),
}).strict();
