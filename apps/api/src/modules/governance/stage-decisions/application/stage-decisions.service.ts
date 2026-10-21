import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { StageDecisionConflict, StageDecisionNotFound, type StageDecisionRecord } from "@kintsugi/orchestrator";
import type { Actor } from "#common/auth/decorators.js";
import { ProjectAccessService } from "#modules/admin/project-access/index.js";
import { StageDecisionRepository } from "../domain/stage-decision.repository.js";

@Injectable()
export class StageDecisionsService {
  constructor(
    private readonly decisions: StageDecisionRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async record(input: { runId: string; stage: string; gate: string; choice: string }, actor: Actor): Promise<StageDecisionRecord> {
    if (!actor.permissions.includes("workitems.manage")) throw new ForbiddenException("Missing permission: workitems.manage");

    const projectId = await this.decisions.projectId(input.runId);
    if (projectId === undefined) throw new NotFoundException("Job run not found");
    await this.projectAccess.requireRead(actor.id, projectId);

    const identity = { runId: input.runId, stage: input.stage, gate: input.gate };
    const current = await this.decisions.read(identity);
    if (current === undefined) throw new NotFoundException("No pending human decision exists for this stage");
    if (current.decisionMode !== "required-human" || current.choice !== undefined) {
      if (current.choice === input.choice && current.actorId === actor.id) {
        try {
          return await this.decisions.record({ ...input, projectId, actor });
        } catch (error) {
          throw this.#mapPersistenceError(error);
        }
      }
      throw new ConflictException("This stage decision is not awaiting a human choice");
    }
    if (!current.options.includes(input.choice)) throw new BadRequestException("Choice is not an allowed option for this stage decision");

    try {
      return await this.decisions.record({ ...input, projectId, actor });
    } catch (error) {
      throw this.#mapPersistenceError(error);
    }
  }

  #mapPersistenceError(error: unknown): Error {
    if (error instanceof StageDecisionNotFound) return new NotFoundException("No pending human decision exists for this stage");
    if (error instanceof StageDecisionConflict) return new ConflictException(error.message);
    if (error instanceof Error && error.name === "IdempotencyConflictError") return new ConflictException(error.message);
    return error instanceof Error ? error : new Error(String(error));
  }
}
