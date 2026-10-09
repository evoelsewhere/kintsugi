// Domain of JobRuns: entity and commands. Pure types — no framework, no I/O.

export interface JobRun {
  id: string;
  agent: string;
  status?: string;
}

export interface CreateJobRun {
  agent: string;
  status?: string;
}
