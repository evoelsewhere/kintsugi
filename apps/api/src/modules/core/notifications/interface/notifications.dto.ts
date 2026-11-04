import { z } from "zod";

/** `?unread&limit&before` of the inbox: `before` is the `at` of the last notification of the page before. */
export const listNotificationsQuerySchema = z.object({
  unread: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((value) => value === "true" || value === "1"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().datetime().optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

/** Body of "mark read": some of the person's notifications, or all of them. */
export const markReadSchema = z.union([z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }).strict(), z.object({ all: z.literal(true) }).strict()]);
export type MarkReadBody = z.infer<typeof markReadSchema>;
