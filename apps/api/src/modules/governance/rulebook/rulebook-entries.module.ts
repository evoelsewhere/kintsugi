import { Module } from "@nestjs/common";
import { RulebookEntriesController } from "./rulebook-entries.controller.js";
import { RulebookEntriesService } from "./rulebook-entries.service.js";

/** governance · rulebook & asset governance — docs/architecture/05-building-block-view.md. */
@Module({ controllers: [RulebookEntriesController], providers: [RulebookEntriesService], exports: [RulebookEntriesService] })
export class RulebookEntriesModule {}
