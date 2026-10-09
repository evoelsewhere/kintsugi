// Port of RulebookEntrys — the DI token of this module (shared kernel: common/domain/repository.ts).

import { Repository } from "../../../../common/domain/repository.js";
import type { CreateRulebookEntry, RulebookEntry } from "./rulebook-entry.js";

export abstract class RulebookEntryRepository extends Repository<RulebookEntry, CreateRulebookEntry> {}
