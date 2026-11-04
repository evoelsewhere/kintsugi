import { z } from "zod";

/** `?path=` of a page of the document repo. */
export const wikiPathQuerySchema = z.object({ path: z.string().min(1).max(1000) });
export type WikiPathQuery = z.infer<typeof wikiPathQuerySchema>;
