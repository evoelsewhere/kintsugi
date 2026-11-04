// The Brain's tree in Postgres, through the worker's own store so both sides read and write it the same way.

import { Injectable } from "@nestjs/common";
import type { BrainBacklinkRows, BrainBrokenLink, BrainLinks, BrainNode, BrainNodeKind, BrainNodePage, BrainSource } from "@kintsugi/domain";
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

  configure(projectId: string, input: { branch: string; enabled: boolean; wiki?: boolean | undefined }, actor: string): Promise<BrainSource> {
    return this.store.configure(projectId, input, actor);
  }

  setWiki(projectId: string, wiki: boolean, actor: string): Promise<BrainSource | undefined> {
    return this.store.setWiki(projectId, wiki, actor);
  }

  async wikiProjectsOf(repositoryId: string): Promise<Array<{ projectId: string; branch: string }>> {
    const result = await getPool().query<{ project_id: string; branch: string }>(
      `select s.project_id, s.branch
         from knowledge.brain_source s
         join admin.project_repository pr on pr.project_id = s.project_id and pr.role = 'document'
        where pr.repository_id = $1 and s.wiki
        order by s.project_id`,
      [repositoryId],
    );
    return result.rows.map((row) => ({ projectId: row.project_id, branch: row.branch }));
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

  byLabel(projectId: string, label: string, limit: number): Promise<BrainNode[]> {
    return this.store.byLabel(projectId, label, limit);
  }

  bySpace(projectId: string, space: string, limit: number): Promise<BrainNode[]> {
    return this.store.bySpace(projectId, space, limit);
  }

  links(projectId: string, id: string, limit: number): Promise<BrainLinks> {
    return this.store.links(projectId, id, limit);
  }

  broken(projectId: string): Promise<BrainBrokenLink[]> {
    return this.store.broken(projectId);
  }

  backlinks(projectId: string, target: { id: string; path: string; kind: BrainNodeKind }, offset: number, limit: number): Promise<BrainBacklinkRows> {
    return this.store.backlinks(projectId, target, offset, limit);
  }

  nodesByIds(projectId: string, ids: readonly string[]): Promise<BrainNode[]> {
    return this.store.nodesByIds(projectId, ids);
  }

  nodesInRanges(projectId: string, path: string, ranges: ReadonlyArray<{ start: number; end: number }>, limit: number): Promise<BrainNode[]> {
    return this.store.nodesInRanges(projectId, path, ranges, limit);
  }

  nodesAtLines(projectId: string, hits: ReadonlyArray<{ path: string; line: number }>): Promise<Array<BrainNode | undefined>> {
    return this.store.nodesAtLines(projectId, hits);
  }
}
