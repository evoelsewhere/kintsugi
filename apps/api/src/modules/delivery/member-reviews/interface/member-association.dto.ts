import { z } from "zod";
import { DELIVERABLE_ID_PATTERN, isFullUnitId, PROJECT_ID_PATTERN } from "@kintsugi/domain";

const providerId = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const projectId = z.string().regex(PROJECT_ID_PATTERN);

export const memberAssociationListQuerySchema = z.object({
  projectId,
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
}).strict();
export type MemberAssociationListQuery = z.infer<typeof memberAssociationListQuerySchema>;

export const mapProviderActorSchema = z.object({
  userId: providerId,
}).strict();
export type MapProviderActorInput = z.infer<typeof mapProviderActorSchema>;

export const confirmMemberAssociationSchema = z.object({
  projectId,
  unitId: z.string().refine(isFullUnitId, "must be a full application/module/unit identity"),
  contextRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  deliverableIds: z.array(z.string().regex(DELIVERABLE_ID_PATTERN)).min(1).max(100)
    .refine((ids) => new Set(ids).size === ids.length, "must contain unique deliverable IDs"),
}).strict();
export type ConfirmMemberAssociationInput = z.infer<typeof confirmMemberAssociationSchema>;

export const providerIdentityParamSchema = providerId;
