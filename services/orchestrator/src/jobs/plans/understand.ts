// The `understand` stage (commands/modernize-understand.md, ADR-0031): the last stage of the
// Understand phase. units_from_topology.py proposes the units from the map's topology.json (no
// code is parsed: the map's leaves, grouped by domain and directory); a gate says which units get
// a specification (default: all, within the stage's agent budget); one legacy-analyst job per unit
// writes its AS-IS specification and returns a traceability fragment; merge_traceability.py merges
// the fragments into the traceability matrix; a legacy-analyst synthesis job writes the
// application's index, architecture, data model and integrations; write_work_items.py writes one
// work-item file per unit. Everything goes through one pull request (`reviewAll`): the work items
// are proposals a person merges together with the specifications they link to.
//
// Not wired yet: an agent pass that regroups the units the script flags as ambiguous (the flags
// are in the gate question and units.json), and a re-run of just the failed units.

import type { StageContext, StagePlan } from "../plan.js";
import { CREDENTIALS, HEADER, UNTRUSTED, WORKSPACE } from "./common.js";

const DIR = "assessment/{app}";
const ASIS = "knowledge/as-is/{app}";

const TRACE_SCHEMA = {
  type: "object",
  required: ["entryPoints", "rulesApplied", "findings", "dependencies", "dataObjects", "externalSystems", "files", "openQuestions"],
  properties: {
    entryPoints: { type: "array", items: { type: "string", description: "An entry point of the unit as file:line (route, transaction, main, job step)" } },
    rulesApplied: { type: "array", items: { type: "string", description: "A RULE-NNN id of BUSINESS_RULES.md the unit's code applies" } },
    findings: { type: "array", items: { type: "string", description: "A SEC-NNN id of SECURITY_FINDINGS.md located in the unit's code" } },
    dependencies: {
      type: "array",
      items: {
        type: "object",
        required: ["target", "kind", "direction"],
        properties: {
          target: { type: "string", description: "A unit key (<module>/<unit>) from the brief, a data store id (ds:...), or an external system's name" },
          kind: { type: "string", enum: ["call", "read", "write", "integration"] },
          direction: { type: "string", enum: ["outbound", "inbound"] },
        },
      },
    },
    dataObjects: { type: "array", items: { type: "string", description: "A data object (record, table, DTO, copybook) the unit reads or writes" } },
    externalSystems: { type: "array", items: { type: "string", description: "An external system the unit talks to (logical name, never a URL with credentials)" } },
    files: { type: "array", items: { type: "string", description: "A repository-relative source file the specification cites" } },
    openQuestions: { type: "integer", description: "How many open questions the specification lists" },
  },
};

const SPEC_TASK = `Write the AS-IS specification of one unit of application {app}.

${WORKSPACE}

Your brief is {in}/{item} (read-only): the unit's id and key, its map leaves and their descriptions, its source files,
its size, whether it holds an entry point, the units it depends on and that use it, the data stores it reads and
writes (all from the map), and the RULE and SEC ids whose citations fall in its files. Also under {in}, when present:
${DIR}/topology.json (the map), ${DIR}/ASSESSMENT.md, ${DIR}/BUSINESS_RULES.md and ${DIR}/DATA_OBJECTS.md (the business
rules and data objects extract-rules confirmed), ${DIR}/SECURITY_FINDINGS.md (harden's findings). Read the unit's source
files and follow its calls only as far as needed to describe it; the other units have their own specifications.

Write ${ASIS}/{key}.md with outputs_write, with exactly these sections, in this order:
1. Purpose — what the unit does for the business, in two to four sentences.
2. Entry points — how the unit is started (routes, transactions, screens, job steps, main programs), file:line each.
3. Main flows — the unit's main processing paths, step by step; add a Mermaid sequenceDiagram or flowchart in a fenced
   mermaid block when the flow has more than three participants or branches.
4. Dependencies — inbound (who calls or starts it) and outbound (units, data stores, external systems), as a table:
   direction, target, kind (call, read, write, integration), evidence file:line.
5. Data objects — the records, tables, DTOs or copybooks it reads or writes, with the fields that matter.
6. Business rules applied — each as a RULE-NNN id from BUSINESS_RULES.md with a one-line summary and file:line; a rule
   you see in the code that the catalog lacks is listed as "uncatalogued" with file:line, never given an id.
7. Security findings and risks — each SEC-NNN id from SECURITY_FINDINGS.md located in the unit, and other risks you
   saw (marked as observations, without an id).
8. Configuration — the settings, properties, environment variables and tables that change its behavior (names and
   file:line only; never a value that could be a credential).
9. Error handling — how failures are detected, reported, retried or swallowed.
10. Source references — every file:line the specification relies on.
11. Open questions — what the code does not tell, for a subject-matter expert.
If BUSINESS_RULES.md or SECURITY_FINDINGS.md is absent, say so in its section ("not available: extract-rules has not
run") instead of inventing ids. Mark anything inferred rather than read from code as "(inferred)".

Return the traceability fragment as your structured result: the entry points, the RULE-NNN and SEC-NNN ids you
listed, the dependencies (targets as unit keys from the brief, data store ids from the map, or external system
names), data objects, external systems, the files you cite and the number of open questions.

${HEADER}
${CREDENTIALS}
${UNTRUSTED}`;

