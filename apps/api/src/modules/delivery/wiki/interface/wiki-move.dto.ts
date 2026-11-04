import { z } from "zod";

const pagePath = z.string().min(1).max(1000);

/** Body of `POST wiki/move/preview`: the page and where it goes. */
export const movePreviewSchema = z.object({ from: pagePath, to: pagePath }).strict();
export type MovePreviewBody = z.infer<typeof movePreviewSchema>;

/** Body of `POST wiki/move`: the same, with the message of the commit (the first line is the pull request's title). */
export const moveSchema = z.object({ from: pagePath, to: pagePath, message: z.string().trim().min(1).max(300) }).strict();
export type MoveBody = z.infer<typeof moveSchema>;
