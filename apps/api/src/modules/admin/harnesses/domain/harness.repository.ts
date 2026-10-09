// Port of Harnesss — the DI token of this module (shared kernel: common/domain/repository.ts).

import { Repository } from "../../../../common/domain/repository.js";
import type { CreateHarness, Harness } from "./harness.js";

export abstract class HarnessRepository extends Repository<Harness, CreateHarness> {}
