// Port of HealthChecks — the DI token of this module (shared kernel: common/domain/repository.ts).

import { Repository } from "../../../../common/domain/repository.js";
import type { CreateHealthCheck, HealthCheck } from "./health-check.js";

export abstract class HealthCheckRepository extends Repository<HealthCheck, CreateHealthCheck> {}
