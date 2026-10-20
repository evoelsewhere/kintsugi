// Reads bounded, cited content only from the immutable commits in an authorized snapshot.

import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  PayloadTooLargeException,
} from "@nestjs/common";
import type {
  DocumentPage,
  DocumentQuery,
  DocumentSearchQuery,
  ListResult,
  SourceHit,
} from "@kintsugi/harness-sdk";
import { DEFAULT_CONTEXT_BYTES, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "@kintsugi/harness-sdk";
import type { MemberPrincipal } from "#modules/core/auth/index.js";
import { MAX_CONTEXT_SECTIONS, SnapshotRepository, type SnapshotSectionIndex } from "../domain/snapshot.js";
import { SnapshotService } from "./snapshot.service.js";

const MAX_SEARCH_SOURCE_COUNT = 100;
const MAX_SEARCH_BYTES = 8 * 1024 * 1024;
const FULL_DOCUMENT_SECTION = "__document__";
const CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class DocumentQueryService {
  constructor(
    private readonly snapshots: SnapshotRepository,
    private readonly snapshotService: SnapshotService,
  ) {}

  async get(principal: MemberPrincipal, query: DocumentQuery): Promise<DocumentPage> {
    await this.snapshotService.authorize(principal, query.projectId);
    const record = await this.snapshotService.requireSnapshot(query.snapshotId);
    this.snapshotService.assertIdentity(record, query.projectId, query.unitId, record.manifest.activity);
    await this.snapshotService.assertAvailable(record);
    this.assertReady(record.status);

    const sourceId = query.sourceId;
    let sectionId = query.sectionId;
    let offset = 0;
    if (query.cursor !== undefined) {
      if (!CURSOR_ID.test(query.cursor)) throw new BadRequestException("cursor is invalid");
      const cursor = await this.snapshots.getCursor(query.cursor);
      if (
        cursor === undefined ||
        cursor.kind !== "document" ||
        cursor.snapshotId !== query.snapshotId ||
        cursor.sourceId !== query.sourceId ||
        (query.sectionId !== undefined && cursor.sectionId !== query.sectionId) ||
        cursor.characterOffset === undefined ||
        cursor.sectionId === undefined
      ) {
        throw new BadRequestException("cursor is invalid for this snapshot, source and section");
      }
      sectionId = cursor.sectionId;
      offset = cursor.characterOffset;
    } else if (sectionId === undefined) {
      sectionId = FULL_DOCUMENT_SECTION;
    }

    const source = record.manifest.sources.find((candidate) => candidate.sourceId === sourceId);
    if (source === undefined) throw new BadRequestException("sourceId is not part of this snapshot");
    const content = await this.snapshotService.readSource(record, source);
    const sections = source.sections;
    let requestedText = content;
    let requestedStartLine = 1;
    let requestedSection: SnapshotSectionIndex | undefined;
    if (sectionId !== FULL_DOCUMENT_SECTION) {
      requestedSection = sections.find((section) => section.sectionId === sectionId);
      if (requestedSection === undefined) throw new BadRequestException("sectionId is not part of this snapshot source");
      requestedText = content.split(/\r\n|\n|\r/).slice(requestedSection.startLine - 1, requestedSection.endLine).join("\n");
      requestedStartLine = requestedSection.startLine;
    }

    const maxBytes = query.maxBytes ?? DEFAULT_CONTEXT_BYTES;
    const page = sliceUtf8(requestedText, offset, maxBytes);
    const before = Array.from(requestedText).slice(0, offset).join("");
    const startLine = requestedStartLine + countLines(before);
    const endLine = startLine + countLines(page.text);
    const citations = page.text.length === 0
      ? []
      : [{
          sourceId: source.sourceId,
          path: source.path,
          startLine,
          endLine,
        }];

    const remainingSections = requiredSectionsAfter(sections, requestedSection, page.complete, endLine);
    let nextCursor: string | undefined;
    if (!page.complete) {
      nextCursor = await this.snapshots.createCursor({
        snapshotId: query.snapshotId,
        kind: "document",
        sourceId: source.sourceId,
        sectionId: sectionId!,
        characterOffset: page.nextOffset,
      });
    }

    const result: DocumentPage = {
      schemaVersion: "1",
      projectId: record.manifest.projectId,
      unitId: record.manifest.unitId,
      snapshotId: record.manifest.snapshotId,
      sourceId: source.sourceId,
      repositoryId: source.repositoryId,
      commit: source.commit!,
      path: source.path,
      contentHash: source.contentHash!,
      text: page.text,
      citations,
      complete: page.complete,
      requiredSectionsRemaining: remainingSections,
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
    return result;
  }

  async search(principal: MemberPrincipal, query: DocumentSearchQuery): Promise<ListResult<SourceHit>> {
    await this.snapshotService.authorize(principal, query.projectId);
    const record = await this.snapshotService.requireSnapshot(query.snapshotId);
    this.snapshotService.assertIdentity(record, query.projectId, query.unitId, record.manifest.activity);
    await this.snapshotService.assertAvailable(record);
    this.assertReady(record.status);

    const normalizedQuery = query.query.trim().toLocaleLowerCase("en-US");
    const queryHash = hash(normalizedQuery);
    const limit = query.limit ?? DEFAULT_LIST_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
      throw new BadRequestException("limit must be between 1 and " + MAX_LIST_LIMIT);
    }
    let offset = 0;
    if (query.cursor !== undefined) {
      if (!CURSOR_ID.test(query.cursor)) throw new BadRequestException("cursor is invalid");
      const cursor = await this.snapshots.getCursor(query.cursor);
      if (cursor === undefined || cursor.kind !== "search" || cursor.snapshotId !== query.snapshotId || cursor.queryHash !== queryHash || cursor.resultOffset === undefined) {
        throw new BadRequestException("cursor is invalid for this snapshot and query");
      }
      offset = cursor.resultOffset;
    }

    const searchable = record.manifest.sources.filter((source) => source.readable && source.availability === "present");
    if (searchable.length > MAX_SEARCH_SOURCE_COUNT) {
      throw new PayloadTooLargeException("The snapshot has too many sources for bounded search");
    }
    const sectionCount = searchable.reduce((total, source) => total + source.sections.length, 0);
    if (sectionCount > MAX_CONTEXT_SECTIONS) {
      throw new PayloadTooLargeException("The snapshot has too many sections for bounded search");
    }
    const hits: SourceHit[] = [];
    let totalBytes = 0;
    for (const source of searchable) {
      const content = await this.snapshotService.readSource(record, source);
      totalBytes += Buffer.byteLength(content, "utf8");
      if (totalBytes > MAX_SEARCH_BYTES) throw new PayloadTooLargeException("The snapshot exceeds the bounded search byte limit");
      const lines = content.split(/\r\n|\n|\r/);
      for (const section of source.sections) {
        const sectionText = lines.slice(section.startLine - 1, section.endLine).join("\n");
        const excerpt = findExcerpt(sectionText, query.query.trim());
        if (excerpt === undefined) continue;
        hits.push({
          sourceId: source.sourceId,
          sectionId: section.sectionId,
          role: source.role,
          excerpt,
          citation: {
            sourceId: source.sourceId,
            path: source.path,
            startLine: section.startLine,
            endLine: section.endLine,
          },
        });
      }
    }

    const items = hits.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    let nextCursor: string | undefined;
    if (nextOffset < hits.length) {
      nextCursor = await this.snapshots.createCursor({
        snapshotId: query.snapshotId,
        kind: "search",
        queryHash,
        resultOffset: nextOffset,
      });
    }
    return {
      schemaVersion: "1",
      items,
      limit,
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
  }

  private assertReady(status: string): void {
    if (status === "failed") throw new ConflictException("SNAPSHOT_UNAVAILABLE");
    if (status !== "ready") throw new ConflictException("SNAPSHOT_PREPARING");
  }
}

function sliceUtf8(text: string, offset: number, maxBytes: number): { text: string; nextOffset: number; complete: boolean } {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new BadRequestException("cursor offset is invalid");
  const codePoints = Array.from(text);
  if (offset > codePoints.length) throw new BadRequestException("cursor offset is outside the source");
  let bytes = 0;
  let end = offset;
  while (end < codePoints.length) {
    const size = Buffer.byteLength(codePoints[end]!, "utf8");
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += 1;
  }
  if (end === offset && end < codePoints.length) throw new PayloadTooLargeException("maxBytes is too small for the next source character");
  return {
    text: codePoints.slice(offset, end).join(""),
    nextOffset: end,
    complete: end === codePoints.length,
  };
}

function countLines(value: string): number {
  return (value.match(/\n/g) ?? []).length;
}

function requiredSectionsAfter(
  sections: readonly SnapshotSectionIndex[],
  current: SnapshotSectionIndex | undefined,
  currentComplete: boolean,
  nextLine: number,
): string[] {
  if (current === undefined) {
    return currentComplete
      ? []
      : sections.filter((section) => section.required && section.endLine >= nextLine).map((section) => section.sectionId);
  }
  return sections
    .filter((section) => section.required && (section.startLine > current.startLine || (!currentComplete && section.sectionId === current.sectionId)))
    .map((section) => section.sectionId);
}

function findExcerpt(text: string, query: string): string | undefined {
  const points = Array.from(text);
  const lower = points.map((point) => point.toLocaleLowerCase("en-US")).join("");
  const needle = query.toLocaleLowerCase("en-US");
  const index = lower.indexOf(needle);
  if (index < 0) return undefined;
  const start = Math.max(0, index - 80);
  const end = Math.min(points.length, start + 320);
  return points.slice(start, end).join("").trim();
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
