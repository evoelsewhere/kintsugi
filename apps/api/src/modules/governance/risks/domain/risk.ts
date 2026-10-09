// Domain of Risks: entity and commands. Pure types — no framework, no I/O.

export interface Risk {
  id: string;
  title: string;
  severity: string;
  status?: string;
}

export interface CreateRisk {
  title: string;
  severity: string;
  status?: string;
}
