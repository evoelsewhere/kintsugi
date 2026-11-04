import { z } from "zod";

/** `?path=` of a page of the document repo. */
export const wikiPathQuerySchema = z.object({ path: z.string().min(1).max(1000) });
export type WikiPathQuery = z.infer<typeof wikiPathQuerySchema>;

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
