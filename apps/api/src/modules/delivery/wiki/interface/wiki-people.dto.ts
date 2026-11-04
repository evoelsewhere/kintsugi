import { z } from "zod";

/** `?q=` of the people directory: part of a username or a display name; empty lists the first people. */
export const peopleQuerySchema = z.object({ q: z.string().max(200).default("") });
export type PeopleQuery = z.infer<typeof peopleQuerySchema>;
