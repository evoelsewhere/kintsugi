// The `assess` stage, single-application mode (commands/modernize-assess.md): the inventory
// script step, three analysis jobs in parallel (legacy-analyst structure, legacy-analyst debt,
// security-auditor scan), then the legacy-analyst synthesis job that writes ASSESSMENT.md and
// ARCHITECTURE.mmd. The analysis notes are intermediate: only the synthesis is committed.
// Portfolio mode (workflows/portfolio-assess.js) is not a portal stage yet.

import type { StagePlan } from "../plan.js";
import { CREDENTIALS, HEADER, RESTRICTED, UNTRUSTED, WORKSPACE } from "./common.js";

const ANALYSIS = "assessment/{app}/analysis";

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
technology fingerprint, and a Mermaid \`graph TD\` of the domains clustered with \`subgraph\`, at most about 40 edges,
in a fenced \`mermaid\` block. These notes are input for the synthesis job, not a final document.

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

const SYNTHESIS_TASK = `Write the assessment of application {app}.

${WORKSPACE}

Your inputs, read-only:
- {in}/assessment/{app}/inventory.json — the figures of record from the inventory script (do not re-measure).
- {in}/${ANALYSIS}/structure.md, debt.md and security.md — the three analysis jobs' notes (domains and technology
  fingerprint, technical debt, vulnerabilities and masked credentials). Check what they cite before you repeat it.
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

Also write assessment/{app}/ARCHITECTURE.mmd: the domain diagram from the structure notes, a Mermaid \`graph TD\`
clustered with \`subgraph\`, at most about 40 edges, without a Markdown fence.

Secrets first: the assessment is shared and committed, so masking applies to every section, whichever note a finding
came from. ${RESTRICTED} Security Findings then points to "Credential inventory in the restricted portal record (not
committed; not for sharing)".

${HEADER}
${UNTRUSTED}`;

export const ASSESS: StagePlan = {
  id: "assess",
  message: (app) => `Assess ${app}: inventory, analysis and assessment`,
  documents: ["kintsugi.yaml", "standards/", "assessment/{app}/INTENT.md", "assessment/{app}/telemetry/"],
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
    {
      id: "synthesis",
      kind: "agent",
      agent: "legacy-analyst",
      task: SYNTHESIS_TASK,
      expects: ["assessment/{app}/ASSESSMENT.md", "assessment/{app}/ARCHITECTURE.mmd"],
    },
  ],
};
