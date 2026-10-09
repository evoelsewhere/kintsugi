// Domain of ProjectBuilds: entity and commands. Pure types — no framework, no I/O.

export interface ProjectBuild {
  id: string;
  application: string;
  readiness: string;
  status?: string;
}

export interface CreateProjectBuild {
  application: string;
  readiness: string;
  status?: string;
}
