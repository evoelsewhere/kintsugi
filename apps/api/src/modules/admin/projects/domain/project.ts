// Domain of Projects: entity and commands. Pure types — no framework, no I/O.

export interface Project {
  id: string;
  name: string;
  code: string;
  status?: string;
}

export interface CreateProject {
  name: string;
  code: string;
  status?: string;
}
