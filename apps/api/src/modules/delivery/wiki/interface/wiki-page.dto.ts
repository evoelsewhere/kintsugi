import { z } from "zod";

/** Body of `POST wiki/pages`: the folder of the new page, its title and, optionally, the template it starts from. */
export const newPageSchema = z
  .object({
    folder: z.string().min(1).max(1000),
    title: z.string().min(1).max(1000),
    templatePath: z.string().min(1).max(1000).optional(),
  })
  .strict();
export type NewPageBody = z.infer<typeof newPageSchema>;

/** `?folder=` of the templates a folder's pages may start from. */
export const templatesQuerySchema = z.object({ folder: z.string().min(1).max(1000) });
export type TemplatesQuery = z.infer<typeof templatesQuerySchema>;
