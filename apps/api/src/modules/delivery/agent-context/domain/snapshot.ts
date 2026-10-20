// Immutable Coding Agent Workflow context identity and source-section index.

import { createHash } from "node:crypto";
import type { MemberActivity, ReadinessResult, SourceApproval, SourceAvailability, SourcePublication, WorkItemFile } from "@kintsugi/domain";

export interface SnapshotSectionIndex {
  sectionId: string;
  title: string;
  startLine: number;
  endLine: number;
  byteLength: number;
  required: boolean;
}

export interface SnapshotTaskSource {
  sourceId: string;
  repositoryId: string;
  path: string;
  commit: string;
  contentHash: string;
}

export interface SnapshotSource {
  sourceId: string;
  role: string;
  repositoryId: string;
  path: string;
  commit?: string;
  contentHash?: string;
  availability: SourceAvailability;
  publication: SourcePublication;
  approval: SourceApproval;
  requiredFor: readonly MemberActivity[];
  required: boolean;
  readable: boolean;
  sections: readonly SnapshotSectionIndex[];
}

export interface SnapshotRepositoryPin {
  repositoryId: string;
  commit: string;
}

export interface SnapshotManifestInput {
  snapshotId: string;
  projectId: string;
  unitId: string;
  activity: MemberActivity;
  repositories: readonly SnapshotRepositoryPin[];
  task: SnapshotTaskSource;
  sources: readonly SnapshotSource[];
  requiredDeliverableIds: readonly string[];
  policyRevision: string;
}

export interface SnapshotManifest extends SnapshotManifestInput {
  repositories: SnapshotRepositoryPin[];
  sources: SnapshotSource[];
  requiredDeliverableIds: string[];
  contextRevision: string;
}

export type SnapshotStatus = "preparing" | "ready" | "failed" | "expired";

export interface SnapshotRecord {
  manifest: SnapshotManifest;
  workItem: WorkItemFile;
  readiness: ReadinessResult;
  requestedByUserId: string;
  status: SnapshotStatus;
  createdAt: string;
  expiresAt: string;
  errorCode?: string;
}

export interface SnapshotCursorRecord {
  cursorId: string;
  snapshotId: string;
  kind: "document" | "search";
  sourceId?: string;
  sectionId?: string;
  characterOffset?: number;
  queryHash?: string;
  resultOffset?: number;
}

export type SnapshotCursorInput = Omit<SnapshotCursorRecord, "cursorId">;

/** Persistence port; create atomically records the manifest, source index and retention outbox intent. */
export abstract class SnapshotRepository {
  abstract create(snapshot: Omit<SnapshotRecord, "status">): Promise<void>;
  abstract get(snapshotId: string): Promise<SnapshotRecord | undefined>;
  abstract createCursor(cursor: SnapshotCursorInput): Promise<string>;
  abstract getCursor(cursorId: string): Promise<SnapshotCursorRecord | undefined>;
  abstract acquireLease(snapshotId: string, purpose: string, ownerId: string, expiresAt?: string): Promise<void>;
  abstract releaseLease(snapshotId: string, purpose: string, ownerId: string): Promise<void>;
}

/**
 * Builds a deterministic manifest. The full commits remain pinned for retrieval, while the
 * context revision hashes only the relevant file identities/content and policy. A generated-only
 * commit therefore creates a new immutable snapshot without changing the task's context revision.
 */
export function buildSnapshotManifest(input: SnapshotManifestInput): SnapshotManifest {
  const repositories = [...input.repositories]
    .map((repository) => ({ ...repository }))
    .sort((left, right) => left.repositoryId.localeCompare(right.repositoryId));
  const sources = [...input.sources]
    .map((source) => ({ ...source, requiredFor: [...source.requiredFor], sections: [...source.sections] }))
    .sort((left, right) => left.repositoryId.localeCompare(right.repositoryId) || left.path.localeCompare(right.path));
  const task = { ...input.task };
  const requiredDeliverableIds = [...input.requiredDeliverableIds].sort();
  const revisionInput = {
    schemaVersion: "1",
    projectId: input.projectId,
    unitId: input.unitId,
    activity: input.activity,
    policyRevision: input.policyRevision,
    task: {
      sourceId: task.sourceId,
      repositoryId: task.repositoryId,
      path: task.path,
      contentHash: task.contentHash,
    },
    sources: sources.map((source) => ({
      sourceId: source.sourceId,
      role: source.role,
      repositoryId: source.repositoryId,
      path: source.path,
      ...(source.contentHash === undefined ? {} : { contentHash: source.contentHash }),
      availability: source.availability,
      publication: source.publication,
      approval: source.approval,
      requiredFor: [...source.requiredFor].sort(),
      required: source.required,
      readable: source.readable,
    })),
    requiredDeliverableIds,
  };
  const contextRevision = "sha256:" + createHash("sha256").update(canonicalJson(revisionInput), "utf8").digest("hex");
  return {
    snapshotId: input.snapshotId,
    projectId: input.projectId,
    unitId: input.unitId,
    activity: input.activity,
    repositories,
    task,
    sources,
    requiredDeliverableIds,
    policyRevision: input.policyRevision,
    contextRevision,
  };
}

/** Indexes Markdown by ATX headings without retaining source text in Postgres. */
export function indexMarkdownSections(sourceId: string, markdown: string, required: boolean): SnapshotSectionIndex[] {
  const lines = markdown.split(/\r\n|\n|\r/);
  const headings = lines.flatMap((line, index) => {
    const match = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    return match === null ? [] : [{ line: index + 1, title: match[2]!.trim() }];
  });
  const starts = headings[0]?.line === 1 ? headings : [{ line: 1, title: "Document" }, ...headings];
  if (headings.length === 0) starts.splice(0, starts.length, { line: 1, title: "Document" });

  const occurrences = new Map<string, number>();
  return starts.map((heading, index) => {
    const endLine = starts[index + 1]?.line === undefined ? lines.length : starts[index + 1]!.line - 1;
    const key = heading.title.normalize("NFC").toLowerCase();
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    const sectionId = "sec_" + digest(sourceId + "\0" + key + "\0" + occurrence).slice(0, 24);
    const text = lines.slice(heading.line - 1, endLine).join("\n");
    return {
      sectionId,
      title: heading.title,
      startLine: heading.line,
      endLine,
      byteLength: Buffer.byteLength(text, "utf8"),
      required,
    };
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(record[key])).join(",") + "}";
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
