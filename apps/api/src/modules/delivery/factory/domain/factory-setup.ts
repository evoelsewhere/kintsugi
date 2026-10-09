// Domain of FactorySetups: entity and commands. Pure types — no framework, no I/O.

export interface FactorySetup {
  id: string;
  application: string;
  stage: string;
  status?: string;
}

export interface CreateFactorySetup {
  application: string;
  stage: string;
  status?: string;
}
