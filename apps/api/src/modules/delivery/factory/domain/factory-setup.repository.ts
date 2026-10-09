// Port of FactorySetups — the DI token of this module (shared kernel: common/domain/repository.ts).

import { Repository } from "../../../../common/domain/repository.js";
import type { CreateFactorySetup, FactorySetup } from "./factory-setup.js";

export abstract class FactorySetupRepository extends Repository<FactorySetup, CreateFactorySetup> {}
