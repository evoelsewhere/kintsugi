import { Module } from "@nestjs/common";
import { ArchitectureViewsController } from "./architecture-views.controller.js";
import { ArchitectureViewsService } from "./architecture-views.service.js";

/** delivery · architecture studio — docs/architecture/05-building-block-view.md. */
@Module({ controllers: [ArchitectureViewsController], providers: [ArchitectureViewsService], exports: [ArchitectureViewsService] })
export class ArchitectureViewsModule {}
