// Domain of AiMetrics: entity and commands. Pure types — no framework, no I/O.

export interface AiMetric {
  id: string;
  metric: string;
  value: string;
  status?: string;
}

export interface CreateAiMetric {
  metric: string;
  value: string;
  status?: string;
}
