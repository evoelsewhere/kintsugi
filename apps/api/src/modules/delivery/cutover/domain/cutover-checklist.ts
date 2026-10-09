// Domain of CutoverChecklists: entity and commands. Pure types — no framework, no I/O.

export interface CutoverChecklist {
  id: string;
  application: string;
  decision: string;
  status?: string;
}

export interface CreateCutoverChecklist {
  application: string;
  decision: string;
  status?: string;
}
