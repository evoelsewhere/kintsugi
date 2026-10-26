// The `design` stage (commands/modernize-design.md, ADR-0049): generates one design set (the project's own,
// ADR-0045) for a selection of understood units, or, for a set of scope `application` (ADR-0050), for the application
// itself (the one pseudo-unit `@app`). A run is one set × many units (inputs.scope: the unit keys and the set) and one
// pull request that touches only the `<set>/` folders of its units on the modern side (or `_design/<set>/` of the application). The flow is the one of
// `understand`: a script prepares, an agent job per unit does the work, a script checks it, and a second round fixes
// what the check found; an independent reviewer reads each unit in between (ADR-0054):
//
//   scaffold_design.py   per unit the skeleton of each document of the set from its template (scratch) and a manifest
//   forEach unit         a designer job writes every document of the set at its document-repository path
//   check_design.py      the template's checks for every unit; the report is scratch
//   forEach unit         a design-reviewer job reads the documents against the unit's AS-IS specification and writes its findings (scratch)
//   check_review.py      the findings of the notes, per unit (scratch)
//   forEach flagged unit a designer job fixes what the check named and the blockers and majors of the review (skipped when nothing was flagged)
//   check_design.py      the result; a unit that still has problems is carried by the pull request, never a failure
//   render_design_review.py  the review of the run: the description of the pull request (scratch)
//
// The documents are the published output; the skeletons, the manifest and the reports are intermediate. What a
// document must contain is the project's template (01-standards/templates/<set>/), read by the agent, the scaffold and the
// checks alike.

import type { StageContext, StagePlan, StageScope } from "../plan.js";
import {
  DOCUMENT_PATH_TOKENS,
  applicationDesignPath,
  applicationDesignSetDir,
  applicationRequirementsPath,
  architectureDir,
  assessmentCatalogPath,
  assessmentDir,
  commonComponentsDir,
  designManifestPath,
  designReportPath,
  designReviewPath,
  designReviewReportPath,
  designSetsDir,
  designSummaryPath,
  generatedDir,
  legacyDir,
  modernDir,
  standardsDir,
  transitionDir,
  unitKeyAsIsPath,
  unitKeyDesignSetDir,
  unitKeyStatePath,
} from "@kintsugi/domain";
import { CREDENTIALS, UNTRUSTED, WORKSPACE } from "./common.js";

const APP_TOKEN = DOCUMENT_PATH_TOKENS.app;
const MANIFEST = designManifestPath(APP_TOKEN);
const REPORT = designReportPath(APP_TOKEN);
const REVIEW_REPORT = designReviewReportPath(APP_TOKEN);
const SUMMARY = designSummaryPath(APP_TOKEN);
const SET_ID = /^[a-z0-9][a-z0-9_-]{0,62}$/;
/** The designer agent of the `design` plugin. */
const DESIGNER = "designer";
/** The independent reviewer of the `design` plugin (ADR-0054). */
const REVIEWER = "design-reviewer";
/** The project's common design and standards, as every designer job reads them. */
const COMMON = `${architectureDir()}/blueprint.md and ${commonComponentsDir()}/ (components COM-...), the requirements ${applicationRequirementsPath(APP_TOKEN)}, the application's design
  ${applicationDesignPath(APP_TOKEN)}, the project's ${standardsDir()}/ (conventions, mappings), and ${transitionDir()}/ (coexistence,
  data migration, and the shared data definitions in shared-data/ that several applications use)`;

const READING = `Under {in} (read-only), at their document-repository paths:
- The project's definition of the set: ${designSetsDir()}/<set>/set.md and the template of each document next to it, and, when the manifest
  names a profile for your unit's kind, <set>/<kind>/profile.md: its Instructions come after the set's, and the templates in that folder
  replace the set's own of the same name. Under each heading a comment holds the section's contract (required, table columns, seed, checks,
  guidance): keep every heading and column as given, in the template the manifest names for the document (templateFile).
- The skeleton of each document the scaffold wrote, at its final path ${unitKeyDesignSetDir(APP_TOKEN, "{key}", "<set>")}/<file>, with the
  front matter that names the template, the unit's rules seeded where a section lists them, and a TODO in each section to write. The manifest
  ${MANIFEST} lists, for your unit {key}, the documents of the set (path, template, templateFile, the reference ref its front matter names,
  whether required) and, where the project has one, a finished example of the document: match its shape and depth, never copy its content.
- What the unit is: ${unitKeyAsIsPath(APP_TOKEN, "{key}")} (the AS-IS specification), rules.md and the rule files under rules/, rules-review.md,
  topology.md, trace.md and findings.md in the same folder, and the unit's card ${unitKeyStatePath(APP_TOKEN, "{key}")}.
- The common design: ${COMMON}, and the catalog ${assessmentCatalogPath(APP_TOKEN)}.
- The documents of the sets this one needs (the set.md names them), for the unit: ${unitKeyDesignSetDir(APP_TOKEN, "{key}", "<needed set>")}/.`;

