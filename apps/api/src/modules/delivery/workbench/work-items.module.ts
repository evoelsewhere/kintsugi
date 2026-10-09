import { Module } from "@nestjs/common";
import { WorkItemsController } from "./work-items.controller.js";
import { WorkItemsService } from "./work-items.service.js";

/** delivery · migration workbench — docs/architecture/05-building-block-view.md. */
@Module({ controllers: [WorkItemsController], providers: [WorkItemsService], exports: [WorkItemsService] })
export class WorkItemsModule {}
