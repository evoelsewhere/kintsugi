import type { Pool, PoolClient } from "pg";
import type { GateEvidence } from "@kintsugi/domain";
import type { GateMappedReviewer } from "../gates/effective.js";
import type { TransitionReceipt } from "../outbox/model.js";
import { recordTransition } from "../outbox/store.js";
import { planContinuation, type ApprovedTaskPlan, type EffectiveGateFacts } from "./continue.js";

export interface ContinuationDependencies {
  pool: Pool;
  current(input: EffectiveGateFacts): Promise<{ plan: ApprovedTaskPlan; evidence: GateEvidence; reviewers: GateMappedReviewer[] } | undefined>;
  recheckAuthority(client: PoolClient, evidence: GateEvidence, reviewers: readonly GateMappedReviewer[]): Promise<boolean>;
}

/** Consumes an effective gate once; Git/provider reads precede the short DB transaction. */
export async function applyContinuation(deps: ContinuationDependencies, input: EffectiveGateFacts): Promise<TransitionReceipt> {
  const transitionKey = `gate-continuation:${input.decisionId}:${input.evidenceHash}`;
  // The transition receipt outlives the seven-day SSE event retention window.
  const completed = await deps.pool.query<{ id: string | null; sequence: string | null }>(
    `select event.id,event.sequence::text as sequence from workflow.member_transition transition
       left join workflow.member_event event on event.transition_key=transition.transition_key
      where transition.transition_key=$1 and transition.project_id=$2 and transition.unit_id=$3`,
    [transitionKey,input.projectId,input.unitId],
  );
  if (completed.rows.length !== 0) {
    const event = completed.rows[0]!;
    return {created:false,transitionKey,operations:[],...(event.id === null || event.sequence === null ? {} : {event:{eventId:event.id,sequence:event.sequence}})};
  }
  const current = await deps.current(input);
  if (current === undefined) throw new Error("effective gate evidence is no longer current");
  const intent = planContinuation(input, current.plan)[0]!;
  const tx = await deps.pool.connect();
  try {
    await tx.query("begin");
    const publication = await tx.query(
      "select decision_id from workflow.gate_publication where decision_id=$1 and project_id=$2 and unit_id=$3 and gate_id=$4 and evidence_hash=$5 and record_commit=$6 and state='effective' for update",
      [input.decisionId, input.projectId, input.unitId, input.gateId, input.evidenceHash, input.recordCommit],
    );
    if (publication.rows.length !== 1) throw new Error("effective publication identity changed");
    const existing = await tx.query<{ id: string; sequence: string }>("select id,sequence::text as sequence from workflow.member_event where transition_key=$1", [transitionKey]);
    const prior = existing.rows[0];
    if (prior !== undefined) {
      await tx.query("commit");
      return { created: false, transitionKey, event: { eventId: prior.id, sequence: prior.sequence }, operations: [] };
    }
    if (!await deps.recheckAuthority(tx, current.evidence, current.reviewers)) throw new Error("effective gate authority changed");
    const receipt = await recordTransition(tx, {
      transitionKey, projectId: input.projectId, unitId: input.unitId,
      event: { kind: "task.continuation", metadata: {
        schemaVersion: "1", decisionId: input.decisionId, gateId: input.gateId, evidenceHash: input.evidenceHash, recordCommit: input.recordCommit,
        status: intent.status, code: intent.code, nextAction: intent.nextAction.slice(0, 1000), phase: intent.phase ?? null, stage: intent.stage ?? null,
        sourceCommit: current.plan.status === "available" ? current.plan.commit : null,
      } },
    }, async () => {});
    await tx.query("commit");
    return receipt;
  } catch (error) {
    await tx.query("rollback");
    throw error;
  } finally { tx.release(); }
}
