// Application layer of the Brain (ADR-0091): the state of a project's tree index, its branch and builds, and the
// reads an agent reasons with — a level of the tree with summaries, a node's text with its citation, a jump to a
// reference id or path, and a fixed-string search mapped back to nodes. Nothing here ranks by similarity or calls
// a model; the text is read from the mirror at the indexed commit, so a citation always matches what was read.

import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  BRAIN_ROOT_ID,
  type BrainCrumb,
  type BrainGrepMatch,
  type BrainGrepView,
  type BrainLookupView,
  type BrainNode,
  type BrainReadView,
  type BrainSource,
  type BrainState,
  type BrainStatusView,
  type BrainTreeView,
  isBrainIndexedPath,
  isBrainReferenceId,
  parseBrainNodeId,
} from "@kintsugi/domain";
import type { Actor } from "#common/auth/decorators.js";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import { type DocumentContext, DocumentsService } from "#modules/delivery/documents/index.js";
import { BrainBuildQueue, BrainIndex } from "../domain/brain.ports.js";

/** A node at most this large is read whole with what is under it when the reader does not say. */
export const BRAIN_AUTO_SUBTREE_TOKENS = 6000;
const MAX_CHILDREN = 200;
const GRANDCHILDREN = 20;
const READ_CHILDREN = 50;
const READ_LINKS = 20;
const LOOKUP_LIMIT = 20;
const GREP_LIMIT = 50;
const EXCERPT = 240;
const OUTPUT_BRANCH = "kintsugi/";

export interface BrainTreeQuery {
  node?: string | undefined;
  depth: 1 | 2;
  offset: number;
  limit: number;
}

export interface BrainReadQuery {
  node: string;
  scope: "auto" | "subtree" | "node";
  fromLine?: number | undefined;
  maxChars: number;
  /** Start every line with its number and a tab, so an agent can cite exactly the lines it used. */
  lineNumbers?: boolean;
}

export interface BrainGrepQuery {
  text: string;
  under?: string | undefined;
  ignoreCase: boolean;
}

interface ReadyIndex {
  source: BrainSource & { indexedCommit: string };
}

const crumb = (node: BrainNode): BrainCrumb => ({ id: node.id, kind: node.kind, title: node.title });

/** The terms a search looks for on one line: the quoted phrase, or each word (at most eight). */
export function termsOf(text: string): string[] {
  const quoted = /^"(.+)"$/.exec(text.trim());
  if (quoted?.[1] !== undefined) return [quoted[1]];
  return [...new Set(text.trim().split(/\s+/).filter((word) => word !== ""))].slice(0, 8);
}

function excerptOf(text: string, needle: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= EXCERPT) return flat;
  const at = Math.max(0, flat.toLowerCase().indexOf(needle.toLowerCase()));
  const start = Math.max(0, Math.min(at - 60, flat.length - EXCERPT));
  return `${start > 0 ? "…" : ""}${flat.slice(start, start + EXCERPT)}${start + EXCERPT < flat.length ? "…" : ""}`;
}

@Injectable()
export class BrainService {
  constructor(
    private readonly index: BrainIndex,
    private readonly queue: BrainBuildQueue,
    private readonly documents: DocumentsService,
    private readonly audit: AuditTrail,
  ) {}

  // -------------------------------------------------------------------------
  // State and management
  // -------------------------------------------------------------------------

  /** The index state, the branch it follows and the branches it could follow. */
  async status(projectId: string): Promise<BrainStatusView> {
    const source = await this.index.source(projectId);
    let context: DocumentContext | undefined;
    let reason: string | undefined;
    try {
      context = await this.documents.context(projectId);
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      reason = error.message;
    }
    const tips = context === undefined ? undefined : await this.documents.branchTips(context);
    const defaultBranch = context?.defaultBranch ?? null;
    const branches = tips === undefined ? [] : [...tips.tips.keys()].filter((name) => !name.startsWith(OUTPUT_BRANCH)).sort((a, b) => (a === defaultBranch ? -1 : b === defaultBranch ? 1 : a.localeCompare(b)));
    const branch = source?.branch ?? defaultBranch ?? "main";
    const state: BrainState = source === undefined ? "not-built" : source.enabled ? source.state : "off";
    return {
      projectId,
      available: context !== undefined,
      ...(reason === undefined ? {} : { reason }),
      configured: source !== undefined,
      enabled: source?.enabled ?? false,
      state,
      branch,
      defaultBranch,
      branches,
      commit: source?.indexedCommit ?? null,
      tip: tips?.tips.get(branch)?.commit ?? null,
      indexedAt: source?.indexedAt ?? null,
      documents: source?.documents ?? 0,
      nodes: source?.nodes ?? 0,
      identifiers: source?.identifiers ?? 0,
      links: source?.links ?? 0,
      tokens: source?.tokens ?? 0,
      skipped: source?.skipped ?? 0,
      durationMs: source?.durationMs ?? null,
      error: source?.error ?? null,
      updatedBy: source?.updatedBy ?? null,
      updatedAt: source?.updatedAt ?? null,
    };
  }

