import type { GatePublication } from "./gate-publication.js";
import type { CreateGatePublication } from "./gate-publication.js";

export interface GatePublicationPage {
  items: GatePublication[];
  total: number;
  limit: number;
  offset: number;
}

export abstract class GatePublicationRepository {
  abstract createDecision(input: CreateGatePublication): Promise<GatePublication>;
  abstract get(decisionId: string): Promise<GatePublication | undefined>;
  abstract listByProject(projectId: string, limit: number, offset: number): Promise<GatePublicationPage>;
}
