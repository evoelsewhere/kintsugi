// The `understand` stage (commands/modernize-understand.md, ADR-0033): runs on a selection of
// catalog items (inputs.scope, resolved by the API through assessmentCatalogPath). One run is
// one pull request that touches only the paths of its own items, so concurrent runs never conflict:
//
//   scope_items.py      per item: topology fragment (published), brief and rule shard (intermediate)
//   parallel            extract-rules workflow over the items' shards ∥ harden-scan over their files
//   split_rules.py      per item rules.json, ids RULE-<module>.<item>-NN
//   split_findings.py   per item findings.json, ids SEC-<module>.<item>-NN
//   forEach item        a legacy-analyst job writes the AS-IS specification and returns its trace
//   finish_items.py     per item: checked trace.json, meta.json (understood) and the work item
//
// Whole-application views (topology, rules, findings, traceability) are not written here: the
// aggregate rebuild regenerates them under generated/ after a merge. The application overview
// documents are an on-demand run of their own.
//
// Not wired yet: per-node descriptions and persona flows of the scoped map (the fragments are
// the skeleton topology), and the security triage and patch review of the former harden stage.

import type { StageContext, StagePlan, StageScope } from "../plan.js";
import {
  DOCUMENT_PATH_TOKENS,
  assessmentBriefPath,
  assessmentCatalogPath,
  assessmentFilePath,
  assessmentInventoryPath,
  assessmentItemFilePath,
  assessmentTopologyPath,
  knowledgeAsIsItemFilePath,
  knowledgeAsIsUnitPath,
  unitsDir,
  understandRunDir,
  understandRunFilePath,
  understandScopePath,
} from "@kintsugi/domain";
import { CREDENTIALS, HEADER, UNTRUSTED, WORKSPACE } from "./common.js";

const APP_TOKEN = DOCUMENT_PATH_TOKENS.app;
/** Intermediate files of the run: briefs, shards, the workflows' results. */
const RUN = understandRunDir(APP_TOKEN);
const SCOPE = understandScopePath(APP_TOKEN);

const TRACE_SCHEMA = {
  type: "object",
  required: ["entryPoints", "rulesApplied", "findings", "dependencies", "dataObjects", "externalSystems", "files", "openQuestions"],
  properties: {
    entryPoints: { type: "array", items: { type: "string", description: "An entry point of the item as file:line (route, transaction, main, job step)" } },
    rulesApplied: { type: "array", items: { type: "string", description: "A RULE-<module>.<item>-NN id of the item's rules.json the code applies" } },
    findings: { type: "array", items: { type: "string", description: "A SEC-<module>.<item>-NN id of the item's findings.json" } },
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
    openQuestions: { type: "integer", description: "How many open questions the specification lists" },
  },
};

