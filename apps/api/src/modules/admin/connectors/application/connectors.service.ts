// Application layer: use cases of Connectors. Extends the shared CRUD kernel
// (common/application/crud.service.ts) — add module-specific use cases here.

import { Injectable } from "@nestjs/common";
import { CrudService } from "#common/application/crud.service.js";
import type { CreateConnector, Connector } from "../domain/connector.js";
import { ConnectorRepository } from "../domain/connector.repository.js";

export type UpdateConnector = Partial<CreateConnector>;

@Injectable()
export class ConnectorsService extends CrudService<Connector, CreateConnector> {
  constructor(items: ConnectorRepository) {
    super(items, "Connector");
  }
}