const RULES = `Identifiers are facts: cite a business rule by its id from rules.md, a common component by its COM-... id, a design item of an earlier set by the id
in that set's documents; never invent or reuse one. Every rule of the unit appears where the template says rules are covered. Design from the
specification, not from the legacy structure; read the legacy code only to establish behavior you cite as path:line. What the code or the
understanding does not tell, every blocking or risk gap of the specification's "Gaps and questions" table (GAP-... ids) and every rule marked
clarify in rules-review.md, becomes a written question in the document with the assumption you made, never a silent decision. A
detail design is precise enough to build from: names, types, conditions, messages and error codes are written. Diagrams are Mermaid, per the
mermaid-diagrams skill. Write only the documents of this set for this unit: no other file.`;

/** What a design of the whole application reads (ADR-0050): the application is one pseudo-unit, so there is no unit folder. */
const APPLICATION_READING = `Under {in} (read-only), at their document-repository paths:
- The project's definition of the set: ${designSetsDir()}/<set>/set.md and the template of each document next to it. Under each heading a
  comment holds the section's contract (required, table columns, checks, guidance): keep every heading and column as given. The section
  "Instructions" of set.md is addressed to you: follow it. Where the manifest names an example of a document, match its shape and depth,
  never copy its content.
- The skeleton of each document the scaffold wrote, at its final path ${applicationDesignSetDir(APP_TOKEN, "<set>")}/<file>, with the
  front matter that names the template and a TODO in each section to write. The manifest ${MANIFEST} lists, for {key}, the documents of the set
  (path, template, whether required) and the extra documents the set asks you to read.
- What the application is: the assessment at the top of ${assessmentDir(APP_TOKEN)}/ (assessment.md, inventory.md, topology.md, the catalog
  _catalog/), the views rebuilt from the understood units under ${generatedDir(APP_TOKEN)}/ (business rules, traceability) when they exist, and
  the units' own understanding in ${legacyDir(APP_TOKEN)}/<module>/<unit>/ as far as you need it.
- The common design: ${COMMON}.
- The documents of the sets this one needs: ${applicationDesignSetDir(APP_TOKEN, "<needed set>")}/.`;

const APPLICATION_RULES = `Identifiers are facts: cite a requirement by its REQ-... id, a common component by its COM-... id, a design item of a set you need by the
id in that set's documents; never invent or reuse one. Describe the target from the specification, not from the legacy structure; read the
legacy code only to establish behavior you cite as path:line. What the code or the documents do not tell becomes a written question in the
document, never a guess. Diagrams are Mermaid, per the mermaid-diagrams skill. Write only the documents of this set for the application: no
other file.`;

/** A regeneration starts with the new template and preserves reviewed decisions in their original sections (ADR-0082). */
const REGENERATING = `This is a regeneration. The manifest lists each existing document's previous field: its read-only snapshot under {in},
kept in job scratch before the new skeleton overlaid its final path. Read that previous snapshot, not the skeleton, for the prior version.
The new skeleton and template are the structure to write now. Read the previous design for reviewed answers, decisions and corrections. Preserve those that remain consistent
with the current specification and evidence, in the same section or its corresponding section of the new template, citing their evidence.
Do not silently erase an answer or turn it back into a question. If current evidence contradicts a previous answer, state the conflict and what
must be reviewed in the affected section. A previous draft or an unsupported assumption is not confirmed evidence. Reapply the current template
contract and write each complete document; never create a separate answers file.`;

