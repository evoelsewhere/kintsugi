import { BRAIN_NODE_KINDS, BRAIN_SUMMARY_SOURCES, IDENTIFIER_MAX_LENGTH, PROJECT_ID_PATTERN } from "@kintsugi/domain";
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

const pluginNameSchema = z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/);
const harnessSchema = z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9._-]*$/);
const kindSchema = z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9._-]*$/);

export const MAX_ACTIVITY_SUMMARY_LENGTH = 500;

export const pluginSummarySchema = z.object({
  name: pluginNameSchema,
  title: z.string().min(1).max(200),
  version: z.string().min(1).max(64),
  description: z.string().max(2000),
}).strict();

export const pluginListQuerySchema = z.object({
  schemaVersion: versionSchema,
  projectId: projectIdSchema,
}).strict();

export const pluginBundleQuerySchema = z.object({
  schemaVersion: versionSchema,
  projectId: projectIdSchema,
  name: pluginNameSchema,
}).strict();

export const pluginListResultSchema = listResultSchema(pluginSummarySchema);

export const pluginBundleSchema = pluginSummarySchema.extend({
  schemaVersion: z.literal(MEMBER_SCHEMA_VERSION),
  projectId: projectIdSchema,
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  files: z.array(z.object({
    path: z.string().min(1).max(300),
    content: z.string(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()).max(200),
}).strict();

export const activityDetailSchema = z.record(z.string().max(64), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).refine((value) => Object.keys(value).length <= 20, "at most 20 detail entries");

/** Body of a plugin's write-back; the same shape is the MCP tool input and the CLI options. */
export const activityInputSchema = z.object({
  schemaVersion: versionSchema,
  projectId: projectIdSchema,
  kind: kindSchema,
  pluginName: pluginNameSchema.optional(),
  harness: harnessSchema.optional(),
  summary: z.string().max(MAX_ACTIVITY_SUMMARY_LENGTH).optional(),
  detail: activityDetailSchema.optional(),
}).strict();

export const activityReceiptSchema = z.object({
  schemaVersion: z.literal(MEMBER_SCHEMA_VERSION),
  id: z.string().min(1).max(100),
}).strict();

// ---------------------------------------------------------------------------
// The Brain (ADR-0091): the tree index of the project's document repository. The member's agent reasons over the
// tree itself; these reads return a level with summaries, a node's text with its citation, a jump to an id or a
// path, and the nodes holding a fixed string. Nothing is ranked by similarity.
// ---------------------------------------------------------------------------

export const MAX_BRAIN_NODE_ID_LENGTH = 2000;
export const DEFAULT_BRAIN_TREE_LIMIT = 50;

const brainNodeIdSchema = z.string().trim().min(1).max(MAX_BRAIN_NODE_ID_LENGTH);
const queryBoolean = z.preprocess((value) => (value === "true" || value === "1" ? true : value === "false" || value === "0" ? false : value), z.boolean());

export const brainNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(BRAIN_NODE_KINDS),
  title: z.string(),
  summary: z.string(),
  summarySource: z.enum(BRAIN_SUMMARY_SOURCES),
  path: z.string(),
  anchor: z.string().nullable(),
  lineStart: z.number().int().nullable(),
  lineEnd: z.number().int().nullable(),
  subtreeEnd: z.number().int().nullable(),
  tokens: z.number().int().min(0),
  subtreeTokens: z.number().int().min(0),
  children: z.number().int().min(0),
  ids: z.array(z.string()),
}).strict();

const brainCrumbSchema = z.object({ id: z.string(), kind: brainNodeSchema.shape.kind, title: z.string() }).strict();
const brainLinkedNodeSchema = brainNodeSchema.extend({ linkKind: z.enum(["link", "id"]) });
const brainIndexSchema = {
  schemaVersion: z.literal(MEMBER_SCHEMA_VERSION),
  projectId: projectIdSchema,
  branch: z.string().min(1),
  commit: z.string().min(1),
};

export const brainTreeQuerySchema = z.object({
  schemaVersion: versionSchema,
  projectId: projectIdSchema,
  node: brainNodeIdSchema.optional(),
  depth: z.coerce.number().int().min(1).max(2).default(1),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_BRAIN_TREE_LIMIT),
}).strict();

export const brainReadQuerySchema = z.object({
  schemaVersion: versionSchema,
  projectId: projectIdSchema,
  node: brainNodeIdSchema,
  scope: z.enum(["auto", "subtree", "node"]).default("auto"),
  fromLine: z.coerce.number().int().min(1).optional(),
}).strict();

export const brainLookupQuerySchema = z.object({
  schemaVersion: versionSchema,
  projectId: projectIdSchema,
  query: z.string().trim().min(1).max(MAX_BRAIN_NODE_ID_LENGTH),
}).strict();

export const brainGrepQuerySchema = z.object({
  schemaVersion: versionSchema,
  projectId: projectIdSchema,
  text: z.string().trim().min(2).max(200),
  under: brainNodeIdSchema.optional(),
  ignoreCase: queryBoolean.default(true),
}).strict();

export const brainTreeSchema = z.object({
  ...brainIndexSchema,
  node: brainNodeSchema,
  breadcrumb: z.array(brainCrumbSchema),
  children: z.array(brainNodeSchema.extend({ nodes: z.array(brainNodeSchema).optional() })),
  total: z.number().int().min(0),
  offset: z.number().int().min(0),
}).strict();

export const brainReadSchema = z.object({
  ...brainIndexSchema,
  node: brainNodeSchema,
  breadcrumb: z.array(brainCrumbSchema),
  scope: z.enum(["subtree", "node"]),
  text: z.string(),
  lineNumbers: z.boolean(),
  citation: z.object({ nodeId: z.string(), path: z.string(), lineStart: z.number().int(), lineEnd: z.number().int(), commit: z.string() }).strict().nullable(),
  truncated: z.boolean(),
  nextLine: z.number().int().nullable(),
  children: z.array(brainNodeSchema),
  outgoing: z.array(brainLinkedNodeSchema),
  incoming: z.array(brainLinkedNodeSchema),
  outgoingTotal: z.number().int().min(0),
  incomingTotal: z.number().int().min(0),
}).strict();

export const brainLookupSchema = z.object({
  ...brainIndexSchema,
  query: z.string(),
  matches: z.array(brainNodeSchema.extend({ breadcrumb: z.array(brainCrumbSchema) })),
}).strict();

export const brainGrepSchema = z.object({
  ...brainIndexSchema,
  text: z.string(),
  under: z.string().nullable(),
  matches: z.array(z.object({ node: brainNodeSchema, breadcrumb: z.array(brainCrumbSchema), line: z.number().int(), excerpt: z.string() }).strict()),
  truncated: z.boolean(),
}).strict();
