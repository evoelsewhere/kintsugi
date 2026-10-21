import { describe, expect, it } from "vitest";
import { DEFAULT_GATE_DECIDER } from "../src/jobs/model.js";
import type { Pool } from "pg";
import * as publicOrchestrator from "../src/index.js";
import type { GateRequest } from "../src/jobs/model.js";
import { StagePlanExecutor } from "../src/jobs/executor.js";
import type { GateStep } from "../src/jobs/plan.js";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./support/database.js";

interface StageDecisionContract {
  createPersistedGateDecider(deps: { db: Pick<Pool, "query">; pollIntervalMs?: number }): {
    decide(request: {
      runId: string;
      projectId: string;
      stage: string;
      gate: string;
      question: string;
      options: readonly string[];
      default: string;
      decisionMode: "required-human" | "default";
      resumeOf?: string;
    }, signal?: AbortSignal): Promise<{ choice: string; defaulted: boolean; by?: string }>;
  };
  recordStageDecision(db: Pick<Pool, "query">, input: {
    runId: string;
    stage: string;
    gate: string;
    choice: string;
    actorId: string;
  }): Promise<{ runId: string; stage: string; gate: string; decisionMode: "required-human" | "default"; options: string[]; choice?: string; actorId?: string }>;
  readStageDecision(db: Pick<Pool, "query">, input: { runId: string; stage: string; gate: string }): Promise<{
    runId: string;
    stage: string;
    gate: string;
    decisionMode: "required-human" | "default";
    options: string[];
    choice?: string;
    actorId?: string;
  } | undefined>;
}

const stageDecisions = publicOrchestrator as unknown as StageDecisionContract;

describe("stage decisions", () => {
  it("never turns a required-human choice into the documented default", async () => {
    await expect(DEFAULT_GATE_DECIDER.decide({
      runId: "run-1",
      projectId: "project-1",
      stage: "assess",
      gate: "continue",
      question: "Continue?",
      options: ["yes", "no"],
      default: "yes",
      decisionMode: "required-human",
    })).rejects.toThrow(/human decision/i);
  });

  it("passes decision mode and the original run through the executor and preserves the authenticated actor", async () => {
    const result = await executeGate(
      requiredGate,
      async () => ({ choice: "continue", defaulted: false, by: "human-1" }),
      "run-original",
    );
    expect(result.requests[0]).toMatchObject({ runId: "run-resume", resumeOf: "run-original", decisionMode: "required-human" });
    expect(result.outcome.gates).toEqual([{ id: "human-check", question: "Continue?", choice: "continue", defaulted: false, by: "human-1" }]);
  });

  it("rejects a decider that defaults a required-human gate or returns a choice outside its options", async () => {
    await expect(executeGate(requiredGate, async () => ({ choice: "continue", defaulted: true }))).rejects.toThrow(/authenticated human/i);
    await expect(executeGate(requiredGate, async () => ({ choice: "continue", defaulted: false, by: " " }))).rejects.toThrow(/authenticated human/i);
    await expect(executeGate(requiredGate, async () => ({ choice: "maybe", defaulted: false, by: "human-1" }))).rejects.toThrow(/outside its allowed options/i);
  });

  it.skipIf(!hasDatabase)("waits for a required human choice and reads it after a fresh decider is constructed", async () => {
    const db = await createTestDatabase();
    try {
      await seed(db, "run-required");
      const request = requestFor("run-required", "required-human");
      const decider = stageDecisions.createPersistedGateDecider({ db: db.pool, pollIntervalMs: 10 });
      const result = decider.decide(request);
      await waitUntil(async () => (await stageDecisions.readStageDecision(db.pool, { runId: request.runId, stage: request.stage, gate: request.gate })) !== undefined);
      const saved = await stageDecisions.recordStageDecision(db.pool, { runId: request.runId, stage: request.stage, gate: request.gate, choice: "continue", actorId: "human-1" });
      expect(saved).toMatchObject({ decisionMode: "required-human", options: ["continue", "stop"], choice: "continue", actorId: "human-1" });
      await expect(result).resolves.toEqual({ choice: "continue", defaulted: false, by: "human-1" });
      await expect(stageDecisions.createPersistedGateDecider({ db: db.pool }).decide(request)).resolves.toEqual({ choice: "continue", defaulted: false, by: "human-1" });
    } finally {
      await db.drop();
    }
  });

  it.skipIf(!hasDatabase)("persists the optional documented default without an authenticated actor", async () => {
    const db = await createTestDatabase();
    try {
      await seed(db, "run-default");
      const request = requestFor("run-default", "default");
      await expect(stageDecisions.createPersistedGateDecider({ db: db.pool }).decide(request)).resolves.toEqual({ choice: "stop", defaulted: true });
      await expect(stageDecisions.readStageDecision(db.pool, { runId: request.runId, stage: request.stage, gate: request.gate })).resolves.toMatchObject({ decisionMode: "default", options: ["continue", "stop"], choice: "stop" });
      await expect(stageDecisions.createPersistedGateDecider({ db: db.pool }).decide(request)).resolves.toEqual({ choice: "stop", defaulted: true });
    } finally {
      await db.drop();
    }
  });

  it.skipIf(!hasDatabase)("rejects invalid choices and conflicting duplicate submissions but accepts an exact replay", async () => {
    const db = await createTestDatabase();
    try {
      await seed(db, "run-conflict");
      const request = requestFor("run-conflict", "required-human");
      const decider = stageDecisions.createPersistedGateDecider({ db: db.pool, pollIntervalMs: 10 });
      const pending = decider.decide(request);
      await waitUntil(async () => (await stageDecisions.readStageDecision(db.pool, { runId: request.runId, stage: request.stage, gate: request.gate })) !== undefined);
      const invalid = { runId: request.runId, stage: request.stage, gate: request.gate, choice: "maybe", actorId: "human-1" };
      await expect(stageDecisions.recordStageDecision(db.pool, invalid)).rejects.toThrow(/allowed option/i);
      const valid = { ...invalid, choice: "continue" };
      await expect(stageDecisions.recordStageDecision(db.pool, valid)).resolves.toMatchObject({ choice: "continue", actorId: "human-1" });
      await expect(stageDecisions.recordStageDecision(db.pool, valid)).resolves.toMatchObject({ choice: "continue", actorId: "human-1" });
      await expect(stageDecisions.recordStageDecision(db.pool, { ...valid, choice: "stop" })).rejects.toThrow(/conflict/i);
      await expect(stageDecisions.recordStageDecision(db.pool, { ...valid, actorId: "human-2" })).rejects.toThrow(/conflict/i);
      await pending;
    } finally {
      await db.drop();
    }
  });

  it.skipIf(!hasDatabase)("resumes from the original run's decision row without changing its actor", async () => {
    const db = await createTestDatabase();
    try {
      await seed(db, "run-original");
      await seed(db, "run-resume");
      const original = requestFor("run-original", "required-human");
      const decider = stageDecisions.createPersistedGateDecider({ db: db.pool, pollIntervalMs: 10 });
      const pending = decider.decide(original);
      await waitUntil(async () => (await stageDecisions.readStageDecision(db.pool, { runId: original.runId, stage: original.stage, gate: original.gate })) !== undefined);
      await stageDecisions.recordStageDecision(db.pool, { runId: original.runId, stage: original.stage, gate: original.gate, choice: "continue", actorId: "human-1" });
      await pending;
      await expect(decider.decide({ ...original, runId: "run-resume", resumeOf: "run-original" })).resolves.toEqual({ choice: "continue", defaulted: false, by: "human-1" });
      await expect(stageDecisions.readStageDecision(db.pool, { runId: "run-resume", stage: original.stage, gate: original.gate })).resolves.toBeUndefined();
    } finally {
      await db.drop();
    }
  });
});

