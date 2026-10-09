// Domain of Policies: entity and commands. Pure types — no framework, no I/O.

export interface Policy {
  id: string;
  name: string;
  scope: string;
  status?: string;
}

export interface CreatePolicy {
  name: string;
  scope: string;
  status?: string;
}
