// Domain of quality and stage gates (governance): a request for a human decision at a pipeline
// gate (G0–G6, docs/methodology/delivery-pipeline.md) or at a stage gate (`stage:<id>`). A gate
// is `pending` until a holder of gates.decide approves, rejects or waives it with a note; the
// decision is final. Rows of one project, application and key are its history. Pure types.

import type { GateDecision, GateStatus } from "@kintsugi/domain";

export { GATE_DECISION_STATUS, GATE_KEY_PATTERN, GATE_STATUSES, type GateDecision, type GateStatus } from "@kintsugi/domain";

export interface Gate {
  id: string;
  projectId: string;
  applicationId?: string;
  /** `G0`–`G6` or a stage gate key such as `stage:assess`. */
  gateKey: string;
  title: string;
  status: GateStatus;
  /** What the gate is about, e.g. the job run that reached it. */
  subject?: string;
  /** Small context for the decider; never content or credentials. */
  detail: Record<string, unknown>;
  requestedBy: string;
  requestedAt: string;
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
}

export interface NewGate {
  id: string;
  projectId: string;
  applicationId?: string;
  gateKey: string;
  title: string;
  subject?: string;
  detail?: Record<string, unknown>;
  requestedBy: string;
}

export interface GateFilter {
  projectId?: string;
  applicationId?: string;
  gateKey?: string;
  statuses?: GateStatus[];
}

export interface GateDecisionCommand {
  decision: GateDecision;
  note?: string;
}

/** Decisions that need a note: a rejection or a waiver must say why. */
export const DECISIONS_NEEDING_NOTE: readonly GateDecision[] = ["reject", "waive"];
