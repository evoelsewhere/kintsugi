// The `plan-understand` stage (ADR-0041): an AI plan of what to understand next. The catalog says what
// exists; the order matters because a specification cites what an item calls and what calls it, and
// items that call each other read best in one run. Three steps:
//
//   plan_graph.py   the item graph from the catalog: who depends on whom (the links the assess stage
//                   recorded in each item's card), data stores, fan-in and fan-out, depth, cycles
//   plan            an understand-planner job (skill understand-planning) reads the graph and the
//                   assessment and proposes batches with a reason each (no code needed: the graph and the
//                   assessment are its evidence)
//   check_plan.py   the script decides what stands: unknown, understood, test or generated items and
//                   repeats are dropped, batches are capped, and each batch gets the numbers only the
//                   graph can give (size, cohesion, what it still depends on); a plan with nothing
//                   left sends the job back once with the reason
//
// Only plan.md (01-legacy/plan.md, ADR-0051) is published, and it is an auto-commit path: advice every
// run replaces, not a proposal a person reviews. The graph and the draft are scratch JSON (intermediate). The plugin's command
// (commands/modernize-plan-understand.md) declares the same flow; test/flow-sync.test.ts keeps them equal.

import type { StagePlan } from "../plan.js";
import {
  DOCUMENT_PATH_TOKENS,
  assessmentCatalogDir,
  assessmentCatalogPath,
  assessmentSynthesisPath,
  assessmentTopologyPath,
  legacyDir,
  understandGraphPath,
  understandPlanDraftPath,
  understandPlanPath,
} from "@kintsugi/domain";
import { CREDENTIALS, HEADER, UNTRUSTED, WORKSPACE } from "./common.js";

const APP_TOKEN = DOCUMENT_PATH_TOKENS.app;
const GRAPH = understandGraphPath(APP_TOKEN);
const DRAFT = understandPlanDraftPath(APP_TOKEN);
const PLAN = understandPlanPath(APP_TOKEN);
/** The plugin's planning agent: it carries the `understand-planning` skill, which holds the method. */
const PLANNER = "understand-planner";

/** Items a planned batch holds at most (the plan check enforces it) and the batches a plan holds. */
const MAX_BATCH = 8;
const MAX_BATCHES = 8;

export const PLAN_SCHEMA = {
  type: "object",
  required: ["strategy", "batches"],
  properties: {
    strategy: { type: "string", description: "Two to four sentences: in what order the application should be understood and why" },
    batches: {
      type: "array",
      items: {
        type: "object",
        required: ["title", "items", "rationale", "risk"],
        properties: {
          title: { type: "string", description: "A short name for the batch, for example 'Account foundations'" },
          items: { type: "array", items: { type: "string", description: "A catalog item id (<module>/<item>) from the graph" } },
          rationale: { type: "string", description: "Why these items, together, now: cite graph facts (fan-in, cycle, data stores) and assessment facts (finding ids, the recommended pattern)" },
          risk: { type: "string", enum: ["high", "medium", "low"], description: "How much it matters to understand this batch early" },
        },
      },
    },
    leftOut: {
      type: "array",
      items: { type: "object", required: ["item", "reason"], properties: { item: { type: "string" }, reason: { type: "string" } } },
    },
  },
};

const PLAN_TASK = `Plan the order in which application {app} should be understood, as batches of catalog items.

${WORKSPACE}

The item graph is {in}/${GRAPH}: per catalog item its size (loc), complexity, whether it is understood already, whether it is test or
generated code (assetClass), whether it holds an entry point, the items it depends on (dependsOn, with the kinds of calls and
how many), the items that use it (usedBy), the data stores it touches, its fan-in and fan-out, its depth (0 = it depends on no
other item) and its cycle (items that depend on each other). Also under {in}: ${assessmentSynthesisPath(APP_TOKEN)}
(the assessment: summary, rebuild outlook, risks), ${assessmentCatalogPath(APP_TOKEN)} (and the module documents next to it) and ${assessmentTopologyPath(APP_TOKEN)}.
Read the graph and the assessment first; open source files only to settle a doubt, a few at most.

Follow your understand-planning skill: it says how to read the graph and which rules decide an order. Plan only items that are
open (not understood, assetClass "code"). This run's limits: a batch holds at most ${MAX_BATCH} items and a plan at most ${MAX_BATCHES} batches; aim for
batches a reviewer can read in one pull request (a few thousand code lines). Number the batches in the order they should run. Items that
are not worth a specification yet go in leftOut with a one-line reason, as does anything you could not place. Use only ids of the graph.

Return your plan as the structured result: a strategy of two to four sentences, the batches (title, items, a rationale that
cites graph facts and assessment facts, risk) and leftOut. Write nothing else.

${HEADER}
${CREDENTIALS}
${UNTRUSTED}`;

const repairTask = `The plan for application {app} was rejected by its check.

${WORKSPACE}

The graph is {in}/${GRAPH}. The check said:

{error}

Return a corrected plan as the structured result, with the same schema. Name only items of the graph that are open (not understood,
assetClass "code"), each in at most one batch, at most ${MAX_BATCH} items per batch.

${CREDENTIALS}
${UNTRUSTED}`;

export const PLAN_UNDERSTAND: StagePlan = {
  id: "plan-understand",
  message: (app) => `Plan which items of ${app} to understand next`,
  documents: ["kintsugi.yaml", `${legacyDir(APP_TOKEN)}/`],
  requires: [{ path: assessmentCatalogPath(APP_TOKEN), stage: "assess" }],
  steps: [
    {
      id: "graph",
      kind: "script",
      script: "plan_graph.py",
      args: ["{app}", "--catalog", `{in}/${assessmentCatalogDir(APP_TOKEN)}`, "--existing", `{in}/${legacyDir(APP_TOKEN)}`, "--out", "{out}"],
      intermediate: [GRAPH],
      expects: [GRAPH],
    },
    {
      id: "plan",
      kind: "agent",
      agent: PLANNER,
      task: PLAN_TASK,
      schema: PLAN_SCHEMA,
      resultTo: DRAFT,
      intermediate: [DRAFT],
    },
    {
      id: "check",
      kind: "script",
      script: "check_plan.py",
      args: ["{app}", "--draft", `{in}/${DRAFT}`, "--graph", `{in}/${GRAPH}`, "--out", "{out}", "--max-batch", String(MAX_BATCH), "--max-batches", String(MAX_BATCHES)],
      expects: [PLAN],
      repair: { id: "plan-fix", kind: "agent", agent: PLANNER, task: repairTask, schema: PLAN_SCHEMA, resultTo: DRAFT, intermediate: [DRAFT] },
    },
  ],
};
