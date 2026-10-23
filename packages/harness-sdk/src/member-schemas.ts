import { IDENTIFIER_MAX_LENGTH, PROJECT_ID_PATTERN } from "@kintsugi/domain";
import { z } from "zod";

export const MEMBER_SCHEMA_VERSION = "1" as const;
export const DEFAULT_LIST_LIMIT = 25;
export const MAX_LIST_LIMIT = 100;
export const MAX_DOCUMENT_PATH_LENGTH = 1024;

const projectIdSchema = z.string().trim().min(1).max(IDENTIFIER_MAX_LENGTH).regex(PROJECT_ID_PATTERN);
const opaqueIdSchema = z.string().trim().min(1).max(512);
const refSchema = z.string().trim().min(1).max(256);
const pathSchema = z.string().max(MAX_DOCUMENT_PATH_LENGTH);
const versionSchema = z.literal(MEMBER_SCHEMA_VERSION).default(MEMBER_SCHEMA_VERSION);
const limitSchema = z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT);

export const projectQuerySchema = z.object({
  schemaVersion: versionSchema,
  limit: limitSchema,
  cursor: opaqueIdSchema.optional(),
}).strict();

export const documentTreeQuerySchema = z.object({
  schemaVersion: versionSchema,
  projectId: projectIdSchema,
  ref: refSchema.optional(),
  path: pathSchema.optional(),
}).strict();

export const documentFileQuerySchema = z.object({
  schemaVersion: versionSchema,
  projectId: projectIdSchema,
  ref: refSchema.optional(),
  path: pathSchema.min(1),
}).strict();

export const projectSummarySchema = z.object({
  projectId: projectIdSchema,
  name: z.string().min(1).max(200),
  role: z.string().min(1).max(100).optional(),
}).strict();

export const listResultSchema = <T extends z.ZodType>(item: T) => z.object({
  schemaVersion: z.literal(MEMBER_SCHEMA_VERSION),
  items: z.array(item).max(MAX_LIST_LIMIT),
  limit: z.number().int().min(1).max(MAX_LIST_LIMIT),
  nextCursor: opaqueIdSchema.optional(),
}).strict();

export const projectListResultSchema = listResultSchema(projectSummarySchema);

export const documentTreeSchema = z.object({
  schemaVersion: z.literal(MEMBER_SCHEMA_VERSION),
  projectId: projectIdSchema,
  ref: z.string().min(1),
  commit: z.string().min(1),
  path: z.string(),
  entries: z.array(z.object({
    path: z.string(),
    name: z.string(),
    kind: z.enum(["file", "dir"]),
    size: z.number().int().min(0).optional(),
  }).strict()),
}).strict();

export const documentFileSchema = z.object({
  schemaVersion: z.literal(MEMBER_SCHEMA_VERSION),
  projectId: projectIdSchema,
  ref: z.string().min(1),
  commit: z.string().min(1),
  path: z.string().min(1),
  size: z.number().int().min(0),
  content: z.string(),
}).strict();
