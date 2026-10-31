// The Brain's tree in Postgres, through the worker's own store so both sides read and write it the same way.

import { Injectable } from "@nestjs/common";
import type { BrainLinks, BrainNode, BrainNodePage, BrainSource } from "@kintsugi/domain";
import { PgBrainStore } from "@kintsugi/orchestrator/brain";
import { getPool } from "#common/db/pool.js";
import { BrainIndex } from "../domain/brain.ports.js";

@Injectable()
export class PgBrainIndex extends BrainIndex {
  private get store(): PgBrainStore {
    return new PgBrainStore(getPool());
  }

  source(projectId: string): Promise<BrainSource | undefined> {
    return this.store.source(projectId);
  }

  configure(projectId: string, input: { branch: string; enabled: boolean }, actor: string): Promise<BrainSource> {
    return this.store.configure(projectId, input, actor);
  }

  request(projectId: string, actor: string): Promise<BrainSource | undefined> {
    return this.store.request(projectId, actor);
  }

  node(projectId: string, id: string): Promise<BrainNode | undefined> {
    return this.store.node(projectId, id);
  }

  children(projectId: string, parentId: string, offset: number, limit: number): Promise<BrainNodePage> {
    return this.store.children(projectId, parentId, offset, limit);
  }

  childrenOf(projectId: string, parentIds: readonly string[], limit: number): Promise<Map<string, BrainNode[]>> {
    return this.store.childrenOf(projectId, parentIds, limit);
  }

  ancestors(projectId: string, id: string): Promise<BrainNode[]> {
    return this.store.ancestors(projectId, id);
  }

  lookup(projectId: string, id: string, limit: number): Promise<BrainNode[]> {
    return this.store.lookup(projectId, id, limit);
  }

  byPath(projectId: string, path: string, limit: number): Promise<BrainNode[]> {
    return this.store.byPath(projectId, path, limit);
  }

  links(projectId: string, id: string, limit: number): Promise<BrainLinks> {
    return this.store.links(projectId, id, limit);
  }

  nodesAtLines(projectId: string, hits: ReadonlyArray<{ path: string; line: number }>): Promise<Array<BrainNode | undefined>> {
    return this.store.nodesAtLines(projectId, hits);
  }
}
