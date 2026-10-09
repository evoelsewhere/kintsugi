// Domain of Harnesses: entity and commands. Pure types — no framework, no I/O.

export interface Harness {
  id: string;
  name: string;
  support: string;
  status?: string;
}

export interface CreateHarness {
  name: string;
  support: string;
  status?: string;
}
