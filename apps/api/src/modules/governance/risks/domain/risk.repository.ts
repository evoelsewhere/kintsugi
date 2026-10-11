// Port of Risks — the DI token of this module (shared kernel: common/domain/repository.ts).

import { Repository } from "#common/domain/repository.js";
import type { CreateRisk, Risk } from "./risk.js";

export abstract class RiskRepository extends Repository<Risk, CreateRisk> {}
