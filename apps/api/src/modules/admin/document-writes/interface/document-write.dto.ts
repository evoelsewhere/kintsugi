// Request schemas of document writes (ADR-0016: Standard Schema via zod).

import { z } from "zod";
import { enumListQuery } from "#common/interface/dto.js";
import { pageQuerySchema } from "#common/interface/pagination.js";
import { DOCUMENT_WRITE_STATUSES } from "../domain/document-write.js";

/** `?status=queued,failed&projectId&limit&offset` of the cross-project write list. */
export const listAllDocumentWritesQuerySchema = pageQuerySchema.extend({
  status: enumListQuery(DOCUMENT_WRITE_STATUSES).optional(),
  projectId: z.string().min(1).max(128).optional(),
});
export type ListAllDocumentWritesQuery = z.infer<typeof listAllDocumentWritesQuerySchema>;

/** Body of the manifest publish; optional: the starter structure is included unless `scaffold` is false. */
export const publishManifestSchema = z
  .object({ scaffold: z.boolean().optional() })
  .optional()
  .default({});
export type PublishManifestInput = z.infer<typeof publishManifestSchema>;
