import { GATE_IDS, MEMBER_ACTIVITIES, PHASES, WORK_ITEM_STATUSES, isFullUnitId } from "@kintsugi/domain";
import { z } from "zod";
import type { ReadinessBlockerCode } from "@kintsugi/domain";

export const MEMBER_SCHEMA_VERSION = "1" as const;
export const DEFAULT_LIST_LIMIT = 25;
export const MAX_LIST_LIMIT = 100;
export const DEFAULT_CONTEXT_BYTES = 32 * 1024;
export const MAX_SEARCH_QUERY_LENGTH = 500;
export const SEARCHABLE_LIMIT = 100;

const projectIdSchema = z.string().trim().min(1).max(63).regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const opaqueIdSchema = z.string().trim().min(1).max(512);
const fullShaSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i);
const contentHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/i);
const contextRevisionSchema = contentHashSchema;
const timestampSchema = z.string().datetime({ offset: true });
const activitySchema = z.enum(MEMBER_ACTIVITIES);
const limitSchema = z.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT);
const maxBytesSchema = z.number().int().min(1).max(DEFAULT_CONTEXT_BYTES).default(DEFAULT_CONTEXT_BYTES);
const identityShape = {
  schemaVersion: z.literal(MEMBER_SCHEMA_VERSION).default(MEMBER_SCHEMA_VERSION),
  projectId: projectIdSchema,
  unitId: z.string().trim().min(1).max(200).refine(isFullUnitId, "must be a full application/module/unit identity"),
};
const readinessBlockerCodes: ReadinessBlockerCode[] = [
  "SOURCE_MISSING",
  "SOURCE_DRAFT",
  "SOURCE_PUBLICATION_UNKNOWN",
  "SOURCE_APPROVAL_PENDING",
  "SOURCE_APPROVAL_REJECTED",
  "SOURCE_APPROVAL_UNKNOWN",
  "GATE_PENDING",
  "GATE_REJECTED",
  "GATE_UNKNOWN",
];
const readinessBlockerSchema = z.object({
  activity: activitySchema,
  code: z.enum(readinessBlockerCodes as [ReadinessBlockerCode, ...ReadinessBlockerCode[]]),
  message: z.string().min(1).max(2000),
  sourceId: opaqueIdSchema.optional(),
  gateId: opaqueIdSchema.optional(),
}).strict();
const activityReadinessSchema = z.object({
  ready: z.boolean(),
  blockers: z.array(readinessBlockerSchema),
}).strict();
const readinessSchema = z.object({
  readyFor: z.array(activitySchema),
  blockers: z.array(readinessBlockerSchema),
  byActivity: z.object({
    design: activityReadinessSchema,
    implementation: activityReadinessSchema,
    verification: activityReadinessSchema,
  }).strict(),
}).strict();

export const projectQuerySchema = z.object({
  schemaVersion: z.literal(MEMBER_SCHEMA_VERSION).default(MEMBER_SCHEMA_VERSION),
  limit: limitSchema,
  cursor: opaqueIdSchema.optional(),
}).strict();

export const taskIdentitySchema = z.object(identityShape).strict();

export const taskQuerySchema = z.object({
  schemaVersion: z.literal(MEMBER_SCHEMA_VERSION).default(MEMBER_SCHEMA_VERSION),
  projectId: projectIdSchema,
  mine: z.boolean().optional(),
  readyFor: activitySchema.optional(),
  limit: limitSchema,
  cursor: opaqueIdSchema.optional(),
}).strict();

export const taskBriefQuerySchema = z.object({
  ...identityShape,
  activity: activitySchema,
  snapshotId: opaqueIdSchema.optional(),
  maxBytes: maxBytesSchema,
}).strict();

export const documentQuerySchema = z.object({
  ...identityShape,
  snapshotId: opaqueIdSchema,
  sourceId: opaqueIdSchema,
  sectionId: opaqueIdSchema.optional(),
  cursor: opaqueIdSchema.optional(),
  maxBytes: maxBytesSchema,
}).strict();

export const documentSearchQuerySchema = z.object({
  ...identityShape,
  snapshotId: opaqueIdSchema,
  query: z.string().trim().min(1).max(MAX_SEARCH_QUERY_LENGTH),
  limit: limitSchema,
  cursor: opaqueIdSchema.optional(),
}).strict();

export const reviewQuerySchema = z.object({
  schemaVersion: z.literal(MEMBER_SCHEMA_VERSION).default(MEMBER_SCHEMA_VERSION),
  projectId: projectIdSchema,
  reviewId: opaqueIdSchema,
}).strict();

