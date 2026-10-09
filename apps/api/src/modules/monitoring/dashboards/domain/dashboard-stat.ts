// Domain of DashboardStats: entity and commands. Pure types — no framework, no I/O.

export interface DashboardStat {
  id: string;
  metric: string;
  value: string;
  status?: string;
}

export interface CreateDashboardStat {
  metric: string;
  value: string;
  status?: string;
}
