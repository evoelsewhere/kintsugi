// The `assess` stage, single-application mode (commands/modernize-assess.md, ADR-0033): the
// inventory script step; three analysis jobs in parallel (legacy-analyst structure, legacy-analyst
// debt, security-auditor scan); the topology extraction (a legacy-analyst job writes
// tools/extract_topology.py, a script step runs it, with the repair loop); the item catalog
// (catalog_from_topology.py proposes it, a legacy-analyst curation job returns structured edits,
// apply_catalog_edits.py applies the valid ones, reconcile_catalog.py keeps the ids of the catalog on
// the default branch); then the legacy-analyst synthesis job that writes ASSESSMENT.md and
// ARCHITECTURE.mmd. The analysis notes and the catalog drafts are intermediate; the inventory, the
// extraction script, the skeleton topology, the catalog and the synthesis are committed.
// Portfolio mode (workflows/portfolio-assess.js) is not a portal stage yet.

import type { StagePlan } from "../plan.js";
import { CREDENTIALS, HEADER, RESTRICTED, UNTRUSTED, WORKSPACE } from "./common.js";
import { topologySteps } from "./topology.js";

const DIR = "assessment/{app}";
const ANALYSIS = `${DIR}/analysis`;
/** Intermediate catalog files: the proposal, the curation edits, the curated catalog. */
const DRAFT = `${DIR}/catalog-draft`;
/** The model-written topology extraction script, kept with the assessment (ADR-0033). */
const EXTRACT_SCRIPT = `${DIR}/tools/extract_topology.py`;

const INVENTORY_FIRST = `The inventory measured by the script step is at {in}/assessment/{app}/inventory.json: read it first. Its figures
(lines, files, complexity, index) are the figures of record; do not re-measure them.`;

const STRUCTURE_TASK = `Build the structural map of the legacy repository of {app}.

${WORKSPACE}

${INVENTORY_FIRST}

1. The 5–12 major functional domains (group optional subsystems under one umbrella), which files belong to each, and
   how they depend on each other (control flow and shared data). Cite repository-relative paths. Flag dangling
   references.
2. The technology fingerprint, with file evidence: languages, frameworks and runtime versions; build system and
   manifest locations; data stores (schemas, copybooks, DDL, ORM configuration); integration points (queues, APIs,
   batch interfaces, screen maps); test presence and a rough coverage signal.

Write ${ANALYSIS}/structure.md with outputs_write: a domain table (domain, files, responsibilities, depends on), the
technology fingerprint, and a Mermaid \`flowchart TB\` of the domains per the mermaid-diagrams skill (one \`subgraph\` per
domain, nodes classed by kind, at most 40 edges), in a fenced \`mermaid\` block. These notes are input for the synthesis
job, not a final document.

${HEADER}
${CREDENTIALS}
${UNTRUSTED}`;

const DEBT_TASK = `Identify the technical debt of the legacy repository of {app}.

${WORKSPACE}

${INVENTORY_FIRST}

Look for dead code, deprecated APIs, duplication, god objects, missing error handling and hardcoded configuration.
Write ${ANALYSIS}/debt.md with outputs_write: the top 10 items by remediation value, each with file:line, what it is
and why it matters. These notes are input for the synthesis job, not a final document.

${HEADER}
${CREDENTIALS}
${UNTRUSTED}`;

const SECURITY_TASK = `Scan the legacy repository of {app} for vulnerabilities.

${WORKSPACE}

Look for injection, authentication and session weaknesses, hardcoded secrets, vulnerable dependencies (read the
manifests and lock files; no audit tool runs here, say which ones would apply) and missing input validation.
Write ${ANALYSIS}/security.md with outputs_write: a table with CWE, severity, file:line, title and a one-sentence
exploit scenario. For each hardcoded credential add a row to a separate "Credentials" table: masked preview (2–4
characters), file:line, type, what it appears to grant, production or test guess. These notes are input for the
synthesis job, not a final document.

${HEADER}
${CREDENTIALS}
${UNTRUSTED}`;

const CATALOG_OPS = ["rename", "set-kind", "describe", "rename-module", "move-item", "merge", "split", "move-files", "unassign-files", "add-parts"];

const STRING = { type: "string" };
const STRINGS = { type: "array", items: STRING };

