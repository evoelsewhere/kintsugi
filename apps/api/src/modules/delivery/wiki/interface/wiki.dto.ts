import { z } from "zod";

/** `?path=` of a page of the document repo. */
export const wikiPathQuerySchema = z.object({ path: z.string().min(1).max(1000) });
export type WikiPathQuery = z.infer<typeof wikiPathQuerySchema>;

/** `?path=` of the restrictions that cover a page; without it, every restriction of the project. */
export const restrictionsQuerySchema = z.object({ path: z.string().min(1).max(1000).optional() });
export type RestrictionsQuery = z.infer<typeof restrictionsQuerySchema>;

/** Body of a restriction: who is let in under a prefix (a folder ending in "/", or a page) for editing or publishing. */
export const setRestrictionSchema = z
  .object({
    pathPrefix: z.string().min(1).max(1000),
    kind: z.enum(["edit", "publish"]),
    subjects: z.array(z.object({ kind: z.enum(["user", "role"]), id: z.string().min(1).max(200) }).strict()).min(1).max(100),
  })
  .strict();
export type SetRestrictionBody = z.infer<typeof setRestrictionSchema>;

/** `?pathPrefix&kind` of a restriction to clear. */
export const clearRestrictionQuerySchema = z.object({ pathPrefix: z.string().min(1).max(1000), kind: z.enum(["edit", "publish"]) });
export type ClearRestrictionQuery = z.infer<typeof clearRestrictionQuerySchema>;

/** Body of a publish: the draft's revision, the message, and what the writer confirms after a merge preview or a conflict. */
export const publishSchema = z
  .object({
    path: z.string().min(1).max(1000),
    revision: z.number().int().min(1),
    message: z.string().trim().min(1).max(200),
    minor: z.boolean().optional(),
    /** The head the user saw in the preview or the conflict; the page must still be as it was there. */
    mergedFrom: z
      .object({
        commit: z.string().regex(/^([0-9a-f]{40}|[0-9a-f]{64})$/, "must be a commit id"),
        hash: z
          .string()
          .regex(/^[0-9a-f]{64}$/, "must be a SHA-256 in hex")
          .nullable(),
      })
      .strict()
      .optional(),
    /** The text the user made of a conflict; needs `mergedFrom`. */
    resolvedText: z.string().optional(),
  })
  .strict();
export type PublishBody = z.infer<typeof publishSchema>;

/** Body of a draft save (the JSON body limit of the API still applies). */
export const saveDraftSchema = z
  .object({
    path: z.string().min(1).max(1000),
    text: z.string(),
    baseRevision: z.number().int().min(1).nullable(),
    baseCommit: z
      .string()
      .regex(/^([0-9a-f]{40}|[0-9a-f]{64})$/, "must be a commit id")
      .optional(),
  })
  .strict();
export type SaveDraftBody = z.infer<typeof saveDraftSchema>;
