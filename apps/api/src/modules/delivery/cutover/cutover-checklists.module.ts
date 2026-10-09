import { Module } from "@nestjs/common";
import { CutoverChecklistsController } from "./cutover-checklists.controller.js";
import { CutoverChecklistsService } from "./cutover-checklists.service.js";

/** delivery · cutover — docs/architecture/05-building-block-view.md. */
@Module({ controllers: [CutoverChecklistsController], providers: [CutoverChecklistsService], exports: [CutoverChecklistsService] })
export class CutoverChecklistsModule {}