/** The structured result of the curation job: edits apply_catalog_edits.py checks one by one. */
export const CATALOG_EDITS_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["edits"],
  properties: {
    edits: {
      type: "array",
      // No edit keeps the proposal (also what the mock agent backend returns).
      default: [],
      items: {
        type: "object",
        required: ["op"],
        properties: {
          op: { type: "string", enum: CATALOG_OPS },
          item: STRING,
          items: STRINGS,
          module: STRING,
          moduleName: STRING,
          name: STRING,
          kind: STRING,
          summary: STRING,
          files: STRINGS,
          to: STRING,
          into: { type: "array", items: { type: "object", required: ["name", "files"], properties: { name: STRING, files: STRINGS } } },
          parts: { type: "array", items: { type: "object", required: ["name"], properties: { name: STRING, kind: STRING, file: STRING } } },
          reason: STRING,
        },
      },
    },
  },
};

const CURATE_TASK = `Curate the item catalog of application {app}.

${WORKSPACE}

The catalog lists what the application consists of, as items a person later selects for analysis: two levels, module
-> item; functions inside an item are its parts. {in}/${DRAFT}/proposed.json is the catalog a script derived from the
extracted topology ({in}/${DIR}/topology.json) without reading code: a module per domain, an item per topology leaf,
small leaves of one directory grouped. {in}/${DIR}/inventory.json lists every file, {in}/${ANALYSIS}/structure.md
holds the structure job's domains and {in}/kintsugi.yaml names the allowed item kinds (unitKinds). If present,
{in}/${DIR}/catalog.json is the previous catalog (on the default branch, reviewed by a person): where a proposed item
covers mostly the same files as a previous one, keep its name, kind and summary. Ids are kept by a later script; do not
try to keep them yourself.

Every file of the inventory must stay in exactly one item or in "unassigned", and no item may end up without files.
Improve the catalog where it helps a person choose what to analyse, and only there:
- give items and modules business names and one-sentence summaries (rename, rename-module, describe);
- fix kinds (set-kind, one of unitKinds): a screen, an API, a batch job, a report, a service;
- merge items that are one piece of behaviour (merge, into the first item), split an item that holds unrelated
  behaviour (split: the pieces together hold exactly the item's files), move an item to its module (move-item);
- place unassigned source files that belong to an item (move-files with "to"); leave documentation and build files
  unassigned;
- list the main functions or sections of large items as parts (add-parts, "file" as path:line of one of its files).
Cite only paths of the inventory. Prefer few, certain edits: an edit that breaks a rule above is rejected on its own.
Return the edits in order as your structured result; return {"edits": []} when the proposal is right as it is.

${CREDENTIALS}
${UNTRUSTED}`;

const SYNTHESIS_TASK = `Write the assessment of application {app}.

${WORKSPACE}

Your inputs, read-only:
- {in}/assessment/{app}/inventory.json — the figures of record from the inventory script (do not re-measure).
- {in}/${ANALYSIS}/structure.md, debt.md and security.md — the three analysis jobs' notes (domains and technology
  fingerprint, technical debt, vulnerabilities and masked credentials). Check what they cite before you repeat it.
- {in}/assessment/{app}/catalog.json — the item catalog (modules and their items, from the extracted topology); the
  domain table may follow its modules.
- {in}/assessment/{app}/INTENT.md, if present — what the team wants from the modernization; take it into account.
- {in}/assessment/{app}/telemetry/, if present — production exports a person attached (APM, batch logs).
- {in}/standards/, if present — the project's conventions.

Write assessment/{app}/ASSESSMENT.md with outputs_write, a fact-grounded brief a VP of Engineering could take into a
budget meeting, with these sections: Executive Summary (3–4 sentences: what it is, how big, how risky, the headline
recommendation) · System Inventory (from inventory.json, naming the method that measured it, and the legacy repository
and commit read) · Architecture at a Glance (the domain table; refer to ARCHITECTURE.mmd) · Production Runtime
Profile (p50/p95/p99 per key job or route, the highest-variance domain as the operational risk; or "no telemetry
available") · Technical Debt (top 10, file:line) · Security Findings (CWE table, file:line, severity) ·
Documentation Gaps (compare what the code does with what README, docs and comments say: the top 5 behaviors or
subsystems a new engineer would need explained) · Relative Scale (the complexity index and KSLOC, for ranking against
other applications only; state plainly that it is not a timeline or a cost, and print no person-months, schedule,
cost or date) · Recommended Modernization Pattern (one of Rehost, Replatform, Refactor, Rearchitect, Rebuild,
Replace, with a one-paragraph rationale and the stage it routes to: a newer version of the same technology →
uplift; a rewrite in another technology piece by piece → transform; a rebuild on a new architecture → reimagine;
Rehost and Replace change no code, so say so and what the analysis is still good for).

Also write assessment/{app}/ARCHITECTURE.mmd: the domain diagram from the structure notes, one Mermaid \`flowchart TB\`
per the mermaid-diagrams skill (a \`subgraph\` per domain, nodes classed ui, service, batch, store or external, sanitized
ids and quoted labels, within its size limits), without a Markdown fence.

Secrets first: the assessment is shared and committed, so masking applies to every section, whichever note a finding
came from. ${RESTRICTED} Security Findings then points to "Credential inventory in the restricted portal record (not
committed; not for sharing)".

${HEADER}
${UNTRUSTED}`;