export const taskStatusQuerySchema = taskIdentitySchema;

export const taskEventQuerySchema = z.object({
  ...identityShape,
  afterEventId: opaqueIdSchema.optional(),
  limit: limitSchema,
}).strict();

export const projectSummarySchema = z.object({
  projectId: projectIdSchema,
  name: z.string().min(1).max(200),
  role: z.string().min(1).max(100).optional(),
}).strict();

export const taskSummarySchema = z.object({
  projectId: projectIdSchema,
  unitId: z.string().refine(isFullUnitId),
  title: z.string().min(1).max(500),
  phase: z.enum(PHASES),
  status: z.enum(WORK_ITEM_STATUSES),
  assignee: z.string().min(1).max(200).optional(),
  readiness: readinessSchema,
}).strict();

export const contextSourceSchema = z.object({
  sourceId: opaqueIdSchema,
  role: z.string().min(1).max(100),
  repositoryId: opaqueIdSchema,
  path: z.string().min(1).max(1000),
  availability: z.enum(["present", "missing"]),
  publication: z.enum(["draft", "published", "unknown"]),
  approval: z.object({
    status: z.enum(["approved", "pending", "rejected", "unknown", "not-required"]),
    recordId: opaqueIdSchema.optional(),
  }).strict(),
  commit: fullShaSchema.optional(),
  contentHash: contentHashSchema.optional(),
}).strict().superRefine((source, context) => {
  if (source.availability === "present" && (source.commit === undefined || source.contentHash === undefined)) {
    context.addIssue({ code: "custom", message: "present sources require a pinned commit and content hash" });
  }
  if (source.availability === "missing" && (source.commit !== undefined || source.contentHash !== undefined)) {
    context.addIssue({ code: "custom", message: "missing sources cannot claim a commit or content hash" });
  }
});

const omittedSectionSchema = z.object({
  sourceId: opaqueIdSchema,
  sectionId: opaqueIdSchema,
  required: z.boolean(),
}).strict();

export const taskBriefSchema = z.object({
  ...identityShape,
  activity: activitySchema,
  title: z.string().min(1).max(500),
  objective: z.string().min(1).max(16_384),
  acceptanceCriteria: z.array(z.string().min(1).max(2_000)).max(100),
  snapshotId: opaqueIdSchema,
  contextRevision: contextRevisionSchema,
  documentRepoCommit: fullShaSchema,
  sources: z.array(contextSourceSchema).max(500),
  requiredDeliverableIds: z.array(opaqueIdSchema).max(100),
  readiness: readinessSchema,
  blockers: z.array(readinessBlockerSchema),
  requiredContextStatus: z.enum(["complete", "partial"]),
  omittedSections: z.array(omittedSectionSchema).max(500),
  freshness: z.object({
    isCurrent: z.boolean(),
    observedAt: timestampSchema,
    newerContextRevision: contextRevisionSchema.optional(),
  }).strict(),
  fetchedAt: timestampSchema,
  nextCursor: opaqueIdSchema.optional(),
}).strict().superRefine((brief, context) => {
  if (brief.requiredContextStatus === "partial" && brief.omittedSections.length === 0) {
    context.addIssue({ code: "custom", path: ["omittedSections"], message: "partial briefs must identify omitted sections" });
  }
  if (brief.requiredContextStatus === "complete" && brief.omittedSections.length > 0) {
    context.addIssue({ code: "custom", path: ["omittedSections"], message: "complete briefs cannot omit sections" });
  }
});

export const citationSchema = z.object({
  sourceId: opaqueIdSchema,
  path: z.string().min(1).max(1000),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
}).strict().superRefine((citation, context) => {
  if (citation.startLine !== undefined && citation.endLine !== undefined && citation.endLine < citation.startLine) {
    context.addIssue({ code: "custom", path: ["endLine"], message: "must not be before startLine" });
  }
});

export const documentPageSchema = z.object({
  ...identityShape,
  snapshotId: opaqueIdSchema,
  sourceId: opaqueIdSchema,
  repositoryId: opaqueIdSchema,
  commit: fullShaSchema,
  path: z.string().min(1).max(1000),
  contentHash: contentHashSchema,
  text: z.string().max(DEFAULT_CONTEXT_BYTES),
  citations: z.array(citationSchema).max(500),
  complete: z.boolean(),
  requiredSectionsRemaining: z.array(opaqueIdSchema).max(500),
  nextCursor: opaqueIdSchema.optional(),
}).strict().superRefine((page, context) => {
  if (!page.complete && page.requiredSectionsRemaining.length === 0 && page.nextCursor === undefined) {
    context.addIssue({ code: "custom", path: ["requiredSectionsRemaining"], message: "incomplete pages must identify remaining content or a continuation" });
  }
});

