// Domain of HealthChecks: entity and commands. Pure types — no framework, no I/O.

export interface HealthCheck {
  id: string;
  application: string;
  status?: string;
}

export interface CreateHealthCheck {
  application: string;
  status?: string;
}
