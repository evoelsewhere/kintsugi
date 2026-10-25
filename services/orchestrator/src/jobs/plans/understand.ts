// The `understand` stage (commands/modernize-understand.md, ADR-0033, ADR-0042): runs on a selection of
// catalog items (inputs.scope, resolved by the API through assessmentCatalogPath). One run is
// one pull request that touches only the paths of its own items, so concurrent runs never conflict. The
// documents of an item are Markdown in its folder on the legacy side (01-legacy/<module>/<item>/), its card on the modern side; what the steps pass to each other is scratch
// JSON (intermediate):
//
//   scope_items.py      per item: topology.md (published), brief and rule shard (scratch)
//   parallel            extract-rules workflow over the items' shards ∥ harden-scan over their files
//   split_rules.py      per unit rules.md (the index) and a rules/<id>.md file per rule, stable compact ids RULE-<scope>-0001
//   split_findings.py   per item findings.md, ids SEC-<scope>-0001
//   forEach item        a legacy-analyst job writes the AS-IS specification and returns its trace (scratch)
//   finish_items.py     per item: checked trace.md, understanding.md (understood) and the work item
//
// Whole-application views (topology, rules, findings, traceability) are not written here: the
// aggregate rebuild regenerates them under _generated/ after a merge. The application overview
// documents are an on-demand run of their own.
//
// Not wired yet: per-node descriptions and persona flows of the scoped map (the fragments are
// the skeleton topology), and the security triage and patch review of the former harden stage.

import type { StageContext, StagePlan, StageScope } from "../plan.js";
import {
  DOCUMENT_PATH_TOKENS,
  assessmentBriefPath,
  assessmentCatalogDir,
  assessmentCatalogPath,
  assessmentSynthesisPath,
  assessmentTopologyPath,
  legacyDir,
  modernDir,
  specificationProfilesDir,
  understandRunDir,
  understandRunFilePath,
  understandScopePath,
  understandTraceDraftPath,
  unitKeyAsIsPath,
  unitKeyLegacyPath,
} from "@kintsugi/domain";
import { CREDENTIALS, HEADER, UNTRUSTED, WORKSPACE } from "./common.js";

const APP_TOKEN = DOCUMENT_PATH_TOKENS.app;
/** Scratch files of the run: briefs, shards, the specification jobs' traces, the workflows' results. */
const RUN = understandRunDir(APP_TOKEN);
const SCOPE = understandScopePath(APP_TOKEN);

const TRACE_SCHEMA = {
  type: "object",
  required: ["entryPoints", "rulesApplied", "findings", "dependencies", "dataObjects", "externalSystems", "files", "openQuestions"],
  properties: {
    entryPoints: { type: "array", items: { type: "string", description: "An entry point of the item as file:line (route, transaction, main, job step)" } },
    rulesApplied: { type: "array", items: { type: "string", description: "A stable RULE-<scope>-0001 id of the unit's rules.md the code applies" } },
    findings: { type: "array", items: { type: "string", description: "A SEC-<scope>-0001 id of the item's findings.md" } },
    dependencies: {
      type: "array",
      items: {
        type: "object",
        required: ["target", "kind", "direction"],
        properties: {
          target: { type: "string", description: "A catalog item id (<module>/<item>) from the brief, a data store id (ds:...), or an external system's name" },
          kind: { type: "string", enum: ["call", "read", "write", "integration"] },
          direction: { type: "string", enum: ["outbound", "inbound"] },
        },
      },
    },
    dataObjects: { type: "array", items: { type: "string", description: "A data object (record, table, DTO, copybook) the item reads or writes" } },
    externalSystems: { type: "array", items: { type: "string", description: "An external system the item talks to (logical name, never a URL with credentials)" } },
    files: { type: "array", items: { type: "string", description: "A repository-relative source file the specification cites" } },
    openQuestions: { type: "integer", description: "How many gaps (rows of the Gaps and questions table) the specification lists" },
  },
};

