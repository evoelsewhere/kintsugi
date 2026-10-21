import type { GatePublication } from "./gate-publication.js";
import type { CreateGatePublication } from "./gate-publication.js";

export abstract class GatePublicationRepository {
  abstract createDecision(input: CreateGatePublication): Promise<GatePublication>;
  abstract get(decisionId: string): Promise<GatePublication | undefined>;
}
