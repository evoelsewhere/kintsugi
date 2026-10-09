// Wiring of the portfolio-items module: interface + application + the
// infrastructure adapter bound to the domain port.

import { Module } from "@nestjs/common";
import { PortfolioItemsService } from "./application/portfolio-items.service.js";
import { PortfolioItemRepository } from "./domain/portfolio-item.repository.js";
import { InMemoryPortfolioItemRepository } from "./infrastructure/in-memory-portfolio-item.repository.js";
import { PortfolioItemsController } from "./interface/portfolio-items.controller.js";

/** delivery · portfolio & assessment — docs/architecture/05-building-block-view.md. */
@Module({
  controllers: [PortfolioItemsController],
  providers: [PortfolioItemsService, { provide: PortfolioItemRepository, useClass: InMemoryPortfolioItemRepository }],
  exports: [PortfolioItemsService, PortfolioItemRepository],
})
export class PortfolioItemsModule {}
