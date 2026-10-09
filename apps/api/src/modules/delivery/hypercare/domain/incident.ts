// Domain of Incidents: entity and commands. Pure types — no framework, no I/O.

export interface Incident {
  id: string;
  application: string;
  severity: string;
  status?: string;
}

export interface CreateIncident {
  application: string;
  severity: string;
  status?: string;
}
