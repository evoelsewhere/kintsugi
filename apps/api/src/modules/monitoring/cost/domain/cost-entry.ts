// Domain of CostEntries: entity and commands. Pure types — no framework, no I/O.

export interface CostEntry {
  id: string;
  model: string;
  costUsd: string;
  status?: string;
}

export interface CreateCostEntry {
  model: string;
  costUsd: string;
  status?: string;
}
