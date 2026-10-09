// Port of CutoverChecklists — the DI token of this module (shared kernel: common/domain/repository.ts).

import { Repository } from "../../../../common/domain/repository.js";
import type { CreateCutoverChecklist, CutoverChecklist } from "./cutover-checklist.js";

export abstract class CutoverChecklistRepository extends Repository<CutoverChecklist, CreateCutoverChecklist> {}
