// The stage plans the portal can run (ADR-0027), by stage id: each is data (plans/*.ts) run by
// the generic executor (executor.ts). Exported as `@kintsugi/orchestrator/stages` so the API
// knows which stages are runnable and what they need before they start, without loading the
// worker.

import type { StagePlan, StagePrerequisite } from "./plan.js";
import { ASSESS } from "./plans/assess.js";
import { DESIGN } from "./plans/design.js";
import { PLAN_UNDERSTAND } from "./plans/plan-understand.js";
import { REBUILD } from "./plans/rebuild.js";
import { REVIEW } from "./plans/review.js";
import { UNDERSTAND } from "./plans/understand.js";

export const STAGES: Readonly<Record<string, StagePlan>> = {
  assess: ASSESS,
  understand: UNDERSTAND,
  "plan-understand": PLAN_UNDERSTAND,
  design: DESIGN,
  review: REVIEW,
  rebuild: REBUILD,
};

export const STAGE_IDS = Object.keys(STAGES);

/** What the API needs to know about a runnable stage. */
export interface StageInfo {
  id: string;
  requires: StagePrerequisite[];
}

/** The runnable stages with their prerequisites, {app} filled for `app` when given. */
export function stageInfo(app?: string): StageInfo[] {
  return Object.values(STAGES).map((plan) => ({
    id: plan.id,
    requires: (plan.requires ?? []).map((entry) => ({ stage: entry.stage, path: app === undefined ? entry.path : entry.path.replaceAll("{app}", app) })),
  }));
}

export { PLACEHOLDER_NAMES, fill, type Placeholders, type StagePlan, type StagePrerequisite, type StageStep } from "./plan.js";