const SYNTHESIS_TASK = `Write the AS-IS overview of application {app} from its unit specifications.

${WORKSPACE}

Under {in}, read-only: the unit specifications ${ASIS}/<module>/<unit>.md; the traceability matrix
${ASIS}/traceability.json and traceability.md (deterministic: units, files, dependencies, data stores, rules and
findings, cycles); the map ${DIR}/topology.json; and when present ${DIR}/ASSESSMENT.md, ${DIR}/BUSINESS_RULES.md,
${DIR}/DATA_OBJECTS.md and ${DIR}/SECURITY_FINDINGS.md. Use the source only to settle a contradiction between them.

Write with outputs_write:
- ${ASIS}/README.md — the index: what the application does in a paragraph, then a table of modules and their units
  (each linked to its specification, relative link <module>/<unit>.md, or "not written" when the matrix has no
  spec), the documents below, and which inputs were missing (no BUSINESS_RULES.md, no SECURITY_FINDINGS.md, units
  without a specification).
- ${ASIS}/architecture.md — the AS-IS architecture: modules and their responsibilities, how they interact, entry
  points, batch versus online paths, deployment and runtime as far as the code shows; a Mermaid graph of the modules
  (at most about 40 edges, in a fenced mermaid block); the dependency cycles of the matrix and what they mean.
- ${ASIS}/data-model.md — the data stores and data objects, which units read and write each (from the matrix), keys
  and relationships the code shows, and a Mermaid erDiagram when it helps.
- ${ASIS}/integrations.md — every external system and interface (files, queues, APIs, screens, batch exchanges):
  direction, protocol or format, the units involved, error handling.
Cite unit specifications and file:line; do not restate the traceability tables, link to traceability.md instead.

${HEADER}
${CREDENTIALS}
${UNTRUSTED}`;

interface ProposedUnit {
  key?: unknown;
  brief?: unknown;
  entryPoint?: unknown;
  loc?: unknown;
}

interface UnitsDocument {
  units?: ProposedUnit[];
  ambiguities?: unknown[];
}

const KEY = /^[a-z0-9][a-z0-9-]{0,62}\/[a-z0-9][a-z0-9-]{0,62}$/;

async function proposed(ctx: StageContext): Promise<{ units: Array<{ key: string; entryPoint: boolean; loc: number }>; ambiguities: number }> {
  const doc = (await ctx.readJson(`knowledge/as-is/${ctx.app}/units.json`)) as UnitsDocument | undefined;
  const units = (doc?.units ?? []).flatMap((unit) =>
    typeof unit.key === "string" && KEY.test(unit.key) && unit.brief === `briefs/${unit.key}.json`
      ? [{ key: unit.key, entryPoint: unit.entryPoint === true, loc: typeof unit.loc === "number" ? unit.loc : 0 }]
      : [],
  );
  return { units, ambiguities: Array.isArray(doc?.ambiguities) ? doc.ambiguities.length : 0 };
}

