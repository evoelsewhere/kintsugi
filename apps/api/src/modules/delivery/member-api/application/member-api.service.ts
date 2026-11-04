// The common member read use cases: projects the member's token covers and the document repo of one of them.
// Authorization of project-scoped reads is done before this layer (AllowMemberRead); the list is filtered here.

import { createHash } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, PayloadTooLargeException, UnprocessableEntityException } from "@nestjs/common";
import {
  DEFAULT_LIST_LIMIT,
  DistributableError,
  MEMBER_SCHEMA_VERSION,
  type MemberFeatures,
  assertSafeHooks,
  type ActivityInput,
  type ActivityReceipt,
  type BrainBacklinks,
  type BrainBacklinksQuery,
  type BrainChanges,
  type BrainChangesQuery,
  type BrainGrep,
  type BrainGrepQuery,
  type BrainLookup,
  type BrainLookupQuery,
  type BrainRead,
  type BrainReadQuery,
  type BrainTree,
  type BrainTreeQuery,
  COMMENTS_ANSWER_MAX,
  type CommentsQuery,
  type MemberBrainNode,
  type PageComments,
  type DocumentFile,
  type DocumentTree,
  type ListResult,
  type PluginBundle,
  type PluginSummary,
  type ProjectSummary,
} from "@kintsugi/harness-sdk";
import { type BrainNode, PROJECT_ID_PATTERN } from "@kintsugi/domain";
import { PluginAccessService } from "#modules/admin/plugin-access/index.js";
import { PluginsService } from "#modules/admin/plugins/index.js";
import { ProjectAccessService } from "#modules/admin/project-access/index.js";
import type { MemberPrincipal } from "#modules/core/auth/index.js";
import { BrainService } from "#modules/delivery/brain/index.js";
import { DocumentsService } from "#modules/delivery/documents/index.js";
import { WikiCommentService } from "#modules/delivery/wiki/index.js";
import { isKintsugiActivityKind, MemberActivityService } from "#modules/monitoring/member-activity/index.js";

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

/** What one Brain read hands a member's agent: enough to reason on, small enough for a tool result. */
const BRAIN_READ_CHARS = 24_000;
const BRAIN_READ_CHILDREN = 30;

/** What a request that did not name a feature gets: the version 1 shape, as before the page attributes. */
const NO_FEATURES: MemberFeatures = { pageAttributes: false };

/**
 * A Brain node as the member contract shows it: its place in the tree is the breadcrumb. The page attributes of builder
 * 6 are added only for a client that asked for them in the features header, because installed CLIs reject a field they
 * do not know. Every node on the wire goes through this one function, so none can carry a field the client did not ask for.
 */
const memberNode = <T extends BrainNode>(
  { parentId: _parent, ordinal: _ordinal, depth: _depth, labels, status, owner, template, space, ...node }: T,
  features: MemberFeatures,
): Omit<T, "parentId" | "ordinal" | "depth" | "labels" | "status" | "owner" | "template" | "space"> & Partial<Pick<BrainNode, "labels" | "status" | "owner" | "template" | "space">> =>
  features.pageAttributes ? { ...node, labels, status, owner, template, space } : node;

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