  /** Chooses the branch and turns the index on or off; an enabled index is built at once. */
  async configure(projectId: string, input: { branch?: string | undefined; enabled: boolean }, actor: Actor): Promise<BrainStatusView> {
    const context = await this.documents.context(projectId);
    const current = await this.index.source(projectId);
    const branch = input.branch ?? current?.branch ?? context.defaultBranch;
    if (input.enabled) {
      if (branch.startsWith(OUTPUT_BRANCH)) throw new BadRequestException(`${branch} is an output branch of Kintsugi, not reviewed yet: index a branch people merge into.`);
      const { tips } = await this.documents.branchTips(context);
      if (!tips.has(branch)) throw new BadRequestException(`Branch ${branch} is not in the mirror of the document repository.`);
    }
    await this.index.configure(projectId, { branch, enabled: input.enabled }, actor.username ?? actor.id);
    if (input.enabled) await this.queue.enqueue(projectId);
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.brainConfigure, { projectId, detail: { branch, enabled: input.enabled } }));
    return this.status(projectId);
  }

  /** Builds the index again from the tip of its branch. */
  async rebuild(projectId: string, actor: Actor): Promise<BrainStatusView> {
    const requested = await this.index.request(projectId, actor.username ?? actor.id);
    if (requested === undefined) throw new ConflictException("The Brain of this project is off: turn it on first.");
    await this.queue.enqueue(projectId);
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.brainRebuild, { projectId }));
    return this.status(projectId);
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  private async ready(projectId: string): Promise<ReadyIndex> {
    const source = await this.index.source(projectId);
    if (source === undefined) throw new ConflictException("The Brain of this project is not set up: a manager builds it under Brain.");
    if (!source.enabled) throw new ConflictException("The Brain of this project is off.");
    if (source.indexedCommit === null) {
      throw new ConflictException(source.state === "failed" ? `The Brain of this project could not be built: ${source.error ?? "unknown error"}` : "The Brain of this project is being built; try again in a moment.");
    }
    return { source: { ...source, indexedCommit: source.indexedCommit } };
  }

  private async nodeOf(projectId: string, id: string | undefined): Promise<BrainNode> {
    const wanted = id === undefined || id === "" ? BRAIN_ROOT_ID : id;
    const node = await this.index.node(projectId, wanted);
    if (node === undefined) throw new NotFoundException(`No node ${wanted.slice(0, 200)} in the Brain; start from the root or look the id up.`);
    return node;
  }

  private async breadcrumb(projectId: string, node: BrainNode): Promise<BrainCrumb[]> {
    return node.parentId === null ? [] : (await this.index.ancestors(projectId, node.id)).map(crumb);
  }

  /** One level of the tree under a node (the root by default), with summaries and, at depth 2, the first grandchildren. */
  async tree(projectId: string, query: BrainTreeQuery): Promise<BrainTreeView> {
    const { source } = await this.ready(projectId);
    const node = await this.nodeOf(projectId, query.node);
    const limit = Math.min(query.limit, MAX_CHILDREN);
    const [breadcrumb, page] = await Promise.all([this.breadcrumb(projectId, node), this.index.children(projectId, node.id, query.offset, limit)]);
    const grandchildren =
      query.depth === 2
        ? await this.index.childrenOf(projectId, page.items.filter((child) => child.children > 0).map((child) => child.id), GRANDCHILDREN)
        : new Map<string, BrainNode[]>();
    return {
      projectId,
      branch: source.branch,
      commit: source.indexedCommit,
      node,
      breadcrumb,
      children: page.items.map((child) => (query.depth === 2 && child.children > 0 ? { ...child, nodes: grandchildren.get(child.id) ?? [] } : child)),
      total: page.total,
      offset: query.offset,
    };
  }

  /** A node's text at the indexed commit (with what is under it when small enough), its children and its links. */
  async read(projectId: string, query: BrainReadQuery): Promise<BrainReadView> {
    const { source } = await this.ready(projectId);
    const node = await this.nodeOf(projectId, query.node);
    const [breadcrumb, children, links] = await Promise.all([
      this.breadcrumb(projectId, node),
      this.index.children(projectId, node.id, 0, READ_CHILDREN),
      this.index.links(projectId, node.id, READ_LINKS),
    ]);
    const base = {
      projectId,
      branch: source.branch,
      commit: source.indexedCommit,
      node,
      breadcrumb,
      children: children.items,
      ...links,
    };
    if (node.lineStart === null || node.lineEnd === null) {
      return { ...base, scope: "node", text: "", lineNumbers: false, citation: null, truncated: false, nextLine: null };
    }
    const scope = query.scope === "auto" ? (node.children === 0 || node.subtreeTokens <= BRAIN_AUTO_SUBTREE_TOKENS ? "subtree" : "node") : query.scope;
    const context = await this.documents.context(projectId);
    const text = await this.documents.readText(context, source.indexedCommit, node.path);
    if (text === undefined) throw new ConflictException(`${node.path} can no longer be read at the indexed commit; rebuild the Brain.`);
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const end = scope === "subtree" ? (node.subtreeEnd ?? node.lineEnd) : node.lineEnd;
    const start = Math.max(node.lineStart, Math.min(query.fromLine ?? node.lineStart, end));
    const kept: string[] = [];
    let size = 0;
    let last = start - 1;
    const numbered = query.lineNumbers === true;
    for (let line = start; line <= end; line += 1) {
      const content = `${numbered ? `${line}\t` : ""}${lines[line - 1] ?? ""}`;
      if (kept.length > 0 && size + content.length + 1 > query.maxChars) break;
      kept.push(content.length > query.maxChars ? content.slice(0, query.maxChars) : content);
      size += content.length + 1;
      last = line;
    }
    const truncated = last < end;
    return {
      ...base,
      scope,
      text: kept.join("\n"),
      lineNumbers: numbered,
      citation: { nodeId: node.id, path: node.path, lineStart: start, lineEnd: last, commit: source.indexedCommit },
      truncated,
      nextLine: truncated ? last + 1 : null,
    };
  }

  /** The nodes a reference id (`RULE-…`, `COM-…`), a node id or a repository path names. */
  async lookup(projectId: string, query: string): Promise<BrainLookupView> {
    const { source } = await this.ready(projectId);
    const wanted = query.trim().replace(/^`|`$/g, "");
    let matches: BrainNode[] = [];
    if (isBrainReferenceId(wanted)) matches = await this.index.lookup(projectId, wanted, LOOKUP_LIMIT);
    if (matches.length === 0) {
      const exact = await this.index.node(projectId, wanted);
      if (exact !== undefined) matches = [exact];
      else matches = await this.index.byPath(projectId, wanted.replace(/^\/+|\/+$/g, ""), LOOKUP_LIMIT);
    }
    const withCrumbs = await Promise.all(matches.map(async (node) => ({ ...node, breadcrumb: await this.breadcrumb(projectId, node) })));
    return { projectId, branch: source.branch, commit: source.indexedCommit, query: wanted, matches: withCrumbs };
  }

  /**
   * The nodes whose text holds every word of the text on one line (a quoted text: that exact phrase), under a
   * folder, document or section when given.
   */
  async grep(projectId: string, query: BrainGrepQuery): Promise<BrainGrepView> {
    const { source } = await this.ready(projectId);
    const text = query.text.trim();
    if (text.length < 2) throw new BadRequestException("Search for at least two characters.");
    const scope = query.under === undefined || query.under === "" || query.under === BRAIN_ROOT_ID ? undefined : await this.nodeOf(projectId, query.under);
    const under = scope === undefined ? undefined : parseBrainNodeId(scope.id).path;
    const context = await this.documents.context(projectId);
    const found = await this.documents.grep(context, source.indexedCommit, termsOf(text), {
      ignoreCase: query.ignoreCase,
      ...(under === undefined || under === "" ? {} : { under }),
      limit: GREP_LIMIT * 4,
    });
    const inScope = found.matches.filter(
      (match) =>
        isBrainIndexedPath(match.path) &&
        (scope === undefined || scope.lineStart === null || scope.subtreeEnd === null || (match.line >= scope.lineStart && match.line <= scope.subtreeEnd)),
    );
    const kept = inScope.slice(0, GREP_LIMIT);
    const nodes = await this.index.nodesAtLines(projectId, kept.map((match) => ({ path: match.path, line: match.line })));
    const crumbs = new Map<string, BrainCrumb[]>();
    const matches: BrainGrepMatch[] = [];
    for (const [index, match] of kept.entries()) {
      const node = nodes[index];
      if (node === undefined) continue;
      if (!crumbs.has(node.id)) crumbs.set(node.id, await this.breadcrumb(projectId, node));
      matches.push({ node, breadcrumb: crumbs.get(node.id) ?? [], line: match.line, excerpt: excerptOf(match.text, termsOf(text)[0] ?? text) });
    }
    return {
      projectId,
      branch: source.branch,
      commit: source.indexedCommit,
      text,
      under: scope?.id ?? null,
      matches,
      truncated: found.truncated || inScope.length > kept.length,
    };
  }
}
