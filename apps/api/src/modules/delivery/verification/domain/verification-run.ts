// Domain of VerificationRuns: entity and commands. Pure types — no framework, no I/O.

export interface VerificationRun {
  id: string;
  application: string;
  profile: string;
  status?: string;
}

export interface CreateVerificationRun {
  application: string;
  profile: string;
  status?: string;
}