const SPEC_TASK = `Write the AS-IS specification of one catalog item of application {app}.

${WORKSPACE}

Your brief is {in}/{item} (read-only): the item's id, name, kind and summary from the catalog, its source files, its
size, its topology leaves and entry points, the items it depends on and that use it, the data stores it reads and
writes. Also under {in}: the item's topology ${unitKeyLegacyPath(APP_TOKEN, "{key}", "topology.md")}, its business rules
${unitKeyLegacyPath(APP_TOKEN, "{key}", "rules.md")} (the index of its rules, ids RULE-<scope>-0001, allocated from the unit ledger and stable across reruns, each citation checked by a second agent; one file per rule in ${unitKeyLegacyPath(APP_TOKEN, "{key}", "rules")}/), its security
findings ${unitKeyLegacyPath(APP_TOKEN, "{key}", "findings.md")} (ids SEC-<scope>-0001), ${assessmentCatalogPath(APP_TOKEN)} and the module documents next to it (every item of the
application) and ${assessmentSynthesisPath(APP_TOKEN)}. Read the item's source files and follow its calls only as far as needed to
describe it; the other items have their own specifications.

Write ${unitKeyAsIsPath(APP_TOKEN, "{key}")} with write, with exactly these sections, in this order (a kind profile in the brief adds sections, see below):
1. Purpose — what the item does for the business, in two to four sentences.
2. Entry points — how the item is started (routes, transactions, screens, job steps, main programs), file:line each.
3. Main flows — the main processing paths, step by step; add a Mermaid sequenceDiagram per main flow (autonumber;
   alt/opt/loop for branches) in a fenced mermaid block when the flow has more than three participants or branches,
   per the mermaid-diagrams skill.
4. Dependencies — inbound and outbound (catalog items, data stores, external systems), as a table: direction, target,
   kind (call, read, write, integration), evidence file:line.
5. Data objects — the records, tables, DTOs or copybooks it reads or writes, with the fields that matter.
6. Business rules applied — each as a RULE id of the item's rules.md with a one-line summary and file:line; a rule
   you see in the code that the file lacks is listed as "uncatalogued" with file:line, never given an id.
7. Security findings and risks — each SEC id of the item's findings.md, and other risks you saw (marked as
   observations, without an id).
8. Configuration — the settings, properties, environment variables and tables that change its behavior (names and
   file:line only; never a value that could be a credential).
9. Error handling — how failures are detected, reported, retried or swallowed.
10. Source references — every file:line the specification relies on.
11. Gaps and questions — what the code does not tell, for a subject-matter expert: a table with the columns ID, Kind,
   Question, Where and Impact, one row per gap, as the evidence-marks skill says (draft ids GAP-<referenceCode>-0001,
   using referenceCode from the brief; finish assigns the persistent numbers and rewrites inline references; kinds
   missing-source, unresolved, ambiguous, unverified; impact blocking, risk or note). The source is often incomplete:
   a copybook, a called program, a job descriptor or a table definition the code names may not be in the
   repositories, so search for it, then record it as a gap instead of guessing. A rule of the item below High
   confidence is a row too (kind ambiguous, Where = its RULE id). Write "None." when there is no gap.
The brief's "profile" (null when the kind has none) is the specification profile of the item's kind: its "sections" are
sections you add, each as a "## <name>" heading with exactly that name, in the order given, between 3 (Main flows) and
4 (Dependencies); "holds" says what the section contains and "evidence" where to look for it; "instructions" says how to
write them. A section with nothing to say reads "None." with the reason. They come on top of the eleven above, never
instead of one, and the item's other sections keep their place.
Mark anything inferred rather than read from code as "(inferred)", and a statement the code cannot settle as
"(gap: GAP-…)" with its row in section 11.

Return the traceability fragment as your structured result: the entry points, the RULE and SEC ids you listed, the
dependencies (targets as catalog item ids, data store ids or external system names), data objects, external systems,
the files you cite and the number of rows of the gaps table.

${HEADER}
${CREDENTIALS}
${UNTRUSTED}`;

/** The selected item ids, comma-separated (scope_items.py checks them against the catalog). */
const itemsArg = (ctx: StageContext): string => {
  const items = ctx.scope?.items ?? [];
  if (items.length === 0) throw new Error("the understand stage needs a selection of catalog items (inputs.scope.items)");
  return items.join(",");
};

/** The items and files scope_items.py resolved from the catalog. */
async function resolvedScope(ctx: StageContext): Promise<{ items: string[]; files: string[] }> {
  const value = (await ctx.readJson(understandScopePath(ctx.app))) as { items?: unknown; files?: unknown } | undefined;
  const strings = (list: unknown): string[] => (Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === "string") : []);
  return { items: strings(value?.items), files: strings(value?.files) };
}

