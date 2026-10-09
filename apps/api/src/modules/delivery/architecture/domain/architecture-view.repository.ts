// Port of ArchitectureViews — the DI token of this module (shared kernel: common/domain/repository.ts).

import { Repository } from "../../../../common/domain/repository.js";
import type { CreateArchitectureView, ArchitectureView } from "./architecture-view.js";

export abstract class ArchitectureViewRepository extends Repository<ArchitectureView, CreateArchitectureView> {}
