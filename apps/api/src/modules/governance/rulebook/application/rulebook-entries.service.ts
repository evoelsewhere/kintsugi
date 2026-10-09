// Application layer: use cases of RulebookEntries. Extends the shared CRUD kernel
// (common/application/crud.service.ts) — add module-specific use cases here.

import { Injectable } from "@nestjs/common";
import { CrudService } from "../../../../common/application/crud.service.js";
import type { CreateRulebookEntry, RulebookEntry } from "../domain/rulebook-entry.js";
import { RulebookEntryRepository } from "../domain/rulebook-entry.repository.js";

export type UpdateRulebookEntry = Partial<CreateRulebookEntry>;

@Injectable()
export class RulebookEntriesService extends CrudService<RulebookEntry, CreateRulebookEntry> {
  constructor(items: RulebookEntryRepository) {
    super(items, "RulebookEntry");
  }
}
