// Ports of the Brain (ADR-0091): the stored tree index of a project, and the queue that asks the worker for a build.

import type { BrainLinks, BrainNode, BrainNodePage, BrainSource } from "@kintsugi/domain";

export abstract class BrainIndex {
  abstract source(projectId: string): Promise<BrainSource | undefined>;
  abstract configure(projectId: string, input: { branch: string; enabled: boolean }, actor: string): Promise<BrainSource>;
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
  abstract nodesAtLines(projectId: string, hits: ReadonlyArray<{ path: string; line: number }>): Promise<Array<BrainNode | undefined>>;
  /** The nodes of a document whose own text overlaps the line ranges, in document order. */
  abstract nodesInRanges(projectId: string, path: string, ranges: ReadonlyArray<{ start: number; end: number }>, limit: number): Promise<BrainNode[]>;
}

export abstract class BrainBuildQueue {
  abstract enqueue(projectId: string): Promise<void>;
}
