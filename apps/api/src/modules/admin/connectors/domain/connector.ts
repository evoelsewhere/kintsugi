// Domain of Connectors: entity and commands. Pure types — no framework, no I/O.

export interface Connector {
  id: string;
  kind: string;
  name: string;
  status?: string;
}

export interface CreateConnector {
  kind: string;
  name: string;
  status?: string;
}
