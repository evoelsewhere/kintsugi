// The common member read use cases: projects the member's token covers and the document repo of one of them.
// Authorization of project-scoped reads is done before this layer (AllowMemberRead); the list is filtered here.

import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { DEFAULT_LIST_LIMIT, MEMBER_SCHEMA_VERSION, type DocumentFile, type DocumentTree, type ListResult, type ProjectSummary } from "@kintsugi/harness-sdk";
import { PROJECT_ID_PATTERN } from "@kintsugi/domain";
import { ProjectAccessService } from "#modules/admin/project-access/index.js";
import type { MemberPrincipal } from "#modules/core/auth/index.js";
import { DocumentsService } from "#modules/delivery/documents/index.js";

const MAX_PROJECTS_PER_TOKEN = 100;
const MAX_LIST_LIMIT = 100;

@Injectable()
export class MemberApiService {
  constructor(
    private readonly projectAccess: ProjectAccessService,
    private readonly documents: DocumentsService,
  ) {}

  async listProjects(principal: MemberPrincipal, query: { limit?: number; cursor?: string }): Promise<ListResult<ProjectSummary>> {
    if (principal.projectIds.length > MAX_PROJECTS_PER_TOKEN) throw new ForbiddenException("The token has no valid project scope");
    const limit = query.limit ?? DEFAULT_LIST_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) throw new BadRequestException("limit must be between 1 and 100");
    const after = decodeProjectCursor(query.cursor);
    const allowed = new Set(principal.projectIds);
    const readable = await this.projectAccess.listReadableProjects(principal.userId, principal.projectIds);
    const ordered = [...new Map(
      readable.filter((project) => allowed.has(project.projectId)).map((project) => [project.projectId, { projectId: project.projectId, name: project.name }]),
    ).values()].sort((left, right) => compare(left.projectId, right.projectId));
    const candidates = ordered.filter((project) => after === undefined || compare(project.projectId, after) > 0);
    const items = candidates.slice(0, limit);
    const last = items.at(-1);
    return {
      schemaVersion: MEMBER_SCHEMA_VERSION,
      items,
      limit,
      ...(candidates.length > limit && last !== undefined ? { nextCursor: Buffer.from(last.projectId, "utf8").toString("base64url") } : {}),
    };
  }

  async documentTree(projectId: string, ref: string | undefined, path: string | undefined): Promise<DocumentTree> {
    const tree = await this.documents.tree(projectId, ref, path ?? "");
    return { schemaVersion: MEMBER_SCHEMA_VERSION, projectId, ...tree };
  }

  async documentFile(projectId: string, ref: string | undefined, path: string): Promise<DocumentFile> {
    const file = await this.documents.file(projectId, ref, path);
    return { schemaVersion: MEMBER_SCHEMA_VERSION, projectId, ...file };
  }
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function decodeProjectCursor(cursor: string | undefined): string | undefined {
  if (cursor === undefined) return undefined;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (decoded.length === 0 || Buffer.from(decoded, "utf8").toString("base64url") !== cursor || !PROJECT_ID_PATTERN.test(decoded)) {
    throw new BadRequestException("cursor is invalid");
  }
  return decoded;
}
