import { Injectable } from "@nestjs/common";
import type { WebSearchSettings } from "@kintsugi/domain";
import { PgWebSearch } from "@kintsugi/orchestrator/web-search";
import { getPool } from "#common/db/pool.js";
import { WebSearchRepository } from "../domain/web-search.repository.js";
@Injectable()
export class PgWebSearchRepository extends WebSearchRepository {
  private get store(): PgWebSearch { return new PgWebSearch(getPool()); }
  view(projectId: string) { return this.store.view(projectId); }
  configure(projectId: string, settings: WebSearchSettings) { return this.store.configure(projectId, settings); }
}