const generateTask = (set: string, scope: "unit" | "application", regenerate = false): string =>
  scope === "application"
    ? `Write the design documents of the set "${set}" for application {app} as a whole.

${WORKSPACE}

${APPLICATION_READING.replaceAll("<set>", set)}
${regenerate ? `
${REGENERATING}
` : ""}

Write every document the manifest lists for {key} (the required ones, and an optional one only when the application needs it) with write, at the
full path of its skeleton, replacing every TODO and keeping the front matter. ${APPLICATION_RULES}

${CREDENTIALS}
${UNTRUSTED}`
    : `Write the design documents of the set "${set}" for unit {key} of application {app}.

${WORKSPACE}

${READING.replaceAll("<set>", set)}
${regenerate ? `
${REGENERATING}
` : ""}

Write every document the manifest lists for {key} (the required ones, and an optional one only when the unit needs it) with write, at the
full path of its skeleton, replacing every TODO and keeping the front matter. ${RULES}

${CREDENTIALS}
${UNTRUSTED}`;

const reviewTask = (set: string, scope: "unit" | "application"): string => {
  const subject = scope === "application" ? `application {app}` : `unit {key} of application {app}`;
  return `Review the design documents of the set "${set}" of ${subject}. You did not write them: judge them against what the old system does and against the project's template.

${WORKSPACE}

${(scope === "application" ? APPLICATION_READING : READING).replaceAll("<set>", set)}

The documents under review are at the final paths above (the designer has replaced the skeletons). The check report is {in}/${REPORT}: it lists what the scripts
already found, so do not repeat it. Report what a script cannot: behavior of the specification the design drops, a rule named but not designed, ids and
names that disagree, anything a builder would have to guess. Write your review note with write at ${designReviewPath(APP_TOKEN, scope === "application" ? "@app" : "{key}")}, in the form your instructions give; write no other file.

${CREDENTIALS}
${UNTRUSTED}`;
};

const fixTask = (set: string, scope: "unit" | "application"): string => {
  const subject = scope === "application" ? `application {app}` : `unit {key} of application {app}`;
  return `Fix the design documents of the set "${set}" of ${subject}: a check of the documents against the project's template found problems, or an independent reviewer found blockers or majors.

${WORKSPACE}

${(scope === "application" ? APPLICATION_READING : READING).replaceAll("<set>", set)}

The documents you wrote are under {in} at their final paths. The check report is {in}/${REPORT}: find the entry of {app}/{key}; per file it lists the state
and the problems (section and message, never content). The reviewer's findings are in {in}/${REVIEW_REPORT}: find the entry of {app}/{key}; each finding names a
document, a section, what is wrong and a suggestion. Fix the check problems and the findings of severity blocker and major, and leave the minors to the person.
Change only what they name, in the documents they name, and write each of those documents again in full with write, at the same path (a file that is missing
is written from its skeleton). ${scope === "application" ? APPLICATION_RULES : RULES}

${CREDENTIALS}
${UNTRUSTED}`;
};

/** The design set of a run (inputs.scope.set), checked. */
function setOf(ctx: StageContext): string {
  const set = ctx.scope?.set;
  if (set === undefined || !SET_ID.test(set)) throw new Error("the design stage needs the design set to generate (inputs.scope.set)");
  return set;
}

/** The selected unit keys, comma-separated. */
function unitsOf(ctx: StageContext): string[] {
  const items = ctx.scope?.items ?? [];
  if (items.length === 0) throw new Error("the design stage needs a selection of units (inputs.scope.items)");
  return [...items];
}

interface Manifest {
  units?: Record<string, { error?: unknown; scope?: unknown; reads?: unknown; files?: Array<{ written?: unknown }> }>;
}

/** The scope of the set the run generates and the extra documents its `set.md` asks the designer to read, from the scaffold's manifest. */
async function setFacts(ctx: StageContext): Promise<{ scope: "unit" | "application"; reads: string[] }> {
  const manifest = (await ctx.readJson(designManifestPath(ctx.app))) as Manifest | undefined;
  const entry = Object.values(manifest?.units ?? {}).find((unit) => unit.error === undefined);
  const reads = Array.isArray(entry?.reads) ? entry.reads.filter((path): path is string => typeof path === "string") : [];
  return { scope: entry?.scope === "application" ? "application" : "unit", reads };
}

