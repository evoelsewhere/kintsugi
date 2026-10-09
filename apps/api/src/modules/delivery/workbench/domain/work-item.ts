// Domain of WorkItems: entity and commands. Pure types — no framework, no I/O.

export interface WorkItem {
  id: string;
  unit: string;
  stage: string;
  status?: string;
}

export interface CreateWorkItem {
  unit: string;
  stage: string;
  status?: string;
}
