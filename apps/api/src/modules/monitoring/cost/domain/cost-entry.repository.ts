// Port of CostEntrys — the DI token of this module (shared kernel: common/domain/repository.ts).

import { Repository } from "../../../../common/domain/repository.js";
import type { CreateCostEntry, CostEntry } from "./cost-entry.js";

export abstract class CostEntryRepository extends Repository<CostEntry, CreateCostEntry> {}
