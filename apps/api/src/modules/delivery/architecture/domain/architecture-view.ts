// Domain of ArchitectureViews: entity and commands. Pure types — no framework, no I/O.

export interface ArchitectureView {
  id: string;
  application: string;
  kind: string;
  status?: string;
}

export interface CreateArchitectureView {
  application: string;
  kind: string;
  status?: string;
}