/** The units the scaffold wrote at least one document for (a unit that has the set already, or could not be scaffolded, has none). */
async function scaffolded(ctx: StageContext): Promise<string[]> {
  const manifest = (await ctx.readJson(designManifestPath(ctx.app))) as Manifest | undefined;
  return Object.entries(manifest?.units ?? {})
    .filter(([, unit]) => unit.error === undefined && (unit.files ?? []).some((file) => file.written === true))
    .map(([key]) => key);
}

interface Report {
  units?: Array<{ unit?: unknown; ok?: unknown; error?: unknown }>;
}

/** The units whose documents the check found faults in: those the fix round works on. */
async function flagged(ctx: StageContext): Promise<string[]> {
  const report = (await ctx.readJson(designReportPath(ctx.app))) as Report | undefined;
  const prefix = `${ctx.app}/`;
  return (report?.units ?? [])
    .filter((entry) => entry.ok === false && entry.error === undefined && typeof entry.unit === "string" && entry.unit.startsWith(prefix))
    .map((entry) => (entry.unit as string).slice(prefix.length));
}

interface ReviewReport {
  units?: Array<{ unit?: unknown; reviewed?: unknown; blockers?: unknown; majors?: unknown }>;
}

/** The units the reviewer found a blocker or a major in: the fix round works on them too. */
async function reviewFlagged(ctx: StageContext): Promise<string[]> {
  const report = (await ctx.readJson(designReviewReportPath(ctx.app))) as ReviewReport | undefined;
  const prefix = `${ctx.app}/`;
  return (report?.units ?? [])
    .filter((entry) => entry.reviewed === true && typeof entry.unit === "string" && entry.unit.startsWith(prefix) && (Number(entry.blockers) > 0 || Number(entry.majors) > 0))
    .map((entry) => (entry.unit as string).slice(prefix.length));
}

/** The units the fix round works on: the check found faults, or the review found a blocker or a major. */
async function toFix(ctx: StageContext): Promise<string[]> {
  return [...new Set([...(await flagged(ctx)), ...(await reviewFlagged(ctx))])];
}

const checkArgs = (ctx: StageContext): string[] => ["{app}", unitsOf(ctx).join(","), "--set", setOf(ctx), "--root", "{in}", "--tolerate", "--report", `{out}/${REPORT}`];

/** The pull-request title: the set and the units (the module when one module's units are selected). */
export function designMessage(app: string, scope?: StageScope): string {
  const items = scope?.items ?? [];
  const set = scope?.set ?? "design";
  const verb = scope?.draft === true ? (scope.regenerate === true ? "Regenerate draft design" : "Draft design") : scope?.regenerate === true ? "Regenerate design" : "Design";
  if (items.length === 1 && items[0] === "@app") return `${verb} ${app}: ${set} of the application`;
  const modules = [...new Set(items.map((id) => id.split("/")[0]))];
  if (items.length > 0 && modules.length === 1) return `${verb} ${app}: ${set} of ${modules[0]} (${items.length} unit${items.length === 1 ? "" : "s"})`;
  const names = items.map((id) => id.split("/")[1] ?? id);
  return `${verb} ${app}: ${set} of ${names.slice(0, 2).join(", ")}${names.length > 2 ? ` +${names.length - 2}` : ""}`;
}

