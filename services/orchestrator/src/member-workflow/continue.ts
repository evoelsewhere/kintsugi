import type { KintsugiManifest, WorkItemFile } from "@kintsugi/domain";

export const CONTINUATION_QUEUE = "workflow-next-step";
export interface EffectiveGateFacts {
  projectId: string;
  unitId: string;
  gateId: string;
  decisionId: string;
  evidenceHash: string;
  recordCommit: string;
}
export type ApprovedTaskPlan =
  | { status: "available"; repositoryId: string; commit: string; manifest: KintsugiManifest; workItem: WorkItemFile }
  | { status: "unavailable"; code: string };
export interface WorkflowIntent {
  status: "member-action" | "blocked" | "unsupported" | "complete";
  code: string;
  phase?: string;
  stage?: string;
  nextAction: string;
}

/** A member stage is guidance, not a new Git task, an approval, or a runtime job. */
export function planContinuation(input: EffectiveGateFacts, taskPlan: ApprovedTaskPlan): WorkflowIntent[] {
  const blocked = (code: string): WorkflowIntent[] => [{ status: "blocked", code, nextAction: `Continuation is blocked: ${code}. Update the declared pipeline or current Git task and request a new evidence-bound decision.` }];
  const bounded = (intent: WorkflowIntent): WorkflowIntent[] => Object.values(intent).some(value => value.length > 1000) ? blocked("PIPELINE_VALUE_TOO_LARGE") : [intent];
  if (taskPlan.status !== "available") return blocked(taskPlan.code);
  const { manifest, workItem } = taskPlan;
  if (manifest.project.id !== input.projectId || workItem.id !== input.unitId) return blocked("TASK_IDENTITY_MISMATCH");
  const application = manifest.applications.find(item => item.id === workItem.application);
  const pipeline = manifest.pipelines.find(item => item.id === application?.pipeline);
  if (pipeline === undefined) return blocked("PIPELINE_NOT_DECLARED");
  const stages = pipeline.phases.flatMap(phase => phase.stages.map(stage => ({ phase, stage })));
  const anchors = stages.flatMap((item, index) => item.stage.gate === input.gateId ? [index] : []);
  if (anchors.length !== 1) return blocked("GATE_POSITION_AMBIGUOUS");
  const anchor = stages[anchors[0]!]!;
  if (anchor.phase.id !== workItem.phase || (workItem.stage !== undefined && workItem.stage !== anchor.stage.id)) return blocked("TASK_POSITION_CHANGED");
  const next = stages[anchors[0]! + 1];
  if (next === undefined) return [{ status: "complete", code: "PIPELINE_END", nextAction: "The declared pipeline has no next stage. Review the current Git task; no new task has been created." }];
  if (next.phase.perUnit !== true) return blocked("NEXT_STAGE_NOT_PER_UNIT");
  if (next.stage.gate !== undefined) return blocked("NEXT_STAGE_REQUIRES_GATE");
  const position = { phase: next.phase.id, stage: next.stage.id };
  if ("agent" in next.stage.performer) return bounded({ status: "unsupported", code: "RUNTIME_CONTINUATION_UNSUPPORTED", ...position, nextAction: `The declared next stage ${next.stage.id} requires runtime agent ${next.stage.performer.agent}. Automatic runtime continuation is unsupported; coordinate this stage in the portal.` });
  return bounded({ status: "member-action", code: "MEMBER_STAGE_AVAILABLE", ...position, nextAction: `Continue the declared member stage ${next.stage.id} in phase ${next.phase.id} (${next.stage.performer.member.join(", ")}). Request current task context before starting.` });
}
