// Application layer: use cases of PortfolioItems. Extends the shared CRUD kernel
// (common/application/crud.service.ts) — add module-specific use cases here.

import { Injectable } from "@nestjs/common";
import { CrudService } from "../../../../common/application/crud.service.js";
import type { CreatePortfolioItem, PortfolioItem } from "../domain/portfolio-item.js";
import { PortfolioItemRepository } from "../domain/portfolio-item.repository.js";

export type UpdatePortfolioItem = Partial<CreatePortfolioItem>;

@Injectable()
export class PortfolioItemsService extends CrudService<PortfolioItem, CreatePortfolioItem> {
  constructor(items: PortfolioItemRepository) {
    super(items, "PortfolioItem");
  }
}
