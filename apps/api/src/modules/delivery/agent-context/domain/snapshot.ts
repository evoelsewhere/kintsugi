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

export type SnapshotStatus = "preparing" | "ready" | "failed" | "expiring" | "expired";

export class SnapshotLeaseUnavailableError extends Error {
  constructor() {
    super("snapshot lease is unavailable");
    this.name = "SnapshotLeaseUnavailableError";
  }
}

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

export type SnapshotCreateInput = Omit<SnapshotRecord, "status" | "createdAt" | "expiresAt"> & {
  retentionMs: number;
};

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
  abstract create(snapshot: SnapshotCreateInput): Promise<void>;
  abstract get(snapshotId: string): Promise<SnapshotRecord | undefined>;
  abstract isAvailable(snapshotId: string): Promise<boolean>;
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

// Keep 100 slots for unavailable-source markers in the 100-source snapshot limit.
export const MAX_CONTEXT_SECTIONS = 400;

/** Indexes Markdown by ATX headings without retaining source text in Postgres. */
export function indexMarkdownSections(
  sourceId: string,
  markdown: string,
  required: boolean,
  maxSections = MAX_CONTEXT_SECTIONS,
): SnapshotSectionIndex[] {
  if (!Number.isSafeInteger(maxSections) || maxSections < 1) throw new TypeError("maxSections must be a positive safe integer");
  const lines = markdown.split(/\r\n|\n|\r/);
  const headings: Array<{ line: number; title: string }> = [];
  let headingCount = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(lines[index] ?? "");
    if (match === null) continue;
    headingCount += 1;
    if (headings.length < maxSections) headings.push({ line: index + 1, title: match[2]!.trim() });
  }
  if (headingCount === 0) {
    const text = lines.join("\n");
    return [{
      sectionId: "sec_" + digest(sourceId + "\0document").slice(0, 24),
      title: "Document",
      startLine: 1,
      endLine: lines.length,
      byteLength: Buffer.byteLength(text, "utf8"),
      required,
    }];
  }

  const hasPreamble = headings[0]!.line !== 1;
  const totalSections = headingCount + (hasPreamble ? 1 : 0);
  const grouped = totalSections > maxSections;
  if (hasPreamble && maxSections === 1) {
    const suffix = " + " + totalSections + " sections";
    const text = lines.join("\n");
    return [{
      sectionId: "sec_" + digest(sourceId + "\0document-range\0" + lines.length).slice(0, 24),
      title: ("Document").slice(0, Math.max(1, 500 - suffix.length)) + suffix,
      startLine: 1,
      endLine: lines.length,
      byteLength: Buffer.byteLength(text, "utf8"),
      required,
    }];
  }
  const prefixCount = hasPreamble ? 1 : 0;
  const individualHeadingCount = grouped ? Math.max(0, maxSections - prefixCount - 1) : headingCount;
  const sections: SnapshotSectionIndex[] = [];
  const occurrences = new Map<string, number>();

  const addHeading = (heading: { line: number; title: string }, endLine: number, groupedCount?: number): void => {
    const key = heading.title.normalize("NFC").toLowerCase();
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    const sectionId = "sec_" + digest(sourceId + "\0" + key + "\0" + occurrence).slice(0, 24);
    const text = lines.slice(heading.line - 1, endLine).join("\n");
    const suffix = groupedCount === undefined ? "" : " + " + groupedCount + " sections";
    sections.push({
      sectionId: groupedCount === undefined
        ? sectionId
        : "sec_" + digest(sourceId + "\0range\0" + sectionId + "\0" + groupedCount + "\0" + endLine).slice(0, 24),
      title: suffix === "" ? heading.title : heading.title.slice(0, Math.max(1, 500 - suffix.length)) + suffix,
      startLine: heading.line,
      endLine,
      byteLength: Buffer.byteLength(text, "utf8"),
      required,
    });
  };

  if (hasPreamble) {
    const preambleEnd = headings[0]!.line - 1;
    const text = lines.slice(0, preambleEnd).join("\n");
    sections.push({
      sectionId: "sec_" + digest(sourceId + "\0document").slice(0, 24),
      title: "Document",
      startLine: 1,
      endLine: preambleEnd,
      byteLength: Buffer.byteLength(text, "utf8"),
      required,
    });
  }

  for (let index = 0; index < individualHeadingCount; index += 1) {
    const heading = headings[index]!;
    const endLine = headings[index + 1]?.line === undefined ? lines.length : headings[index + 1]!.line - 1;
    addHeading(heading, endLine);
  }

  if (grouped) {
    const groupStart = individualHeadingCount;
    const heading = headings[groupStart]!;
    const groupCount = headingCount - groupStart;
    addHeading(heading, lines.length, groupCount);
  }
  return sections;
}

/** Bounds the total section index while retaining every source range through coalesced tails. */
export function boundSnapshotSections(sources: readonly SnapshotSource[]): SnapshotSource[] {
  const nonEmptyCount = sources.reduce((count, source) => count + (source.sections.length > 0 ? 1 : 0), 0);
  if (nonEmptyCount > MAX_CONTEXT_SECTIONS) throw new RangeError("snapshot has more non-empty sources than the section limit");

  let remainingBudget = MAX_CONTEXT_SECTIONS;
  let remainingNonEmpty = nonEmptyCount;
  return sources.map((source) => {
    if (source.sections.length === 0) return { ...source, sections: [] };
    remainingNonEmpty -= 1;
    const allocation = Math.min(source.sections.length, Math.max(1, remainingBudget - remainingNonEmpty));
    remainingBudget -= allocation;
    if (source.sections.length <= allocation) return { ...source, sections: [...source.sections] };

    const prefix = source.sections.slice(0, allocation - 1);
    const tail = source.sections.slice(allocation - 1);
    const first = tail[0]!;
    const last = tail.at(-1)!;
    const titleSuffix = " + " + tail.length + " sections";
    const merged: SnapshotSectionIndex = {
      sectionId: "sec_" + digest(source.sourceId + "\0range\0" + first.sectionId + "\0" + last.sectionId).slice(0, 24),
      title: first.title.slice(0, Math.max(1, 500 - titleSuffix.length)) + titleSuffix,
      startLine: first.startLine,
      endLine: last.endLine,
      byteLength: tail.reduce((total, section) => total + section.byteLength, 0) + tail.length - 1,
      required: tail.some((section) => section.required),
    };
    return { ...source, sections: [...prefix, merged] };
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