const requiredGate: GateStep = {
  id: "human-check",
  kind: "gate",
  question: "Continue?",
  options: ["continue", "stop"],
  default: "stop",
  decisionMode: "required-human",
};

async function executeGate(
  step: GateStep,
  decide: (request: GateRequest) => Promise<{ choice: string; defaulted: boolean; by?: string }>,
  resumeOf?: string,
) {
  const requests: GateRequest[] = [];
  const executor = new StagePlanExecutor({
    plan: { id: "assess", message: () => "Assessment", steps: [step] },
    run: { id: "run-resume", projectId: "project-1" },
    values: { app: "app", repo: "repo", commit: "a".repeat(40) },
    dirs: { root: "unused", in: "unused", work: "unused", out: "unused" },
    limits: { maxAgents: 10, concurrency: 1 },
    gates: { decide: async (request) => { requests.push(request); return decide(request); } },
    runLeaf: async () => { throw new Error("gate-only plan must not run a leaf"); },
    log: async () => undefined,
    ...(resumeOf === undefined ? {} : { resumeOf }),
  });
  return { outcome: await executor.run(), requests };
}

async function seed(db: TestDatabase, runId: string): Promise<void> {
  await db.pool.query("insert into core.app_user (id,username,password_hash,password_salt) values ('human-1','human-1','test','test'), ('human-2','human-2','test','test') on conflict do nothing");
  await db.pool.query("insert into admin.project (id,name) values ('project-1','Project') on conflict do nothing");
  await db.pool.query("insert into workflow.job_run (id,project_id,kind,name,status) values ($1,'project-1','stage','assess','running')", [runId]);
}

function requestFor(runId: string, decisionMode: "required-human" | "default") {
  return { runId, projectId: "project-1", stage: "assess", gate: "human-check", question: "Continue?", options: ["continue", "stop"], default: "stop", decisionMode } as const;
}

async function waitUntil(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for the stage decision row");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