export const ASSESS: StagePlan = {
  id: "assess",
  message: (app) => `Assess ${app}: inventory, item catalog and assessment`,
  documents: [
    "kintsugi.yaml",
    "standards/",
    `${DIR}/INTENT.md`,
    `${DIR}/telemetry/`,
    `${DIR}/graph/`,
    // The previous catalog and the understand stage's units keep the item ids (reconcile_catalog.py).
    `${DIR}/catalog.json`,
    "knowledge/as-is/{app}/units.json",
    "units/{app}/",
  ],
  steps: [
    {
      id: "inventory",
      kind: "script",
      script: "inventory.py",
      args: ["{app}", "--source", "{src}", "--source-repo", "{repo}", "--source-commit", "{commit}", "--out", "{out}/assessment/{app}"],
      expects: ["assessment/{app}/inventory.json"],
    },
    {
      id: "analysis",
      kind: "parallel",
      steps: [
        { id: "structure", kind: "agent", agent: "legacy-analyst", task: STRUCTURE_TASK, intermediate: true, expects: [`${ANALYSIS}/structure.md`] },
        { id: "debt", kind: "agent", agent: "legacy-analyst", task: DEBT_TASK, intermediate: true, expects: [`${ANALYSIS}/debt.md`] },
        { id: "security", kind: "agent", agent: "security-auditor", task: SECURITY_TASK, intermediate: true, expects: [`${ANALYSIS}/security.md`] },
      ],
    },
    ...topologySteps(EXTRACT_SCRIPT, `{in}/${ANALYSIS}/structure.md holds the domains the structure job found`),
    {
      id: "catalog",
      kind: "script",
      script: "catalog_from_topology.py",
      args: ["{app}", "--assessment", `{in}/${DIR}`, "--manifest", "{in}/kintsugi.yaml", "--out", `{out}/${DRAFT}/proposed.json`],
      intermediate: true,
      expects: [`${DRAFT}/proposed.json`],
    },
    {
      id: "catalog-curate",
      kind: "agent",
      agent: "legacy-analyst",
      task: CURATE_TASK,
      schema: CATALOG_EDITS_SCHEMA,
      resultTo: `${DRAFT}/edits.json`,
      intermediate: true,
    },
    {
      id: "catalog-edits",
      kind: "script",
      script: "apply_catalog_edits.py",
      args: [
        "--catalog",
        `{in}/${DRAFT}/proposed.json`,
        "--edits",
        `{in}/${DRAFT}/edits.json`,
        "--inventory",
        `{in}/${DIR}/inventory.json`,
        "--manifest",
        "{in}/kintsugi.yaml",
        "--out",
        `{out}/${DRAFT}/curated.json`,
      ],
      intermediate: true,
      expects: [`${DRAFT}/curated.json`],
    },
    {
      id: "catalog-reconcile",
      kind: "script",
      script: "reconcile_catalog.py",
      args: [
        "--catalog",
        `{in}/${DRAFT}/curated.json`,
        "--inventory",
        `{in}/${DIR}/inventory.json`,
        "--previous",
        `{in}/${DIR}/catalog.json`,
        "--units-json",
        "{in}/knowledge/as-is/{app}/units.json",
        "--units-dir",
        "{in}/units/{app}",
        "--out",
        `{out}/${DIR}/catalog.json`,
      ],
      expects: [`${DIR}/catalog.json`],
    },
    {
      id: "synthesis",
      kind: "agent",
      agent: "legacy-analyst",
      task: SYNTHESIS_TASK,
      expects: ["assessment/{app}/ASSESSMENT.md", "assessment/{app}/ARCHITECTURE.mmd"],
    },
  ],
};
