// Wiring of the rulebook-entries module: interface + application + the
// infrastructure adapter bound to the domain port.

import { Module } from "@nestjs/common";
import { RulebookEntriesService } from "./application/rulebook-entries.service.js";
import { RulebookEntryRepository } from "./domain/rulebook-entry.repository.js";
import { InMemoryRulebookEntryRepository } from "./infrastructure/in-memory-rulebook-entry.repository.js";
import { RulebookEntriesController } from "./interface/rulebook-entries.controller.js";

/** governance · rulebook & asset governance — docs/architecture/05-building-block-view.md. */
@Module({
  controllers: [RulebookEntriesController],
  providers: [RulebookEntriesService, { provide: RulebookEntryRepository, useClass: InMemoryRulebookEntryRepository }],
  exports: [RulebookEntriesService, RulebookEntryRepository],
})
export class RulebookEntriesModule {}
