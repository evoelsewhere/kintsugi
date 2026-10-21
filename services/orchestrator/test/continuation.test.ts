import { describe, expect, it } from "vitest";
import { planContinuation } from "../src/member-workflow/continue.js";
import type { ApprovedTaskPlan, EffectiveGateFacts } from "../src/member-workflow/continue.js";

const facts: EffectiveGateFacts = { projectId: "shop", unitId: "web/core/invoice", gateId: "G4", decisionId: "gate_" + "a".repeat(48), evidenceHash: "b".repeat(64), recordCommit: "c".repeat(40) };
function plan(): ApprovedTaskPlan {
  return { status: "available", repositoryId: "docs", commit: "d".repeat(40), workItem: { id: facts.unitId, application: "web", module: "core", kind: "module", title: "Invoice", phase: "migrate", status: "in-progress" }, manifest: { schemaVersion: 1, project: { id: "shop", name: "Shop" }, document: { server: "github", path: "org/docs" }, unitKinds: ["module"], applications: [{ id: "web", disposition: "refactor", pipeline: "prepared", repos: [] }], pipelines: [{ id: "prepared", phases: [{ id: "migrate", perUnit: true, stages: [{ id: "approve", performer: { member: ["core-team"] }, gate: "G4" }] }, { id: "verify", perUnit: true, stages: [{ id: "test", performer: { member: ["qc"] } }] }] }], autoCommitPaths: [], policy: { harnesses: [], requireCommitTrailer: true } } };
}

describe("manifest-backed effective continuation", () => {
  it("exposes the next declared member stage without creating a task or runtime job", () => {
    expect(planContinuation(facts, plan())).toEqual([{ status: "member-action", code: "MEMBER_STAGE_AVAILABLE", phase: "verify", stage: "test", nextAction: "Continue the declared member stage test in phase verify (qc). Request current task context before starting." }]);
  });
  it("reports an unsupported runtime stage instead of launching verify", () => {
    const input = plan();
    if (input.status !== "available") throw new Error("fixture");
    input.manifest.pipelines[0]!.phases[1]!.stages[0]!.performer = { agent: "verify" };
    expect(planContinuation(facts, input)[0]).toMatchObject({ status: "unsupported", code: "RUNTIME_CONTINUATION_UNSUPPORTED", phase: "verify", stage: "test" });
  });
  it("never resolves an undeclared built-in pipeline by guessing", () => {
    const input = plan();
    if (input.status !== "available") throw new Error("fixture");
    input.manifest.pipelines = [];
    expect(planContinuation(facts, input)[0]).toMatchObject({ status: "blocked", code: "PIPELINE_NOT_DECLARED" });
  });
  it("blocks a gate repeated in the declared pipeline", () => {
    const input = plan();
    if (input.status !== "available") throw new Error("fixture");
    input.manifest.pipelines[0]!.phases[1]!.stages[0]!.gate = "G4";
    expect(planContinuation(facts, input)[0]).toMatchObject({ status: "blocked", code: "GATE_POSITION_AMBIGUOUS" });
  });
  it("does not advance a task whose current Git phase has moved", () => {
    const input = plan();
    if (input.status !== "available") throw new Error("fixture");
    input.workItem.phase = "verify";
    expect(planContinuation(facts, input)[0]).toMatchObject({ status: "blocked", code: "TASK_POSITION_CHANGED" });
  });
  it("reports an unavailable task and does not invent a replacement", () => {
    expect(planContinuation(facts, { status: "unavailable", code: "TASK_NOT_FOUND" })[0]).toMatchObject({ status: "blocked", code: "TASK_NOT_FOUND" });
  });
});

// These cases catch accidental phase advancement and accidental use of delivery approval
// as permission to run an undeclared member task.
describe("continuation safety boundaries", () => {
  it("blocks a next stage that is not declared per-unit", () => {
    const input = plan();
    if (input.status !== "available") throw new Error("fixture");
    input.manifest.pipelines[0]!.phases[1]!.perUnit = false;
    expect(planContinuation(facts, input)[0]).toMatchObject({ code: "NEXT_STAGE_NOT_PER_UNIT" });
  });
  it("blocks an absent gate instead of treating G4 as a hardcoded phase transition", () => {
    expect(planContinuation({ ...facts, gateId: "G5" }, plan())[0]).toMatchObject({ code: "GATE_POSITION_AMBIGUOUS" });
  });
  it("keeps the actor and evidence out of manifest-derived execution", () => {
    const input = plan();
    if (input.status !== "available") throw new Error("fixture");
    input.manifest.project.id = "other";
    expect(planContinuation(facts, input)[0]).toMatchObject({ code: "TASK_IDENTITY_MISMATCH" });
  });
});

describe("bounded continuation event contract",()=>{
  it("blocks oversized manifest stage identities instead of emitting invalid SDK event metadata",()=>{
    const input=plan();
    if(input.status!=="available") throw new Error("fixture");
    input.manifest.pipelines[0]!.phases[1]!.stages[0]!.id="a".repeat(1001);
    expect(planContinuation(facts,input)[0]).toMatchObject({status:"blocked",code:"PIPELINE_VALUE_TOO_LARGE"});
  });
});