export const DESIGN: StagePlan = {
  id: "design",
  message: designMessage,
  description: (app) => designSummaryPath(app),
  documents: [
    "kintsugi.yaml",
    `${standardsDir()}/`,
    `${architectureDir()}/`,
    `${transitionDir()}/`,
    `${legacyDir(APP_TOKEN)}/`,
    `${modernDir(APP_TOKEN)}/`,
    `${generatedDir(APP_TOKEN)}/`,
  ],
  requires: [{ path: assessmentCatalogPath(APP_TOKEN), stage: "assess" }],
  reviewAll: true,
  validateOutputs: (app, scope, paths) => {
    if (scope?.set === undefined || scope.items.length === 0) throw new Error("Design output needs a set and selected units");
    const prefixes = scope.items.map((key) => `${key === "@app" ? applicationDesignSetDir(app, scope.set!) : unitKeyDesignSetDir(app, key, scope.set!)}/`);
    const outside = paths.filter((path) => !path.endsWith(".md") || !prefixes.some((prefix) => path.startsWith(prefix)));
    if (outside.length > 0) throw new Error(`Design output is outside the selected set: ${outside.slice(0, 10).join(", ")}; review the violation and restart with a fresh attempt`);
  },
  steps: [
    {
      id: "scaffold",
      kind: "script",
      script: "scaffold_design.py",
      args: (ctx) => ["{app}", unitsOf(ctx).join(","), setOf(ctx), "--require-ready", ...(ctx.scope?.draft === true ? ["--draft"] : []), ...(ctx.scope?.regenerate === true ? ["--regenerate"] : []), "--root", "{in}", "--out", "{out}", "--manifest", `{out}/${MANIFEST}`],
      intermediate: true,
      expects: [MANIFEST],
    },
    {
      id: "documents",
      kind: "forEach",
      concurrency: 4,
      tolerateFailures: true,
      items: async (ctx) => {
        const keys = await scaffolded(ctx);
        if (keys.length === 0) throw new Error("nothing to generate: every selected unit already has this set, or could not be prepared (see the scaffold step)");
        if (ctx.agentsLeft() < keys.length * 2) throw new Error(`The design needs at least ${keys.length * 2} agent jobs for generation and independent review; select fewer units or raise the stage budget before running it.`);
        return keys.map((key) => ({ key, item: key }));
      },
      step: {
        id: "design-unit",
        kind: "agent",
        agent: DESIGNER,
        task: async (ctx) => `${ctx.scope?.draft === true ? "This is an explicitly requested DRAFT. State missing evidence, unresolved gaps and assumptions by ID; never present them as confirmed facts.\n" : ""}${generateTask(setOf(ctx), (await setFacts(ctx)).scope, ctx.scope?.regenerate === true)}`,
        documents: async (ctx) => (await setFacts(ctx)).reads,
      },
    },
    {
      id: "check",
      kind: "script",
      script: "check_design.py",
      args: checkArgs,
      intermediate: true,
      expects: [REPORT],
    },
    {
      id: "review",
      kind: "forEach",
      concurrency: 4,
      tolerateFailures: true,
      items: async (ctx) => (await scaffolded(ctx)).map((key) => ({ key, item: key })),
      step: {
        id: "review-unit",
        kind: "agent",
        agent: REVIEWER,
        task: async (ctx) => reviewTask(setOf(ctx), (await setFacts(ctx)).scope),
        documents: async (ctx) => (await setFacts(ctx)).reads,
        intermediate: true,
      },
    },
    {
      id: "check-review",
      kind: "script",
      script: "check_review.py",
      args: (ctx) => ["{app}", unitsOf(ctx).join(","), "--root", "{in}", "--report", `{out}/${REVIEW_REPORT}`],
      intermediate: true,
      expects: [REVIEW_REPORT],
    },
    {
      id: "fixes",
      kind: "forEach",
      concurrency: 4,
      tolerateFailures: true,
      when: async (ctx) => (await toFix(ctx)).length > 0,
      items: async (ctx) => (await toFix(ctx)).map((key) => ({ key, item: key })),
      step: {
        id: "fix-unit",
        kind: "agent",
        agent: DESIGNER,
        task: async (ctx) => fixTask(setOf(ctx), (await setFacts(ctx)).scope),
        documents: async (ctx) => (await setFacts(ctx)).reads,
      },
    },
    {
      id: "check-final",
      kind: "script",
      script: "check_design.py",
      args: checkArgs,
      intermediate: true,
      expects: [REPORT],
    },
    {
      id: "mark-draft",
      kind: "script",
      when: (ctx) => ctx.scope?.draft === true,
      script: "mark_design_draft.py",
      args: (ctx) => ["--app", "{app}", "--set", setOf(ctx), "--units", unitsOf(ctx).join(","), "--root", "{in}", "--out", "{out}", "--manifest", `{in}/${MANIFEST}`],
    },
    {
      id: "summary",
      kind: "script",
      script: "render_design_review.py",
      args: (ctx) => ["{app}", unitsOf(ctx).join(","), "--set", setOf(ctx), "--root", "{in}", "--out", `{out}/${SUMMARY}`],
      intermediate: true,
      expects: [SUMMARY],
    },
  ],
};
