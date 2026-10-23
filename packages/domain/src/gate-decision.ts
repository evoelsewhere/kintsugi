export const GATE_DECISIONS = ["approved", "rejected", "waived"] as const;
export type GateDecision = (typeof GATE_DECISIONS)[number];

export const TASK_GATE_STATUSES = ["pending", ...GATE_DECISIONS, "unknown"] as const;
export type TaskGateStatusValue = (typeof TASK_GATE_STATUSES)[number];
