import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { GATE_KEY_PATTERN, gateEvidenceCanonicalJson, isFullUnitId, unitGateReviewPath, validateGateEvidence, type GateEvidence } from "@kintsugi/domain";
import type { Actor } from "#common/auth/decorators.js";
import { ProjectAccessService } from "#modules/admin/project-access/index.js";
import { ProjectsService } from "#modules/admin/projects/index.js";
import { SnapshotService } from "#modules/delivery/agent-context/index.js";
import { GateDecisionEvidenceReader } from "../domain/gate-decision-evidence.reader.js";
import { GatePublicationRepository } from "../domain/gate-publication.repository.js";
import type { GateDecisionResult, GatePublication, RequestGateDecision } from "../domain/gate-publication.js";

const SESSION_AUTHORIZATION_PATTERN = /^session:[a-f0-9]{64}$/;

@Injectable()
export class GatePublicationService {
  constructor(
    private readonly publications: GatePublicationRepository,
    private readonly evidenceReader: GateDecisionEvidenceReader,
    private readonly snapshots: SnapshotService,
    private readonly projects: ProjectsService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async requestDecision(actor: Actor, authorizationId: string, input: RequestGateDecision): Promise<GateDecisionResult> {
    if (!actor.permissions.includes("gates.decide")) throw new ForbiddenException("Missing permission: gates.decide");
    if (!SESSION_AUTHORIZATION_PATTERN.test(authorizationId)) throw new ForbiddenException("An authenticated session is required");
    if (!isFullUnitId(input.unitId)) throw new BadRequestException("unitId must be application/module/unit");
    if (!GATE_KEY_PATTERN.test(input.gateId)) throw new BadRequestException("gateId is invalid");
    await this.projectAccess.requireRead(actor.id, input.projectId);

    const project = await this.projects.getProject(input.projectId);
    if (project.documentRepository === null) throw new ConflictException("The project has no document repository for gate publication");
    const context = await this.snapshots.currentGateContext(actor.id, input.projectId, input.unitId);
    const requiredDeliverables = context.requiredDeliverables;
    const requiredIds = requiredDeliverables.map(({ id }) => id).sort();
    if (requiredIds.length === 0) {
      return {
        state: "awaiting-evidence",
        projectId: input.projectId,
        unitId: input.unitId,
        gateId: input.gateId,
        missingDeliverableIds: [],
        blockers: ["The task has no required deliverables declared in its current Git source."],
      };
    }

    const waiverDeliverableIds = [...new Set(input.waiverDeliverableIds ?? [])].sort();
    if ((input.waiverDeliverableIds?.length ?? 0) !== waiverDeliverableIds.length) {
      throw new BadRequestException("waiverDeliverableIds must be unique");
    }
    if (input.decision === "waived") {
      if (input.waiverReason?.trim() === "") throw new BadRequestException("A reason is required to waive deliverables");
      if (waiverDeliverableIds.length === 0 || waiverDeliverableIds.length >= requiredIds.length ||
          waiverDeliverableIds.some((id) => !requiredIds.includes(id))) {
        throw new BadRequestException("A waiver must name a non-empty proper subset of the current required deliverables");
      }
    } else if (waiverDeliverableIds.length > 0 || input.waiverReason !== undefined) {
      throw new BadRequestException("Waiver scope and reason are allowed only for a waived decision");
    }
    if (input.decision === "rejected" && input.decisionReason?.trim() === "") {
      throw new BadRequestException("A reason is required to reject a gate");
    }
    if (input.decision !== "rejected" && input.decisionReason !== undefined) {
      throw new BadRequestException("decisionReason is allowed only for a rejected decision");
    }

    const evidenceDeliverables = await this.evidenceReader.readCompletedDeliverables({
      projectId: input.projectId,
      unitId: input.unitId,
      contextRevision: context.contextRevision,
      policyRevision: context.policyRevision,
      deliverables: requiredDeliverables.filter(({ id }) => !waiverDeliverableIds.includes(id)),
    });
    const evidencedIds = new Set(evidenceDeliverables.map(({ deliverableId }) => deliverableId));
    if (evidenceDeliverables.length !== evidencedIds.size || [...evidencedIds].some((id) => !requiredIds.includes(id) || waiverDeliverableIds.includes(id))) {
      throw new ConflictException("The provider returned duplicate or unexpected deliverable evidence");
    }
    const missingDeliverableIds = requiredIds.filter((id) => !waiverDeliverableIds.includes(id) && !evidencedIds.has(id));
    if (missingDeliverableIds.length > 0) {
      return {
        state: "awaiting-evidence",
        projectId: input.projectId,
        unitId: input.unitId,
        gateId: input.gateId,
        missingDeliverableIds,
        blockers: ["Each non-waived deliverable needs a merged PR, a current complete passing Kintsugi review, and an eligible provider human approval."],
      };
    }

    const core = {
      schemaVersion: "1" as const,
      decisionId: "pending",
      projectId: input.projectId,
      unitId: input.unitId,
      gateId: input.gateId,
      decision: input.decision,
      ...(input.decisionReason === undefined ? {} : { decisionReason: input.decisionReason.trim() }),
      auditEventId: "0",
      policyRevision: context.policyRevision,
      contextRevision: context.contextRevision,
      requiredDeliverableIds: requiredIds,
      actor: { userId: actor.id, authorizationId },
      deliverables: evidenceDeliverables.map(item => {
        const required = requiredDeliverables.find(required => required.id === item.deliverableId);
        if (required === undefined || required.repositoryId !== item.repositoryId) throw new ConflictException("Deliverable repository does not match the task");
        return {...item,path:required.path};
      }).sort((left, right) => left.deliverableId.localeCompare(right.deliverableId)),
      ...(input.decision === "waived" ? {
        waiver: { deliverableIds: waiverDeliverableIds, reason: input.waiverReason!.trim() },
      } : {}),
    } satisfies GateEvidence;
    const decisionId = "gate_" + createHash("sha256").update(gateEvidenceCanonicalJson(core)).digest("hex").slice(0, 48);
    const { auditEventId: _pendingAuditId, ...draft } = core;
    const evidenceWithoutAuditId = { ...draft, decisionId } satisfies Omit<GateEvidence, "auditEventId">;
    const validated = validateGateEvidence({ ...evidenceWithoutAuditId, auditEventId: "0" });
    if (!validated.ok) throw new BadRequestException({ message: "The gate evidence is invalid", details: { issues: validated.issues } });
    const evidenceHash = createHash("sha256").update(gateEvidenceCanonicalJson(validated.value)).digest("hex");
    const auditDetail = {
      authorizationId,
      gateId: input.gateId,
      decision: input.decision,
      contextRevision: context.contextRevision,
      policyRevision: context.policyRevision,
      evidenceHash,
      ...(input.decisionReason === undefined ? {} : { decisionReason: input.decisionReason.trim() }),
      ...(input.decision === "waived" ? {
        waiverDeliverableIds,
        waiverReason: input.waiverReason!.trim(),
      } : {}),
    };
    const identity = input.unitId.split("/");
    const application = identity[0]!;
    const module = identity[1]!;
    const unit = identity[2]!;
    const recordPath = unitGateReviewPath(application, module, unit, input.gateId);

    return this.publications.createDecision({
      evidence: evidenceWithoutAuditId,
      evidenceHash,
      audit: {
        actor: actor.id,
        action: "gate.decision.request",
        projectId: input.projectId,
        subject: decisionId,
        detail: auditDetail,
      },
      documentRepositoryId: project.documentRepository.repositoryId,
      recordPath,
      message: `Publish ${input.gateId} decision for ${input.unitId}`,
      actorLabel: actor.username ?? actor.id,
    });
  }

  async get(decisionId: string, actor: Actor): Promise<GatePublication> {
    const publication = await this.publications.get(decisionId);
    if (publication === undefined) throw new NotFoundException("Gate publication not found");
    await this.projectAccess.requireRead(actor.id, publication.projectId);
    return publication;
  }
}
