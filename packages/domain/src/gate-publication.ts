export const GATE_PUBLICATION_STATES = [
  "pending-publication",
  "awaiting-merge",
  "effective",
  "stale",
  "failed",
  "rejected",
] as const;
export type GatePublicationState = (typeof GATE_PUBLICATION_STATES)[number];

export const TASK_GATE_PUBLICATION_STATUSES = [...GATE_PUBLICATION_STATES, "unknown"] as const;
export type TaskGatePublicationStatus = (typeof TASK_GATE_PUBLICATION_STATUSES)[number];
