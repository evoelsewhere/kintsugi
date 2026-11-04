// Ports of the Brain (ADR-0091): the stored tree index of a project, and the queue that asks the worker for a build.

import type { BrainSearchFounds, BrainSearchRequest } from "./brain.search.js";
import type { BrainBacklinkRows, BrainBrokenLink, BrainLinks, BrainNode, BrainNodeKind, BrainNodePage, BrainSource } from "@kintsugi/domain";

export abstract class BrainIndex {
  abstract source(projectId: string): Promise<BrainSource | undefined>;
  abstract configure(projectId: string, input: { branch: string; enabled: boolean; wiki?: boolean | undefined }, actor: string): Promise<BrainSource>;
  /** Sets the wiki flag alone, without queuing a build; undefined when the project has no index. */
  abstract setWiki(projectId: string, wiki: boolean, actor: string): Promise<BrainSource | undefined>;
  /** The projects whose wiki is on and whose document repository is `repositoryId`, with the branch their Brain follows. */
  abstract wikiProjectsOf(repositoryId: string): Promise<Array<{ projectId: string; branch: string }>>;
  /** Queues a build of an enabled index; undefined when there is none or it is off. */
  abstract request(projectId: string, actor: string): Promise<BrainSource | undefined>;
  abstract node(projectId: string, id: string): Promise<BrainNode | undefined>;
  abstract children(projectId: string, parentId: string, offset: number, limit: number): Promise<BrainNodePage>;
  abstract childrenOf(projectId: string, parentIds: readonly string[], limit: number): Promise<Map<string, BrainNode[]>>;
  /** Root first. */
  abstract ancestors(projectId: string, id: string): Promise<BrainNode[]>;
  abstract lookup(projectId: string, id: string, limit: number): Promise<BrainNode[]>;
  abstract byPath(projectId: string, path: string, limit: number): Promise<BrainNode[]>;
  /** The documents that carry a label (lowercase), by path. */
  abstract byLabel(projectId: string, label: string, limit: number): Promise<BrainNode[]>;
  /** The documents in the space of a key, by path. */
  abstract bySpace(projectId: string, space: string, limit: number): Promise<BrainNode[]>;
  abstract links(projectId: string, id: string, limit: number): Promise<BrainLinks>;
  /** The broken links the last build stored, in the order it found them. */
  abstract broken(projectId: string): Promise<BrainBrokenLink[]>;
  /** The links to a document or section or card from other documents, a window of them in path order, with the total. */
  abstract backlinks(projectId: string, target: { id: string; path: string; kind: BrainNodeKind }, offset: number, limit: number): Promise<BrainBacklinkRows>;
  abstract nodesByIds(projectId: string, ids: readonly string[]): Promise<BrainNode[]>;
  abstract nodesAtLines(projectId: string, hits: ReadonlyArray<{ path: string; line: number }>): Promise<Array<BrainNode | undefined>>;
  /** The nodes of a document whose own text overlaps the line ranges, in document order. */
  abstract nodesInRanges(projectId: string, path: string, ranges: ReadonlyArray<{ start: number; end: number }>, limit: number): Promise<BrainNode[]>;
}

export abstract class BrainSearchIndex {
  /**
   * The nodes whose full-text vector matches the words of a search, best first (ties by path and line), at most `limit`, with
   * how many pages archived or templates were left out. The index holds lexemes, never text.
   */
  abstract search(projectId: string, request: BrainSearchRequest): Promise<BrainSearchFounds>;
}

export abstract class BrainBuildQueue {
  abstract enqueue(projectId: string): Promise<void>;
}
