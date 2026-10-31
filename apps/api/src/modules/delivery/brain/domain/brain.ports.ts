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
  abstract links(projectId: string, id: string, limit: number): Promise<BrainLinks>;
  abstract nodesAtLines(projectId: string, hits: ReadonlyArray<{ path: string; line: number }>): Promise<Array<BrainNode | undefined>>;
}

export abstract class BrainBuildQueue {
  abstract enqueue(projectId: string): Promise<void>;
}
