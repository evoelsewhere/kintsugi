import type { StageDecisionRecord, StageDecisionSubmission } from "@kintsugi/orchestrator";
import type { Actor } from "#common/auth/decorators.js";

export interface StageDecisionIdentity {
  runId: string;
  stage: string;
  gate: string;
}

export interface RecordStageDecision extends Omit<StageDecisionSubmission, "actorId"> {
  projectId: string;
  actor: Actor;
}

/** Persistence boundary for the procedural stage choice, its audit row and durable event. */
export abstract class StageDecisionRepository {
  abstract projectId(runId: string): Promise<string | undefined>;
  abstract read(identity: StageDecisionIdentity): Promise<StageDecisionRecord | undefined>;
  abstract record(input: RecordStageDecision): Promise<StageDecisionRecord>;
}
