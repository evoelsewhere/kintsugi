// The `design` stage (commands/modernize-design.md, ADR-0049, ADR-0083): generates one design set (the project's own,
// ADR-0045) for a selection of understood units, or, for a set of scope `application` (ADR-0050), for the application
// itself (the one pseudo-unit `@app`). A run is one set × many units (inputs.scope: the unit keys and the set) and one
// pull request that touches only the `<set>/` folders of its units on the modern side (or `_design/<set>/` of the application).
// A script prepares, designers write, scripts check, independent reviewers judge, and the designers fix what they found,
// again and again until a round finds nothing (ADR-0083):
//
//   scaffold_design.py   per unit the skeleton of each document of the set from its template (scratch) and a manifest
//   map_design.py        the units in the order they are designed (a callee before its caller) and the clusters of units that share interfaces
//   repeat per wave      a designer job per unit of the wave writes every document of the set at its document-repository path
//   check_design.py      the template's checks for every unit; the report is scratch
//   repeat until clean   a design-reviewer job per unit to review, a contract-reviewer job per cluster, check_review.py (the findings,
//                        what is open, whether the loop is stalled), a designer job per unit with a blocker, a major or a failing
//                        check, check_design.py. A round reviews again only the units the last one fixed. The loop ends when a round
//                        finds nothing open, or when it stalls (two rounds without fewer open findings, or the same ones back), or when
//                        the stage's agent cap is reached; a unit that is still wrong is carried by the pull request, never a failure
//   check_coverage.py    which requirements no design of the set refers to (information)
//   render_design_review.py  the review of the run: the description of the pull request (scratch)
//
// The documents are the published output; the skeletons, the manifest, the map and the reports are intermediate. What a
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
  designContractPath,
  designLoopPath,
  designCoveragePath,
  designManifestPath,
  designMapPath,
  designProgressPath,
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
import { CREDENTIALS, STOP, UNTRUSTED, WORKSPACE } from "./common.js";

const APP_TOKEN = DOCUMENT_PATH_TOKENS.app;
const MANIFEST = designManifestPath(APP_TOKEN);
const REPORT = designReportPath(APP_TOKEN);
const REVIEW_REPORT = designReviewReportPath(APP_TOKEN);
const SUMMARY = designSummaryPath(APP_TOKEN);
const MAP = designMapPath(APP_TOKEN);
const PROGRESS = designProgressPath(APP_TOKEN);
const COVERAGE = designCoveragePath(APP_TOKEN);
const LOOP = designLoopPath(APP_TOKEN);
const REVIEW_DIR = `${REPORT.slice(0, REPORT.lastIndexOf("/"))}/review`;
const SET_ID = /^[a-z0-9][a-z0-9_-]{0,62}$/;
/** The designer agent of the `design` plugin. */
const DESIGNER = "designer";
/** The independent reviewer of the `design` plugin (ADR-0054). */
const REVIEWER = "design-reviewer";
/** The reviewer of what units owe each other: one job per cluster of units that share interfaces (ADR-0083). */
const CONTRACT_REVIEWER = "contract-reviewer";
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

/** What a unit's designer is told about the units it calls: they are designed first, and their designs are the interface to meet (ADR-0083). */
const NEIGHBOURS = `The units are designed in the order of what they call: the map ${MAP} lists, for your unit {key}, dependsOn (units of this run, designed in an
earlier wave: their documents are under {in} at their final paths), calls and usedBy. A unit outside the run that already has a design of the set is
merged and read-only at the same kind of path. Read the design of every unit yours calls and design each call to match the interface it offers: names,
types, lengths, results, error codes and messages. Where it offers nothing you need, write the open question and your assumption; never invent the other side.`;

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
${UNTRUSTED}

${STOP}`
    : `Write the design documents of the set "${set}" for unit {key} of application {app}.

${WORKSPACE}

${READING.replaceAll("<set>", set)}

${NEIGHBOURS}
${regenerate ? `
${REGENERATING}
` : ""}

Write every document the manifest lists for {key} (the required ones, and an optional one only when the unit needs it) with write, at the
full path of its skeleton, replacing every TODO and keeping the front matter. ${RULES}

${CREDENTIALS}
${UNTRUSTED}

