// Port of Gates — the DI token of this module (shared kernel: common/domain/repository.ts).

import { Repository } from "../../../../common/domain/repository.js";
import type { CreateGate, Gate } from "./gate.js";

export abstract class GateRepository extends Repository<Gate, CreateGate> {}
