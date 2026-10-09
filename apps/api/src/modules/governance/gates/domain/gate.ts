// Domain of Gates: entity and commands. Pure types — no framework, no I/O.

export interface Gate {
  id: string;
  gate: string;
  status?: string;
}

export interface CreateGate {
  gate: string;
  status?: string;
}