/** Specification jobs the budget allows: the stage's agent budget minus the synthesis job. */
const specBudget = (ctx: StageContext): number => Math.max(0, ctx.agentsLeft() - 1);

/** The units that get a specification: the gate's choice, entry points then largest first, within the budget. */
export async function unitsToSpecify(ctx: StageContext): Promise<string[]> {
  const { units } = await proposed(ctx);
  const chosen = ctx.gate("specify") === "entry points only" ? units.filter((unit) => unit.entryPoint) : units;
  return [...chosen]
    .sort((a, b) => Number(b.entryPoint) - Number(a.entryPoint) || b.loc - a.loc || a.key.localeCompare(b.key))
    .slice(0, specBudget(ctx))
    .map((unit) => unit.key);
}

export const UNDERSTAND: StagePlan = {
  id: "understand",
  message: (app) => `Understand ${app}: AS-IS specifications, traceability and work items`,
  documents: ["kintsugi.yaml", `${DIR}/inventory.json`, `${DIR}/DATA_OBJECTS.md`, `${DIR}/rules_result.json`, "units/{app}/"],
  requires: [
    { path: `${DIR}/ASSESSMENT.md`, stage: "assess" },
    { path: `${DIR}/topology.json`, stage: "map" },
  ],
  optional: [
    { path: `${DIR}/BUSINESS_RULES.md`, stage: "extract-rules" },
    { path: `${DIR}/SECURITY_FINDINGS.md`, stage: "harden" },
  ],
  reviewAll: true,
  steps: [
    {
      id: "units",
      kind: "script",
      script: "units_from_topology.py",
      args: ["{app}", "--assessment", `{in}/${DIR}`, "--manifest", "{in}/kintsugi.yaml", "--out", `{out}/${ASIS}`],
      intermediate: true,
      expects: [`${ASIS}/units.json`],
    },
    {
      id: "specify",
      kind: "gate",
      question: async (ctx) => {
        const { units, ambiguities } = await proposed(ctx);
        return `${units.length} units proposed from the map (${ambiguities} flagged for a person to check in units.json). Write an AS-IS specification for all of them (at most ${specBudget(ctx)} jobs, the stage's agent budget), only for the units that hold an entry point, or cancel?`;
      },
      options: ["all within the budget", "entry points only", "cancel"],
      default: "all within the budget",
      stopOn: ["cancel"],
    },
    {
      id: "specifications",
      kind: "forEach",
      concurrency: 6,
      tolerateFailures: true,
      items: async (ctx) => (await unitsToSpecify(ctx)).map((key) => ({ key, item: `knowledge/as-is/${ctx.app}/briefs/${key}.json` })),
      step: {
        id: "specify-unit",
        kind: "agent",
        agent: "legacy-analyst",
        task: SPEC_TASK,
        schema: TRACE_SCHEMA,
        resultTo: `${ASIS}/trace/{key}.json`,
        intermediate: [`${ASIS}/trace/`],
        expects: [`${ASIS}/{key}.md`],
      },
    },
    {
      id: "traceability",
      kind: "script",
      script: "merge_traceability.py",
      args: [
        "{app}",
        "--units",
        `{in}/${ASIS}/units.json`,
        "--trace",
        `{in}/${ASIS}/trace`,
        "--specs",
        `{in}/${ASIS}`,
        "--assessment",
        `{in}/${DIR}`,
        "--source",
        "{src}",
        "--source-repo",
        "{repo}",
        "--source-commit",
        "{commit}",
        "--out",
        `{out}/${ASIS}`,
      ],
      expects: [`${ASIS}/traceability.json`, `${ASIS}/traceability.md`],
    },
    {
      id: "synthesis",
      kind: "agent",
      agent: "legacy-analyst",
      task: SYNTHESIS_TASK,
      expects: [`${ASIS}/README.md`, `${ASIS}/architecture.md`, `${ASIS}/data-model.md`, `${ASIS}/integrations.md`],
    },
    {
      id: "work-items",
      kind: "script",
      script: "write_work_items.py",
      args: ["{app}", "--traceability", `{in}/${ASIS}/traceability.json`, "--existing", "{in}/units/{app}", "--repo", "{repo}", "--out", "{out}"],
    },
  ],
};
