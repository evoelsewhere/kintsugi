// Port of PortfolioItems — the DI token of this module (shared kernel: common/domain/repository.ts).

import { Repository } from "#common/domain/repository.js";
import type { CreatePortfolioItem, PortfolioItem } from "./portfolio-item.js";

export abstract class PortfolioItemRepository extends Repository<PortfolioItem, CreatePortfolioItem> {}
