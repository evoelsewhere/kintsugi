// Port of Connectors — the DI token of this module (shared kernel: common/domain/repository.ts).

import { Repository } from "../../../../common/domain/repository.js";
import type { CreateConnector, Connector } from "./connector.js";

export abstract class ConnectorRepository extends Repository<Connector, CreateConnector> {}