export const sourceHitSchema = z.object({
  sourceId: opaqueIdSchema,
  sectionId: opaqueIdSchema,
  role: z.string().min(1).max(100),
  excerpt: z.string().min(1).max(DEFAULT_CONTEXT_BYTES),
  citation: citationSchema,
}).strict();

export const reviewFindingSchema = z.object({
  findingId: opaqueIdSchema,
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  title: z.string().min(1).max(500),
  rationale: z.string().min(1).max(8_000),
  citation: citationSchema.optional(),
  currentness: z.enum(["current", "superseded"]),
}).strict();

export const reviewReportSchema = z.object({
  schemaVersion: z.literal(MEMBER_SCHEMA_VERSION),
  projectId: projectIdSchema,
  unitId: z.string().refine(isFullUnitId),
  reviewId: opaqueIdSchema,
  generation: z.number().int().positive(),
  currentness: z.enum(["current", "superseded", "inconclusive"]),
  verdict: z.enum(["pass", "fail", "inconclusive"]),
  reviewedHead: fullShaSchema,
  reviewedBase: fullShaSchema,
  mergeBase: fullShaSchema.optional(),
  contextRevision: contextRevisionSchema,
  policyRevision: opaqueIdSchema,
  agentVersion: opaqueIdSchema,
  coverage: z.enum(["complete", "partial"]),
  findings: z.array(reviewFindingSchema).max(1000),
}).strict().superRefine((review, context) => {
  if (review.coverage === "partial" && review.verdict === "pass") {
    context.addIssue({ code: "custom", path: ["verdict"], message: "partial review coverage cannot pass" });
  }
});

export const taskStatusSchema = z.object({
  ...identityShape,
  status: z.enum(WORK_ITEM_STATUSES),
  pullRequests: z.array(z.object({
    repositoryId: opaqueIdSchema,
    pullRequestId: opaqueIdSchema,
    state: z.enum(["open", "closed", "merged", "unknown"]),
    headRevision: fullShaSchema,
    updatedAt: timestampSchema.optional(),
  }).strict()).max(100),
  currentReviewIds: z.array(opaqueIdSchema).max(100),
  gates: z.array(z.object({
    gateId: z.enum(GATE_IDS).or(opaqueIdSchema),
    status: z.enum(["pending", "approved", "rejected", "unknown"]),
    publication: z.enum(["pending", "published", "unknown"]),
  }).strict()).max(20),
  nextAction: z.string().min(1).max(1000),
}).strict();

const metadataValueSchema = z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()]);
export const taskEventSchema = z.object({
  ...identityShape,
  id: opaqueIdSchema,
  kind: z.string().min(1).max(100),
  occurredAt: timestampSchema,
  metadata: z.record(z.string().max(100), metadataValueSchema),
}).strict();

export const listResultSchema = <T extends z.ZodType>(item: T) => z.object({
  schemaVersion: z.literal(MEMBER_SCHEMA_VERSION),
  items: z.array(item).max(MAX_LIST_LIMIT),
  limit: z.number().int().min(1).max(MAX_LIST_LIMIT),
  nextCursor: opaqueIdSchema.optional(),
}).strict();

export const projectListResultSchema = listResultSchema(projectSummarySchema);
export const taskListResultSchema = listResultSchema(taskSummarySchema);
export const documentSearchResultSchema = listResultSchema(sourceHitSchema);

export type ProjectQueryValue = z.infer<typeof projectQuerySchema>;
export type TaskQueryValue = z.infer<typeof taskQuerySchema>;
export type TaskBriefQueryValue = z.infer<typeof taskBriefQuerySchema>;
export type DocumentQueryValue = z.infer<typeof documentQuerySchema>;
export type DocumentSearchQueryValue = z.infer<typeof documentSearchQuerySchema>;
export type ReviewQueryValue = z.infer<typeof reviewQuerySchema>;
export type TaskStatusQueryValue = z.infer<typeof taskStatusQuerySchema>;
export type TaskEventQueryValue = z.infer<typeof taskEventQuerySchema>;
export type TaskBriefValue = z.infer<typeof taskBriefSchema>;
export type DocumentPageValue = z.infer<typeof documentPageSchema>;
export type ReviewReportValue = z.infer<typeof reviewReportSchema>;
