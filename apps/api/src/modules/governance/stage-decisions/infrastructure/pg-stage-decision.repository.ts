import { createHash } from "node:crypto";
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import { getPool, withTransaction } from "#common/db/pool.js";
import { readStageDecision, recordStageDecision, type StageDecisionRecord, type StageDecisionSubmission } from "@kintsugi/orchestrator";
import { recordTransition } from "@kintsugi/orchestrator/outbox";
import type { Pool } from "pg";
import { StageDecisionRepository, type RecordStageDecision, type StageDecisionIdentity } from "../domain/stage-decision.repository.js";

@Injectable()
export class PgStageDecisionRepository extends StageDecisionRepository {
  constructor(private readonly audit: AuditTrail) {
    super();
  }

  get #pool(): Pool {
    return getPool();
  }

  async projectId(runId: string): Promise<string | undefined> {
    const result = await this.#pool.query<{ project_id: string }>("select project_id from workflow.job_run where id = $1", [runId]);
    return result.rows[0]?.project_id;
  }

  read(identity: StageDecisionIdentity): Promise<StageDecisionRecord | undefined> {
    return readStageDecision(this.#pool, identity);
  }

  async record(input: RecordStageDecision): Promise<StageDecisionRecord> {
    return withTransaction(async (tx) => {
      const run = await tx.query<{ project_id: string }>("select project_id from workflow.job_run where id = $1 for share", [input.runId]);
      if (run.rows[0] === undefined) throw new NotFoundException("Job run not found");
      if (run.rows[0].project_id !== input.projectId) throw new NotFoundException("Job run not found");
      const grant = await tx.query(
        "select 1 from admin.project_access where project_id = $1 and user_id = $2 for share",
        [input.projectId, input.actor.id],
      );
      if ((grant.rowCount ?? 0) !== 1) throw new ForbiddenException("Project Access is required");

      const submission: StageDecisionSubmission = {
        runId: input.runId,
        stage: input.stage,
        gate: input.gate,
        choice: input.choice,
        actorId: input.actor.id,
      };
      const transitionKey = decisionTransitionKey(input);
      await recordTransition(tx, {
        transitionKey,
        projectId: input.projectId,
        event: {
          kind: "stage.decision.recorded",
          metadata: { runId: input.runId, stage: input.stage, gate: input.gate, choice: input.choice, actorId: input.actor.id },
        },
      }, async (transaction) => {
        await recordStageDecision(transaction, submission);
        await this.audit.recordWithIds([
          auditRecord(input.actor, AUDIT_ACTIONS.stageDecisionRecord, {
            projectId: input.projectId,
            subject: input.runId,
            detail: { stage: input.stage, gate: input.gate, choice: input.choice },
          }),
        ], transaction);
      });

      const saved = await readStageDecision(tx, input);
      if (saved === undefined) throw new Error("Stage decision was not stored");
      return saved;
    });
  }
}

function decisionTransitionKey(input: StageDecisionIdentity): string {
  const identity = JSON.stringify([input.runId, input.stage, input.gate]);
  return "stage-decision:" + createHash("sha256").update(identity).digest("hex");
}
