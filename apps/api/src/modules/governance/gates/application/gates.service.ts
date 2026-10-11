// Application layer: use cases of quality and stage gates. A person (gates.request) or the
// worker (services/orchestrator/src/gates.ts, straight to the database) requests a gate; a
// holder of gates.decide approves, rejects or waives it once, with a note. Requests and
// decisions are audited.

import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import type { Actor } from "#common/auth/decorators.js";
import { type Page, type PageQuery, toPage } from "#common/application/pagination.js";
import { newId } from "#common/domain/ids.js";
import { ProjectsService } from "#modules/admin/projects/index.js";
import { DECISIONS_NEEDING_NOTE, GATE_DECISION_STATUS, type Gate, type GateDecisionCommand, type GateFilter } from "../domain/gate.js";
import { GateRepository } from "../domain/gate.repository.js";

/** Rows returned by the history of one gate key. */
const HISTORY_LIMIT = 100;

export interface RequestGate {
  projectId: string;
  applicationId?: string;
  gateKey: string;
  title: string;
  subject?: string;
  detail?: Record<string, unknown>;
}

@Injectable()
export class GatesService {
  constructor(
    private readonly gates: GateRepository,
    private readonly projects: ProjectsService,
    private readonly audit: AuditTrail,
  ) {}

  async list(filter: GateFilter, query: PageQuery): Promise<Page<Gate>> {
    const { items, total } = await this.gates.list(filter, query.limit, query.offset);
    return toPage(items, total, query);
  }

  async get(id: string): Promise<Gate> {
    const gate = await this.gates.get(id);
    if (gate === undefined) throw new NotFoundException(`Gate ${id} not found`);
    return gate;
  }

  /** Every request of the same project, application and gate key, newest first. */
  async history(id: string): Promise<Gate[]> {
    return this.gates.history(await this.get(id), HISTORY_LIMIT);
  }

  /** Opens a pending gate; 409 when the same gate is already pending. */
  async request(input: RequestGate, actor: Actor): Promise<Gate> {
    const project = await this.projects.getProject(input.projectId); // 404 for an unknown project
    if (input.applicationId !== undefined && !project.applications.some((application) => application.id === input.applicationId)) {
      throw new NotFoundException(`Application ${input.applicationId} not found in project ${input.projectId}`);
    }
    const gate = await this.gates.create({
      id: newId(),
      projectId: input.projectId,
      gateKey: input.gateKey,
      title: input.title,
      requestedBy: actor.username ?? actor.id,
      ...(input.applicationId === undefined ? {} : { applicationId: input.applicationId }),
      ...(input.subject === undefined ? {} : { subject: input.subject }),
      ...(input.detail === undefined ? {} : { detail: input.detail }),
    });
    if (gate === undefined) {
      const pending = await this.gates.findPending(input);
      throw new ConflictException(`Gate ${input.gateKey} is already pending${pending === undefined ? "" : ` (${pending.id})`}`);
    }
    await this.audit.recordChange(
      auditRecord(actor, AUDIT_ACTIONS.gateRequest, { projectId: gate.projectId, subject: gate.id, detail: { gateKey: gate.gateKey, applicationId: gate.applicationId, about: gate.subject } }),
    );
    return gate;
  }

  /** Approves, rejects or waives a pending gate; rejections and waivers need a note. */
  async decide(id: string, command: GateDecisionCommand, actor: Actor): Promise<Gate> {
    const note = command.note?.trim() === "" ? undefined : command.note?.trim();
    if (note === undefined && DECISIONS_NEEDING_NOTE.includes(command.decision)) throw new BadRequestException(`A note is required to ${command.decision} a gate`);
    const current = await this.get(id);
    if (current.status !== "pending") throw new ConflictException(`Gate ${id} has already been decided (${current.status})`);
    const decided = await this.gates.decide(id, GATE_DECISION_STATUS[command.decision], actor.username ?? actor.id, note);
    if (decided === undefined) throw new ConflictException(`Gate ${id} has already been decided`);
    await this.audit.recordChange(
      auditRecord(actor, AUDIT_ACTIONS.gateDecide, {
        projectId: decided.projectId,
        subject: decided.id,
        detail: { gateKey: decided.gateKey, applicationId: decided.applicationId, status: decided.status, ...(note === undefined ? {} : { note }) },
      }),
    );
    return decided;
  }
}
