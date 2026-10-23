import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { isFullUnitId, type GateEvidence, type GatePublicationState } from "@kintsugi/domain";
import type { TaskIdentity } from "@kintsugi/harness-sdk";
import type { MemberPrincipal } from "#modules/core/auth/index.js";
import { ProjectAccessService } from "#modules/admin/project-access/index.js";
import { GatePublicationRepository, type GatePublicationIdentity } from "../domain/gate-publication.repository.js";

const MAX_STATUS_GATE_IDS = 20;

export interface GatePublicationStatus {
  unitId: string;
  gateId: string;
  decision: GateEvidence["decision"];
  state: GatePublicationState;
}

@Injectable()
export class GatePublicationStatusQueryService {
  constructor(
    private readonly publications: GatePublicationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async listForTask(principal: MemberPrincipal, identity: TaskIdentity, gates: readonly GatePublicationIdentity[]): Promise<GatePublicationStatus[]> {
    if (!principal.projectIds.includes(identity.projectId)) {
      throw new ForbiddenException("The token is not scoped to this project");
    }
    if (!isFullUnitId(identity.unitId)) throw new BadRequestException("unitId must be application/module/unit");
    await this.projectAccess.requireRead(principal.userId, identity.projectId);
    const gateKeys = gates.map(({ unitId, gateId }) => JSON.stringify([unitId, gateId]));
    if (gates.length > MAX_STATUS_GATE_IDS || new Set(gateKeys).size !== gateKeys.length) {
      throw new BadRequestException("gates must be unique by unit and gate and contain at most 20 entries");
    }
    if (gates.some(({ unitId }) => !isFullUnitId(unitId))) {
      throw new BadRequestException("Each gate unitId must be application/module/unit");
    }
    if (gates.length === 0) return [];

    const publications = await this.publications.listLatestForTask(identity.projectId, gates);
    return publications.map(({ unitId, gateId, decision, state }) => ({ unitId, gateId, decision, state }));
  }
}
