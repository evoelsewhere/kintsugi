import type { GateDeliverableEvidence } from "@kintsugi/domain";

export interface RequiredGateDeliverable {
  id: string;
  repositoryId: string;
  path: string;
}

export abstract class GateDecisionEvidenceReader {
  /** Returns only current, merged, fully reviewed deliverables with a mapped eligible approver. */
  abstract readCompletedDeliverables(input: {
    projectId: string;
    unitId: string;
    contextRevision: string;
    policyRevision: string;
    deliverables: readonly RequiredGateDeliverable[];
  }): Promise<GateDeliverableEvidence[]>;
}
