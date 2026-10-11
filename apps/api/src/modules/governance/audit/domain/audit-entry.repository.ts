// Port of AuditEntrys — the DI token of this module (shared kernel: common/domain/repository.ts).

import { Repository } from "#common/domain/repository.js";
import type { CreateAuditEntry, AuditEntry } from "./audit-entry.js";

export abstract class AuditEntryRepository extends Repository<AuditEntry, CreateAuditEntry> {}
