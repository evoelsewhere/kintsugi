// Request schemas of the audit log (ADR-0016: Standard Schema via zod).

import { z } from "zod";
import { AUDIT_ACTION_LIST, type AuditAction } from "#common/audit/audit-trail.js";
import { enumListQuery } from "#common/interface/dto.js";
import { pageQuerySchema } from "#common/interface/pagination.js";

const filter = z.string().min(1).max(200).optional();

/** `?action&actor&subject&projectId&limit&offset`; `action` takes a comma-separated list of known actions. */
export const listAuditQuerySchema = pageQuerySchema.extend({
  action: enumListQuery(AUDIT_ACTION_LIST as unknown as readonly [AuditAction, ...AuditAction[]]).optional(),
  actor: filter,
  subject: filter,
  projectId: filter,
});
export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;
