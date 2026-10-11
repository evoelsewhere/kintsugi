// The `extract-rules` stage (commands/modernize-extract-rules.md): make_shards.py builds the
// shard list (from topology.json when `map` ran, else the directory tree); workflow
// extract-rules.js runs the extractor, referee, consolidation, P0-panel and DTO-catalog jobs
// (module mode, or lens mode on a tiny estate); its returned object is saved as
// rules_result.json; render_rules.py writes BUSINESS_RULES.md and DATA_OBJECTS.md.
//
// Not wired yet: a module pattern from the portal, splitting more than ~70 shards into parts,
// resuming a stopped workflow, and the follow-up run for `rerunModules`.

import type { StageContext, StagePlan } from "../plan.js";

const DIR = "assessment/{app}";
/** Above this many shards the command asks a person to confirm the run. */
const CONFIRM_ABOVE = 12;

const shards = async (ctx: StageContext): Promise<unknown[]> => {
  const value = await ctx.readJson(`assessment/${ctx.app}/extract-rules.modules.json`);
  return Array.isArray(value) ? value : [];
};

/** make_shards.py says "tiny estate" when sharding adds little: the workflow then runs in lens mode. */
const tinyEstate = (ctx: StageContext): boolean => /\btiny estate\b/.test(ctx.stdout("shards") ?? "");

export const EXTRACT_RULES: StagePlan = {
  id: "extract-rules",
  message: (app) => `Extract business rules of ${app}`,
  documents: ["kintsugi.yaml", `${DIR}/ASSESSMENT.md`, `${DIR}/topology.json`],
  requires: [{ path: `${DIR}/ASSESSMENT.md`, stage: "assess" }],
  steps: [
    {
      id: "shards",
      kind: "script",
      script: "make_shards.py",
      args: ["{app}", "--source", "{src}", "--assessment", `{in}/${DIR}`, "--out", `{out}/${DIR}`],
      expects: [`${DIR}/extract-rules.modules.json`],
    },
    {
      id: "confirm",
      kind: "gate",
      when: async (ctx) => !tinyEstate(ctx) && (await shards(ctx)).length > CONFIRM_ABOVE,
      question: async (ctx) => {
        const count = (await shards(ctx)).length;
        return `${count} shards: about ${count * 10}–${count * 15} agent jobs (about 16k tokens each). Run all ${count} shards, only a slice (a module pattern), or cancel?`;
      },
      options: ["run all", "only a slice", "cancel"],
      default: "run all",
      stopOn: ["cancel"],
    },
    {
      id: "mine",
      kind: "workflow",
      workflow: "extract-rules",
      args: async (ctx) => (tinyEstate(ctx) ? { app: ctx.app } : { app: ctx.app, modules: await shards(ctx) }),
      resultTo: `${DIR}/rules_result.json`,
    },
    {
      id: "render",
      kind: "script",
      script: "render_rules.py",
      args: ["{app}", "--assessment", `{in}/${DIR}`, "--out", `{out}/${DIR}`],
      expects: [`${DIR}/BUSINESS_RULES.md`, `${DIR}/DATA_OBJECTS.md`],
    },
  ],
};