${STOP}`;

const reviewTask = (set: string, scope: "unit" | "application"): string => {
  const subject = scope === "application" ? `application {app}` : `unit {key} of application {app}`;
  return `Review the design documents of the set "${set}" of ${subject}. You did not write them: judge them against what the old system does and against the project's template.

${WORKSPACE}

${(scope === "application" ? APPLICATION_READING : READING).replaceAll("<set>", set)}

The documents under review are at the final paths above (the designer has replaced the skeletons). The check report is {in}/${REPORT}: it lists what the scripts
already found, so do not repeat it. Report what a script cannot: behavior of the specification the design drops, a rule named but not designed, ids and
names that disagree, anything a builder would have to guess. ${scope === "application" ? "The set is for the application as a whole: add the architecture lens your instructions describe. " : ""}Write your review note with write at ${designReviewPath(APP_TOKEN, scope === "application" ? "@app" : "{key}")}, in the form your instructions give; write no other file.
If this is not the first round, the designer has fixed earlier findings: judge the documents as they stand, in full, and report a problem that is still there in the same words.

${CREDENTIALS}
${UNTRUSTED}

${STOP}`;
};

interface Cluster {
  id: string;
  units: string[];
  peers?: Array<{ unit: string; documents?: string[] }>;
}

/** The brief of the contract reviewer: the clusters of the run (its own is {key}) and the merged designs of the neighbours outside the run (ADR-0083). */
const contractTask = (set: string, clusters: readonly Cluster[]): string => {
  const describe = (cluster: Cluster): string => {
    const units = cluster.units.map((unit) => `  - ${unit}: ${unitKeyDesignSetDir(APP_TOKEN, unit, set)}/ (written by this run; a finding names a document of one of these)`).join("\n");
    const peers = (cluster.peers ?? []).map((peer) => `  - ${peer.unit}: ${unitKeyDesignSetDir(APP_TOKEN, peer.unit, set)}/ (already merged, read-only; ${(peer.documents ?? []).length} document(s))`).join("\n");
    return `Cluster ${cluster.id}:\n${units}${peers === "" ? "" : `\n  Peers outside this run, already designed:\n${peers}`}`;
  };
  return `Review the contracts between the designs of the set "${set}" in cluster {key} of application {app}: what these units owe each other. You did not write the designs, and the reviewers of each unit have already judged each one alone.

${WORKSPACE}

Your cluster is {key}. The clusters of this run are:
${clusters.map(describe).join("\n")}

Under {in} (read-only), at their document-repository paths: the designs above; what each unit does and calls today in ${legacyDir(APP_TOKEN)}/<module>/<unit>/ (spec.md, topology.md, trace.md, rules.md) and the catalog
${assessmentCatalogPath(APP_TOKEN)} with the links between the units; the common design ${COMMON}; the set's definition and templates ${designSetsDir()}/${set}/; the map ${MAP}, which lists the
clusters and the order of the units. The check report is {in}/${REPORT} and each unit's review note is under {in}/${REVIEW_DIR}/ (a note per unit): they hold what a single unit's review found, so do not repeat it.
Report where two designs disagree about the same interface, message, identifier or shared data, and what neither takes responsibility for. Write your contract note with write at ${designContractPath(APP_TOKEN, "{key}")},
in the form your instructions give; each finding names the full document-repository path of the document of a unit of your cluster that has to change. Write no other file.
If this is not the first round, designers have fixed earlier findings: judge the designs as they stand now, and report a problem that is still there in the same words.

${CREDENTIALS}
${UNTRUSTED}

${STOP}`;
};

const fixTask = (set: string, scope: "unit" | "application"): string => {
  const subject = scope === "application" ? `application {app}` : `unit {key} of application {app}`;
  return `Fix the design documents of the set "${set}" of ${subject}: a check of the documents against the project's template found problems, or an independent reviewer found blockers or majors (round {round} of the verify loop: the documents are reviewed again after your fix, and you may be asked again if a problem remains or a fix opens another; do not undo an earlier correction).

${WORKSPACE}

${(scope === "application" ? APPLICATION_READING : READING).replaceAll("<set>", set)}

