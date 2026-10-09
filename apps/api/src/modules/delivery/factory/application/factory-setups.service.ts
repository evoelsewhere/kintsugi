// Application layer: use cases of FactorySetups. Extends the shared CRUD kernel
// (common/application/crud.service.ts) — add module-specific use cases here.

import { Injectable } from "@nestjs/common";
import { CrudService } from "../../../../common/application/crud.service.js";
import type { CreateFactorySetup, FactorySetup } from "../domain/factory-setup.js";
import { FactorySetupRepository } from "../domain/factory-setup.repository.js";

export type UpdateFactorySetup = Partial<CreateFactorySetup>;

@Injectable()
export class FactorySetupsService extends CrudService<FactorySetup, CreateFactorySetup> {
  constructor(items: FactorySetupRepository) {
    super(items, "FactorySetup");
  }
}
