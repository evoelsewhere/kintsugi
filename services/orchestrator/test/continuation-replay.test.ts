import { describe, expect, it } from "vitest";
import { applyContinuation, type ContinuationDependencies } from "../src/member-workflow/project.js";
import { dispatchContinuation } from "../src/member-workflow/dispatch.js";
import type { EffectiveGateFacts } from "../src/member-workflow/continue.js";

const facts: EffectiveGateFacts = { projectId:"shop",unitId:"web/core/invoice",gateId:"G4",decisionId:"gate_"+"a".repeat(48),evidenceHash:"b".repeat(64),recordCommit:"c".repeat(40) };
describe("durable continuation replay",()=>{
  it("acknowledges a consumed operation even when its SSE event expired and provider is offline",async()=>{
    const deps: ContinuationDependencies = {
      pool:{query:async()=>({rows:[{transition_key:`gate-continuation:${facts.decisionId}:${facts.evidenceHash}`,id:null,sequence:null}]})} as never,
      async current(){throw new Error("provider offline after successful consume");},
      async recheckAuthority(){return false;},
    };
    await expect(applyContinuation(deps,facts)).resolves.toEqual({created:false,transitionKey:`gate-continuation:${facts.decisionId}:${facts.evidenceHash}`,operations:[]});
  });
  it("rejects a next-step operation for another effective decision before consuming it",async()=>{
    const deps: ContinuationDependencies = {pool:{} as never,async current(){throw new Error("must not read Git");},async recheckAuthority(){return true;}};
    await expect(dispatchContinuation(deps,{operationId:"id",transitionKey:"other",projectId:"shop",queue:"workflow-next-step",intentKey:"continue-effective-gate",attempts:1,payload:{...facts}})).rejects.toThrow("continuation identity mismatch");
  });
});