The documents you wrote are under {in} at their final paths. The check report is {in}/${REPORT}: find the entry of {app}/{key}; per file it lists the state
and the problems (section and message, never content). The reviewer's findings are in {in}/${REVIEW_REPORT}: find the entry of {app}/{key}; each finding names a
document, a section, what is wrong and a suggestion; a finding of source "contract" comes from the reviewer who read your unit together with the units it calls or
uses, and means your document and theirs disagree: read the other unit's design under {in} and make yours meet it (the finding says which side states what). Fix the check
problems and the findings of severity blocker and major, and leave the minors to the person.
Change only what they name, in the documents they name, and write each of those documents again in full with write, at the same path (a file that is missing
is written from its skeleton). ${scope === "application" ? APPLICATION_RULES : RULES}

${CREDENTIALS}
${UNTRUSTED}

${STOP}`;
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

/** The last review round, as `check_review.py` reports it (ADR-0083). */
interface ReviewRound {
  stalled?: unknown;
  fix?: unknown;
  rereview?: unknown;
  unreviewedClusters?: unknown;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

async function lastRound(ctx: StageContext): Promise<ReviewRound | undefined> {
  return (await ctx.readJson(REVIEW_REPORT)) as ReviewRound | undefined;
}

interface MapFile {
  waves?: unknown;
  clusters?: unknown;
}

async function mapFile(ctx: StageContext): Promise<MapFile> {
  return ((await ctx.readJson(MAP)) as MapFile | undefined) ?? {};
}

/** The clusters of units that share interfaces, from the map. */
async function clustersOf(ctx: StageContext): Promise<Cluster[]> {
  const listed = (await mapFile(ctx)).clusters;
  if (!Array.isArray(listed)) return [];
  return listed.flatMap((entry): Cluster[] => {
    const cluster = entry as { id?: unknown; units?: unknown; peers?: unknown };
    if (typeof cluster.id !== "string") return [];
    const peers = (Array.isArray(cluster.peers) ? cluster.peers : []).flatMap((peer): NonNullable<Cluster["peers"]> => {
      const found = peer as { unit?: unknown; documents?: unknown };
      return typeof found.unit === "string" ? [{ unit: found.unit, documents: strings(found.documents) }] : [];
    });
    return [{ id: cluster.id, units: strings(cluster.units), peers }];
  });
}

/** The units to write, wave by wave: a unit comes after the units it calls. A unit the map does not place is written last. */
async function wavesOf(ctx: StageContext): Promise<string[][]> {
  const keys = await scaffolded(ctx);
  const known = new Set(keys);
  const waves = (await mapFile(ctx)).waves;
  const listed = (Array.isArray(waves) ? waves : []).map((wave) => strings(wave).filter((key) => known.has(key))).filter((wave) => wave.length > 0);
  const placed = new Set(listed.flat());
  const rest = keys.filter((key) => !placed.has(key));
  return rest.length > 0 ? [...listed, rest] : listed;
}

/** The units the first review round reads, or, later, the ones the last round fixed or could not read. */
async function toReview(ctx: StageContext): Promise<string[]> {
  const keys = await scaffolded(ctx);
  if (ctx.round <= 1) return keys;
  const again = new Set(strings((await lastRound(ctx))?.rereview));
  return keys.filter((key) => again.has(key));
}

/** The clusters to read again: one of their units was reviewed again, or their last note could not be read. */
async function toContract(ctx: StageContext): Promise<Cluster[]> {
  const clusters = await clustersOf(ctx);
  if (ctx.round <= 1) return clusters;
  const round = await lastRound(ctx);
  const touched = new Set(strings(round?.rereview));
  const unread = new Set(strings(round?.unreviewedClusters));
  return clusters.filter((cluster) => unread.has(cluster.id) || cluster.units.some((unit) => touched.has(unit)));
}

/** The units the fix round works on: a blocker, a major or a failing check, unless the loop is stalled (another fix would not be reviewed). */
async function toFix(ctx: StageContext): Promise<string[]> {
  const round = await lastRound(ctx);
  if (round === undefined || round.stalled === true) return [];
  const known = new Set(await scaffolded(ctx));
  return strings(round.fix).filter((key) => known.has(key));
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
  report: (app) => designLoopPath(app),
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
      id: "map",
      kind: "script",
      script: "map_design.py",
      args: (ctx) => ["{app}", unitsOf(ctx).join(","), "--set", setOf(ctx), "--root", "{in}", "--out", `{out}/${MAP}`],
      intermediate: true,
      expects: [MAP],
    },
    {
      // One round per wave: a unit is designed after the units it calls, so its designer can read their designs.
      id: "write",
      kind: "repeat",
      steps: [
        {
          id: "documents",
          kind: "forEach",
          concurrency: 4,
          tolerateFailures: true,
          items: async (ctx) => {
            const waves = await wavesOf(ctx);
            if (ctx.round <= 1) {
              const keys = waves.flat();
              if (keys.length === 0) throw new Error("nothing to generate: every selected unit already has this set, or could not be prepared (see the scaffold step)");
              // A writer and a reviewer per unit and a contract reviewer per cluster, at least; the verify loop spends what is left.
              const needed = keys.length * 2 + (await clustersOf(ctx)).length;
              if (ctx.agentsLeft() < needed) throw new Error(`The design needs at least ${needed} agent jobs for generation and independent review; select fewer units or raise the stage budget before running it.`);
            }
            return (waves[ctx.round - 1] ?? []).map((key) => ({ key, item: key }));
          },
          step: {
            id: "design-unit",
            kind: "agent",
            agent: DESIGNER,
            task: async (ctx) => `${ctx.scope?.draft === true ? "This is an explicitly requested DRAFT. State missing evidence, unresolved gaps and assumptions by ID; never present them as confirmed facts.\n" : ""}${generateTask(setOf(ctx), (await setFacts(ctx)).scope, ctx.scope?.regenerate === true)}`,
            documents: async (ctx) => (await setFacts(ctx)).reads,
          },
        },
      ],
      until: async (ctx) => ctx.round >= (await wavesOf(ctx)).length,
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
      // Until a round finds nothing open (ADR-0083). No round limit: the loop also ends when it stalls or the stage's agent cap is reached.
      // A round reviews again only the units the last one fixed, and the clusters they belong to.
      id: "verify",
      kind: "repeat",
      steps: [
        {
          id: "review",
          kind: "forEach",
          concurrency: 4,
          tolerateFailures: true,
          items: async (ctx) => (await toReview(ctx)).map((key) => ({ key, item: key })),
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
          id: "contract",
          kind: "forEach",
          concurrency: 4,
          tolerateFailures: true,
          items: async (ctx) => (await toContract(ctx)).map((cluster) => ({ key: cluster.id, item: cluster.id })),
          step: {
            id: "contract-unit",
            kind: "agent",
            agent: CONTRACT_REVIEWER,
            task: async (ctx) => contractTask(setOf(ctx), await clustersOf(ctx)),
            documents: async (ctx) => (await setFacts(ctx)).reads,
            intermediate: true,
          },
        },
        {
          id: "check-review",
          kind: "script",
          script: "check_review.py",
          args: async (ctx) => ["{app}", (await scaffolded(ctx)).join(","), "--root", "{in}", "--report", `{out}/${REVIEW_REPORT}`, "--design-report", REPORT, "--history-out", `{out}/${PROGRESS}`, ...(ctx.round > 1 ? ["--history", PROGRESS] : [])],
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
          id: "check-again",
          kind: "script",
          script: "check_design.py",
          args: checkArgs,
          intermediate: true,
          expects: [REPORT],
        },
      ],
      // Clean (nothing open in this round's review, so nothing was fixed after it) or stalled (another fix would not be reviewed).
      until: async (ctx) => {
        const round = (await lastRound(ctx)) as { open?: unknown; stalled?: unknown } | undefined;
        return round === undefined || round.open === 0 || round.stalled === true;
      },
    },
    {
      id: "mark-draft",
      kind: "script",
      when: (ctx) => ctx.scope?.draft === true,
      script: "mark_design_draft.py",
      args: (ctx) => ["--app", "{app}", "--set", setOf(ctx), "--units", unitsOf(ctx).join(","), "--root", "{in}", "--out", "{out}", "--manifest", `{in}/${MANIFEST}`],
    },
    {
      id: "coverage",
      kind: "script",
      script: "check_coverage.py",
      args: (ctx) => ["{app}", "--set", setOf(ctx), "--root", "{in}", "--report", `{out}/${COVERAGE}`],
      intermediate: true,
      expects: [COVERAGE],
    },
    {
      id: "summary",
      kind: "script",
      script: "render_design_review.py",
      args: (ctx) => ["{app}", unitsOf(ctx).join(","), "--set", setOf(ctx), "--root", "{in}", "--out", `{out}/${SUMMARY}`, "--loop", `{out}/${LOOP}`],
      intermediate: true,
      expects: [SUMMARY, LOOP],
    },
  ],
};
