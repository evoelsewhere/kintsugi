import { Module } from "@nestjs/common";
import { PortfolioItemsController } from "./portfolio-items.controller.js";
import { PortfolioItemsService } from "./portfolio-items.service.js";

/** delivery · portfolio & assessment — docs/architecture/05-building-block-view.md. */
@Module({ controllers: [PortfolioItemsController], providers: [PortfolioItemsService], exports: [PortfolioItemsService] })
export class PortfolioItemsModule {}
