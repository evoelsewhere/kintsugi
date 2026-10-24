// The common member read use cases: projects the member's token covers and the document repo of one of them.
// Authorization of project-scoped reads is done before this layer (AllowMemberRead); the list is filtered here.

import { createHash } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, PayloadTooLargeException } from "@nestjs/common";
import {
  DEFAULT_LIST_LIMIT,
  MEMBER_SCHEMA_VERSION,
  type ActivityInput,
  type ActivityReceipt,
  type DocumentFile,
  type DocumentTree,
  type ListResult,
  type PluginBundle,
  type PluginSummary,
  type ProjectSummary,
} from "@kintsugi/harness-sdk";
import { PROJECT_ID_PATTERN } from "@kintsugi/domain";
import { PluginAccessService } from "#modules/admin/plugin-access/index.js";
import { PluginsService } from "#modules/admin/plugins/index.js";
import { ProjectAccessService } from "#modules/admin/project-access/index.js";
import type { MemberPrincipal } from "#modules/core/auth/index.js";
import { DocumentsService } from "#modules/delivery/documents/index.js";
import { MemberActivityService } from "#modules/monitoring/member-activity/index.js";

const MAX_PROJECTS_PER_TOKEN = 100;
const MAX_LIST_LIMIT = 100;
const MAX_BUNDLE_FILES = 200;
const MAX_BUNDLE_BYTES = 1024 * 1024;

/**
 * What a member plugin hands to a member's harness: skills (text files), agents and commands. Hooks, scripts
 * and workflows run code and stay out; a plugin that needs them is not distributed this way.
 */
const BUNDLE_PATH = /^(?:skills\/[^/]+\/.+|agents\/[^/]+\.md|commands\/[^/]+\.md)$/;
const BUNDLE_TEXT = /\.(?:md|txt|json|ya?ml|csv)$/i;

/** Kinds Kintsugi writes itself from what it observes; a plugin cannot claim them. */
const RESERVED_KIND = /^(?:plugin|document)\./;

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

@Injectable()
export class MemberApiService {
  constructor(
    private readonly projectAccess: ProjectAccessService,
    private readonly documents: DocumentsService,
    private readonly plugins: PluginsService,
    private readonly pluginAccess: PluginAccessService,
    private readonly activity: MemberActivityService,
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

  async documentFile(userId: string, projectId: string, ref: string | undefined, path: string): Promise<DocumentFile> {
    const file = await this.documents.file(projectId, ref, path);
    await this.activity.observe({ userId, projectId, kind: "document.read", summary: file.path, detail: { ref: file.ref, size: file.size } });
    return { schemaVersion: MEMBER_SCHEMA_VERSION, projectId, ...file };
  }

  /** The member plugins the user may use in the project. */
  async listPlugins(userId: string, projectId: string): Promise<ListResult<PluginSummary>> {
    const granted = new Set(await this.pluginAccess.pluginsFor(userId, projectId));
    const items = (await this.plugins.list())
      .filter((plugin) => plugin.audience !== "runtime" && granted.has(plugin.name))
      .map((plugin) => ({ name: plugin.name, title: plugin.title, version: plugin.version, description: plugin.description }));
    return { schemaVersion: MEMBER_SCHEMA_VERSION, items, limit: MAX_LIST_LIMIT };
  }

  /** The files of one granted member plugin, each with its hash, and a hash over all of them. */
  async pluginBundle(userId: string, projectId: string, name: string): Promise<PluginBundle> {
    const available = await this.listPlugins(userId, projectId);
    const summary = available.items.find((item) => item.name === name);
    if (summary === undefined) throw new ForbiddenException("This plugin is not available to you in this project");
    const detail = await this.plugins.get(name);
    const paths = detail.memberFiles.filter((path) => BUNDLE_PATH.test(path) && BUNDLE_TEXT.test(path) && !path.split("/").includes("..")).sort();
    if (paths.length > MAX_BUNDLE_FILES) throw new PayloadTooLargeException(`The plugin has more than ${MAX_BUNDLE_FILES} distributable files`);
    let bytes = 0;
    const files: PluginBundle["files"] = [];
    for (const path of paths) {
      const { content } = await this.plugins.file(name, path);
      bytes += Buffer.byteLength(content, "utf8");
      if (bytes > MAX_BUNDLE_BYTES) throw new PayloadTooLargeException("The plugin is larger than 1 MiB");
      files.push({ path, content, sha256: sha256(content) });
    }
    const contentHash = `sha256:${sha256(files.map((file) => `${file.path}:${file.sha256}`).join(";"))}`;
    await this.activity.observe({ userId, projectId, pluginName: name, kind: "plugin.download", summary: `${name}@${summary.version}`, detail: { version: summary.version, contentHash, files: files.length } });
    return { schemaVersion: MEMBER_SCHEMA_VERSION, projectId, ...summary, contentHash, files };
  }

  /** A plugin's write-back: a named, bounded fact about the member's own work. */
  async recordActivity(userId: string, input: ActivityInput): Promise<ActivityReceipt> {
    if (RESERVED_KIND.test(input.kind)) throw new BadRequestException("kinds starting with plugin. or document. are set by Kintsugi");
    if (input.pluginName !== undefined && !(await this.pluginAccess.pluginsFor(userId, input.projectId)).includes(input.pluginName)) {
      throw new ForbiddenException("This plugin is not available to you in this project");
    }
    const id = await this.activity.record({
      userId,
      projectId: input.projectId,
      kind: input.kind,
      ...(input.pluginName === undefined ? {} : { pluginName: input.pluginName }),
      ...(input.harness === undefined ? {} : { harness: input.harness }),
      ...(input.summary === undefined ? {} : { summary: input.summary }),
      ...(input.detail === undefined ? {} : { detail: input.detail }),
    });
    return { schemaVersion: MEMBER_SCHEMA_VERSION, id };
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
