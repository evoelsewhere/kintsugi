import { brainLabels } from "@kintsugi/domain";
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

export const wikiSwitchSchema = z.object({ enabled: z.boolean() }).strict();
export type WikiSwitchBody = z.infer<typeof wikiSwitchSchema>;

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

export const brainBacklinksQuerySchema = z.object({
  node: brainNodeIdSchema,
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type BrainBacklinksQueryDto = z.infer<typeof brainBacklinksQuerySchema>;

export const brainLookupQuerySchema = z.object({ q: z.string().trim().min(1).max(2000) });
export type BrainLookupQueryDto = z.infer<typeof brainLookupQuerySchema>;

export const brainGrepQuerySchema = z.object({
  text: z.string().min(2).max(200),
  under: brainNodeIdSchema.optional(),
  ignoreCase: ignoreCaseQuery,
  /** A space key (ADR-0096), in any case. */
  space: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9]{1,9}$/, "must be a space key: a letter, then letters or digits, 2 to 10 characters").optional(),
  /** One label, cleaned as the Brain stores it (lowercase, letters, digits and hyphens). */
  label: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .transform((value) => brainLabels([value])[0] ?? "")
    .refine((value) => value !== "", "a label holds letters, digits and hyphens")
    .optional(),
});
export type BrainGrepQueryDto = z.infer<typeof brainGrepQuerySchema>;

/** An earlier commit: a full or abbreviated commit id. */
export const brainCommitSchema = z.string().trim().regex(/^[0-9a-fA-F]{7,64}$/, "must be a commit id");

export const brainChangesQuerySchema = z.object({
  since: brainCommitSchema,
  under: brainNodeIdSchema.optional(),
});
export type BrainChangesQueryDto = z.infer<typeof brainChangesQuerySchema>;