@Injectable()
export class MemberApiService {
  constructor(
    private readonly projectAccess: ProjectAccessService,
    private readonly documents: DocumentsService,
    private readonly plugins: PluginsService,
    private readonly pluginAccess: PluginAccessService,
    private readonly activity: MemberActivityService,
    private readonly brain: BrainService,
    private readonly wikiComments: WikiCommentService,
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

  /** One level of the project's Brain with summaries (ADR-0091). */
  async brainTree(query: BrainTreeQuery, features: MemberFeatures = NO_FEATURES): Promise<BrainTree> {
    const view = await this.brain.tree(query.projectId, { node: query.node, depth: query.depth === 2 ? 2 : 1, offset: query.offset ?? 0, limit: query.limit ?? 50 });
    return {
      schemaVersion: MEMBER_SCHEMA_VERSION,
      ...view,
      node: memberNode(view.node, features),
      children: view.children.map(({ nodes, ...child }) => ({ ...memberNode(child, features), ...(nodes === undefined ? {} : { nodes: nodes.map((node) => memberNode(node, features)) }) })),
    };
  }

  /** A node's text with its citation; recorded as a read of the project's knowledge. */
  async brainRead(userId: string, query: BrainReadQuery, features: MemberFeatures = NO_FEATURES): Promise<BrainRead> {
    const view = await this.brain.read(query.projectId, { node: query.node, scope: query.scope ?? "auto", fromLine: query.fromLine, maxChars: BRAIN_READ_CHARS, lineNumbers: true });
    if (view.citation !== null) {
      await this.activity.observe({
        userId,
        projectId: query.projectId,
        kind: "brain.read",
        summary: view.node.id.slice(0, 500),
        detail: { commit: view.commit, lines: `${view.citation.lineStart}-${view.citation.lineEnd}`, truncated: view.truncated },
      });
    }
    return {
      schemaVersion: MEMBER_SCHEMA_VERSION,
      ...view,
      node: memberNode(view.node, features),
      children: view.children.slice(0, BRAIN_READ_CHILDREN).map((node) => memberNode(node, features)),
      outgoing: view.outgoing.map((node) => memberNode(node, features)),
      incoming: view.incoming.map((node) => memberNode(node, features)),
    };
  }

  async brainLookup(query: BrainLookupQuery, features: MemberFeatures = NO_FEATURES): Promise<BrainLookup> {
    const view = await this.brain.lookup(query.projectId, query.query);
    return { schemaVersion: MEMBER_SCHEMA_VERSION, ...view, matches: view.matches.map((node) => memberNode(node, features)) };
  }

  async brainGrep(query: BrainGrepQuery, features: MemberFeatures = NO_FEATURES): Promise<BrainGrep> {
    const view = await this.brain.grep(query.projectId, { text: query.text, under: query.under, ignoreCase: query.ignoreCase ?? true });
    return { schemaVersion: MEMBER_SCHEMA_VERSION, ...view, matches: view.matches.map((match) => ({ ...match, node: memberNode(match.node, features) satisfies MemberBrainNode })) };
  }

  /** The pages that link to a page, a heading or a card, a window of them (the Brain's own read, with every node as the contract shows it). */
  async brainBacklinks(query: BrainBacklinksQuery, features: MemberFeatures = NO_FEATURES): Promise<BrainBacklinks> {
    const view = await this.brain.backlinks(query.projectId, { node: query.node, offset: query.offset ?? 0, limit: query.limit ?? 20 });
    return {
      schemaVersion: MEMBER_SCHEMA_VERSION,
      ...view,
      node: memberNode(view.node, features),
      items: view.items.map((item) => ({ node: memberNode(item.node, features), target: memberNode(item.target, features), linkKind: item.linkKind })),
    };
  }

  /**
   * The comments of a wiki page, in time order: those of the threads that are open (the default) with their answers, or all.
   * A comment is a row of the wiki, never a line of a document, so it is given here and nowhere in the Brain; what the
   * people wrote is project data. At most `COMMENTS_ANSWER_MAX` are given and `truncated` says when there are more.
   */
  async comments(query: CommentsQuery): Promise<PageComments> {
    const status = query.status ?? "open";
    const kept: PageComments["comments"] = [];
    const open = new Set<string>();
    let page: { key: string; path: string } | undefined;
    let after: string | undefined;
    let truncated = false;
    for (;;) {
      const window = await this.wikiComments.list(query.projectId, query.path, 100, after);
      page = window.page;
      for (const comment of window.comments) {
        const wanted = status === "all" || (comment.parentId === null ? !comment.resolved && !comment.deleted : open.has(comment.parentId));
        if (comment.parentId === null && wanted) open.add(comment.id);
        if (!wanted) continue;
        if (kept.length >= COMMENTS_ANSWER_MAX) {
          truncated = true;
          break;
        }
        kept.push({
          id: comment.id,
          parentId: comment.parentId,
          author: { username: comment.author.username, displayName: comment.author.displayName },
          body: comment.body,
          createdAt: comment.createdAt,
          editedAt: comment.editedAt,
          resolved: comment.resolved,
          deleted: comment.deleted,
          node: comment.node,
          status: comment.status,
          line: comment.line,
          quote: comment.quote,
        });
      }
      if (truncated || window.next === null) break;
      after = window.next;
    }
    return { schemaVersion: MEMBER_SCHEMA_VERSION, projectId: query.projectId, page: page ?? { key: "", path: query.path }, comments: kept, truncated };
  }

  /** What changed in the Brain's documents since an earlier commit. */
  async brainChanges(query: BrainChangesQuery, features: MemberFeatures = NO_FEATURES): Promise<BrainChanges> {
    const view = await this.brain.changes(query.projectId, { since: query.since, under: query.under });
    return { schemaVersion: MEMBER_SCHEMA_VERSION, ...view, files: view.files.map((file) => ({ ...file, nodes: file.nodes.map((node) => memberNode(node, features)) })) };
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
      // A hook a plugin declares may only report to monitoring (ADR-0072); anything else keeps the plugin off members' machines.
      try { assertSafeHooks(path, content); } catch (error) {
        if (error instanceof DistributableError) throw new UnprocessableEntityException(`The plugin ${name} cannot be distributed: ${error.message}`);
        throw error;
      }
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
    if (isKintsugiActivityKind(input.kind)) throw new BadRequestException("kinds starting with plugin., document. or brain. are set by Kintsugi");
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