const SPEC_TASK = `Write the AS-IS specification of one catalog item of application {app}.

${WORKSPACE}

Your brief is {in}/{item} (read-only): the item's id, name, kind and summary from the catalog, its source files, its
size, its topology leaves and entry points, the items it depends on and that use it, the data stores it reads and
writes. Also under {in}: the item's topology fragment ${assessmentItemFilePath(APP_TOKEN, "{key}", "topology.json")}, its business rules
${assessmentItemFilePath(APP_TOKEN, "{key}", "rules.json")} (ids RULE-<module>.<item>-NN, each citation checked by a second agent), its security
findings ${assessmentItemFilePath(APP_TOKEN, "{key}", "findings.json")} (ids SEC-<module>.<item>-NN), ${assessmentCatalogPath(APP_TOKEN)} (every item of the
application) and ${assessmentFilePath(APP_TOKEN, "ASSESSMENT.md")}. Read the item's source files and follow its calls only as far as needed to
describe it; the other items have their own specifications.

Write ${knowledgeAsIsUnitPath(APP_TOKEN, "{key}")} with write, with exactly these sections, in this order:
1. Purpose — what the item does for the business, in two to four sentences.
2. Entry points — how the item is started (routes, transactions, screens, job steps, main programs), file:line each.
3. Main flows — the main processing paths, step by step; add a Mermaid sequenceDiagram per main flow (autonumber;
   alt/opt/loop for branches) in a fenced mermaid block when the flow has more than three participants or branches,
   per the mermaid-diagrams skill.
4. Dependencies — inbound and outbound (catalog items, data stores, external systems), as a table: direction, target,
   kind (call, read, write, integration), evidence file:line.
5. Data objects — the records, tables, DTOs or copybooks it reads or writes, with the fields that matter.
6. Business rules applied — each as a RULE id of the item's rules.json with a one-line summary and file:line; a rule
   you see in the code that the file lacks is listed as "uncatalogued" with file:line, never given an id.
7. Security findings and risks — each SEC id of the item's findings.json, and other risks you saw (marked as
   observations, without an id).
8. Configuration — the settings, properties, environment variables and tables that change its behavior (names and
   file:line only; never a value that could be a credential).
9. Error handling — how failures are detected, reported, retried or swallowed.
10. Source references — every file:line the specification relies on.
11. Open questions — what the code does not tell, for a subject-matter expert.
Mark anything inferred rather than read from code as "(inferred)".

Return the traceability fragment as your structured result: the entry points, the RULE and SEC ids you listed, the
dependencies (targets as catalog item ids, data store ids or external system names), data objects, external systems,
the files you cite and the number of open questions.

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
  documents: ["kintsugi.yaml", assessmentCatalogPath(APP_TOKEN), assessmentInventoryPath(APP_TOKEN), assessmentTopologyPath(APP_TOKEN), assessmentFilePath(APP_TOKEN, "ASSESSMENT.md"), `${unitsDir(APP_TOKEN)}/`],
  requires: [{ path: assessmentCatalogPath(APP_TOKEN), stage: "assess" }],
  reviewAll: true,
  steps: [
    {
      id: "scope",
      kind: "script",
      script: "scope_items.py",
      args: (ctx) => ["{app}", "--catalog", `{in}/${assessmentCatalogPath(APP_TOKEN)}`, "--topology", `{in}/${assessmentTopologyPath(APP_TOKEN)}`, "--items", itemsArg(ctx), "--out", "{out}"],
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
      args: (ctx) => ["{app}", "--rules", "{in}/" + understandRunFilePath(APP_TOKEN, "rules_result.json"), "--catalog", "{in}/" + assessmentCatalogPath(APP_TOKEN), "--items", itemsArg(ctx), "--out", "{out}"],
    },
    {
      id: "split-findings",
      kind: "script",
      script: "split_findings.py",
      args: (ctx) => ["{app}", "--scan", "{in}/" + understandRunFilePath(APP_TOKEN, "scan.json"), "--catalog", "{in}/" + assessmentCatalogPath(APP_TOKEN), "--items", itemsArg(ctx), "--out", "{out}"],
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
        resultTo: knowledgeAsIsItemFilePath(APP_TOKEN, "{key}", "trace.json"),
        intermediate: [knowledgeAsIsItemFilePath(APP_TOKEN, "{key}", "trace.json")],
        expects: [knowledgeAsIsUnitPath(APP_TOKEN, "{key}")],
      },
    },
    {
      id: "finish",
      kind: "script",
      script: "finish_items.py",
      args: (ctx) => [
        "{app}",
        "--catalog",
        `{in}/${assessmentCatalogPath(APP_TOKEN)}`,
        "--items",
        itemsArg(ctx),
        "--inputs",
        "{in}",
        "--commit",
        "{commit}",
        "--run",
        "{run}",
        "--repo",
        "{repo}",
        "--existing",
        "{in}/" + unitsDir(APP_TOKEN),
        "--out",
        "{out}",
      ],
    },
  ],
};
