import { z } from "zod";

/** A node id: `/`, a folder path ending in `/`, a document path, or `path#anchor`. */
export const brainNodeIdSchema = z.string().min(1).max(2000);
/** True unless `false` or `0`. */
const ignoreCaseQuery = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((value) => value !== "false" && value !== "0");

export const brainConfigureSchema = z
  .object({
    branch: z.string().trim().min(1).max(255).regex(/^[A-Za-z0-9._/-]+$/, "must be a branch name").optional(),
    enabled: z.boolean(),
  })
  .strict();
export type BrainConfigureBody = z.infer<typeof brainConfigureSchema>;

export const brainTreeQuerySchema = z.object({
  node: brainNodeIdSchema.optional(),
  depth: z.coerce.number().int().min(1).max(2).default(1).transform((value) => value as 1 | 2),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type BrainTreeQueryDto = z.infer<typeof brainTreeQuerySchema>;

export const brainReadQuerySchema = z.object({
  node: brainNodeIdSchema,
  scope: z.enum(["auto", "subtree", "node"]).default("subtree"),
  fromLine: z.coerce.number().int().min(1).optional(),
});
export type BrainReadQueryDto = z.infer<typeof brainReadQuerySchema>;

export const brainLookupQuerySchema = z.object({ q: z.string().trim().min(1).max(2000) });
export type BrainLookupQueryDto = z.infer<typeof brainLookupQuerySchema>;

export const brainGrepQuerySchema = z.object({
  text: z.string().min(2).max(200),
  under: brainNodeIdSchema.optional(),
  ignoreCase: ignoreCaseQuery,
});
export type BrainGrepQueryDto = z.infer<typeof brainGrepQuerySchema>;