/** The pull-request title: the module when one module's items are selected, else the first item names. */
export function understandMessage(app: string, scope?: StageScope): string {
  const items = scope?.items ?? [];
  const modules = [...new Set(items.map((id) => id.split("/")[0]))];
  if (items.length > 0 && modules.length === 1) return `Understand ${app}: ${modules[0]} (${items.length} item${items.length === 1 ? "" : "s"})`;
  const names = items.map((id) => id.split("/")[1] ?? id);
  return `Understand ${app}: ${names.slice(0, 2).join(", ")}${names.length > 2 ? ` +${names.length - 2}` : ""}`;
}

export const UNDERSTAND: StagePlan = {
  id: "understand",
  message: understandMessage,
  // The legacy half (catalog, assessment, what earlier runs understood) and the unit cards of the modern half.
  documents: ["kintsugi.yaml", `${specificationProfilesDir()}/`, `${legacyDir(APP_TOKEN)}/`, `${modernDir(APP_TOKEN)}/`],
  requires: [{ path: assessmentCatalogPath(APP_TOKEN), stage: "assess" }],
  reviewAll: true,
  steps: [
    {
      id: "scope",
      kind: "script",
      script: "scope_items.py",
      args: (ctx) => ["{app}", "--catalog", `{in}/${assessmentCatalogDir(APP_TOKEN)}`, "--items", itemsArg(ctx), "--out", "{out}", "--standards", `{in}/${specificationProfilesDir()}`],
      intermediate: [`${RUN}/`],
      expects: [SCOPE],
    },
    {
      id: "analyse",
      kind: "parallel",
      steps: [
        {
          id: "rules",
          kind: "workflow",
          workflow: "extract-rules",
          args: async (ctx) => ({ app: ctx.app, modules: (await ctx.readJson(understandRunFilePath(ctx.app, "shards.json"))) ?? [] }),
          resultTo: understandRunFilePath(APP_TOKEN, "rules_result.json"),
          intermediate: true,
        },
        {
          id: "security",
          kind: "workflow",
          workflow: "harden-scan",
          args: async (ctx) => ({ app: ctx.app, files: (await resolvedScope(ctx)).files, ...((await ctx.readText(assessmentTopologyPath(ctx.app))) === undefined ? {} : { topology: assessmentTopologyPath(ctx.app) }) }),
          resultTo: understandRunFilePath(APP_TOKEN, "scan.json"),
          intermediate: true,
        },
      ],
    },
    {
      id: "split-rules",
      kind: "script",
      script: "split_rules.py",
      args: (ctx) => ["{app}", "--rules", "{in}/" + understandRunFilePath(APP_TOKEN, "rules_result.json"), "--catalog", "{in}/" + assessmentCatalogDir(APP_TOKEN), "--items", itemsArg(ctx), "--out", "{out}", "--docs", "{in}", "--sources", "{sources}"],
    },
    {
      id: "split-findings",
      kind: "script",
      script: "split_findings.py",
      args: (ctx) => ["{app}", "--scan", "{in}/" + understandRunFilePath(APP_TOKEN, "scan.json"), "--catalog", "{in}/" + assessmentCatalogDir(APP_TOKEN), "--items", itemsArg(ctx), "--out", "{out}", "--docs", "{in}"],
    },
    {
      id: "specifications",
      kind: "forEach",
      concurrency: 6,
      tolerateFailures: true,
      items: async (ctx) => (await resolvedScope(ctx)).items.map((key) => ({ key, item: assessmentBriefPath(ctx.app, key) })),
      step: {
        id: "specify-item",
        kind: "agent",
        agent: "legacy-analyst",
        task: SPEC_TASK,
        schema: TRACE_SCHEMA,
        resultTo: understandTraceDraftPath(APP_TOKEN, "{key}"),
        intermediate: [understandTraceDraftPath(APP_TOKEN, "{key}")],
        expects: [unitKeyAsIsPath(APP_TOKEN, "{key}")],
      },
    },
    {
      id: "finish",
      kind: "script",
      script: "finish_items.py",
      args: (ctx) => [
        "{app}",
        "--catalog",
        `{in}/${assessmentCatalogDir(APP_TOKEN)}`,
        "--items",
        itemsArg(ctx),
        "--inputs",
        "{in}",
        "--sources",
        "{sources}",
        "--run",
        "{run}",
        "--docs",
        "{in}",
        "--existing",
        "{in}/" + modernDir(APP_TOKEN),
        "--out",
        "{out}",
      ],
    },
  ],
};
