// Port of WorkItems — the DI token of this module (shared kernel: common/domain/repository.ts).

import { Repository } from "#common/domain/repository.js";
import type { CreateWorkItem, WorkItem } from "./work-item.js";

export abstract class WorkItemRepository extends Repository<WorkItem, CreateWorkItem> {}
