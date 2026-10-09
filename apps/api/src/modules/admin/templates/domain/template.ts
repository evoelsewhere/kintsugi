// Domain of Templates: entity and commands. Pure types — no framework, no I/O.

export interface Template {
  id: string;
  name: string;
  kind: string;
  status?: string;
}

export interface CreateTemplate {
  name: string;
  kind: string;
  status?: string;
}
