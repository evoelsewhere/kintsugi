// Request schemas of the audit log (ADR-0016: Standard Schema via zod).

import { z } from "zod";
import { pageQuerySchema } from "#common/interface/pagination.js";

const filter = z.string().min(1).max(200).optional();

/** `?action&subject&projectId&limit&offset`. */
export const listAuditQuerySchema = pageQuerySchema.extend({ action: filter, subject: filter, projectId: filter });
export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;
