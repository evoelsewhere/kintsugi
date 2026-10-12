// The `harden` stage (commands/modernize-harden.md): workflow harden-scan.js (five finders,
// one refuter per finding, a second judge per Critical/High one); a security-auditor
// triage-and-remediation job writes SECURITY_FINDINGS.md, the shareable remediation patch and,
// under restricted/, the masked credential inventory; then up to three rounds of patch review,
// each followed by a revision while any hunk is not clean. The scan result and the review
// verdicts are intermediate. Applying the patch is a member's decision outside the stage.
// The assessment and the map are optional inputs: when they are on the default branch the
// finders use them as leads and the workflow settles every security highlight of the
// assessment (confirmed as a finding or refuted), so the two documents never silently disagree.
//
// Not wired yet: the re-run of coverage gaps (args.classes / args.findings).

import type { StagePlan, StageContext } from "../plan.js";
import { CREDENTIALS, HEADER, RESTRICTED, UNTRUSTED, WORKSPACE } from "./common.js";

const DIR = "assessment/{app}";
const SCAN = `${DIR}/harden_scan.json`;
const REVIEW = `${DIR}/patch_review.json`;
const ROUNDS = 3;

const REVIEW_SCHEMA = {
  type: "object",
  required: ["clean", "hunks"],
  properties: {
    clean: { type: "boolean", description: "True when every hunk RESOLVES its finding (or the patch has no hunks)" },
    hunks: {
      type: "array",
      items: {
        type: "object",
        required: ["finding", "verdict", "reason"],
        properties: {
          finding: { type: "string", description: "The SEC-NNN id the hunk cites" },
          verdict: { type: "string", enum: ["RESOLVES", "PARTIAL", "INTRODUCES-RISK"] },
          reason: { type: "string", description: "One line; never quote a credential value" },
        },
      },
    },
  },
};

const TRIAGE_TASK = `Triage the security scan of application {app} and draft its remediation.

${WORKSPACE}

The scan result is {in}/${SCAN}: the workflow's returned object with findings (survivors of refutation, Critical and
High ones double-judged, each with a confidence), refuted, unverified, deadFinders, credentialFindings, coverage (how
the code was reviewed and which files), toolsNotRun, carryOver (the assessment's security highlights, each confirmed,
refuted or unverified; null when there was no assessment), injectionFlags and stats. If present,
{in}/${DIR}/ASSESSMENT.md is the assessment and {in}/standards/ the project's conventions.

Write ${DIR}/SECURITY_FINDINGS.md with outputs_write:
- "Scorecard": count by severity, top CWE categories, the number of findings refuted as false positives and
  stats.falsePositiveRate, and a line "**Review coverage:** ..." from coverage: the method (no SAST, dependency-audit or
  secret-scanning tool ran: the finders reviewed the code by hand), how many files were reviewed and which. With no
  findings write "No confirmed findings in the N files reviewed", never that the code has no vulnerabilities.
- "Coverage gaps", directly under it: if deadFinders and unverified are both empty and carryOver.checked is not false,
  the line "All 5 finder classes returned and every finding was judged"; otherwise each dead class as not scanned (all
  five means the scan did not run: never write that nothing was found), each unverified finding as not judged (title,
  CWE, file:line, the finder's severity), "assessment highlights not settled" when carryOver.checked is false, and a
  note that the counts cover judged findings only.
- "Findings by severity": a table (SEC-NNN, CWE, severity, confidence, file:line, title, exploit scenario).
- "Assessment carry-over": when carryOver is null, one line saying no assessment was on the default branch; otherwise a
  table with one row per highlight (assessment id, title, location, outcome: "Confirmed as SEC-NNN", "Refuted" or
  "Not judged", reason). Every highlight appears; a refuted one keeps its reason.
- "Dependency CVEs": a table (package, installed version, CVE, fixed version).
- "Audit tools not run": a table (tool, reason) from toolsNotRun only; add no tool that is not there.
- "Injection flags", prominently: any injectionFlags (instruction-shaped text in the source).

${RESTRICTED} SECURITY_FINDINGS.md then gets one line: "N hardcoded credentials found — inventory in the restricted
portal record (not committed; not for sharing)."

For each Critical and High finding draft a minimal, targeted fix as a unified diff with a/ and b/ paths relative to
the legacy repository root, a comment line above each hunk citing its finding ("# SEC-001: parameterize the query").
Credential findings get no applicable hunk (a diff would carry the value): give each a comment-only placeholder that
describes the change without the value. Write all of it to ${DIR}/security_remediation.patch with outputs_write
(if there is nothing to patch, a comment line saying so). Add a "Remediation Log" to SECURITY_FINDINGS.md: each
finding id, a one-line summary of the fix, and whether the patch carries a hunk or needs a manual credential change.

${HEADER}
${CREDENTIALS}
${UNTRUSTED}`;

const REVIEW_TASK = `Review the security remediation patch of application {app} (round {round} of {maxRounds}).

${WORKSPACE}

The patch is {in}/${DIR}/security_remediation.patch and the findings it fixes are in {in}/${DIR}/SECURITY_FINDINGS.md.
For each hunk: does it fully remediate the cited finding? Does it introduce a vulnerability or change behavior beyond
the fix? Confirm no raw credential appears anywhere in the patch. Give one verdict per hunk: RESOLVES, PARTIAL or
INTRODUCES-RISK, with a one-line reason. Comment-only placeholders are not hunks. clean is true when every hunk
RESOLVES (or there are none).

If clean is true, also write ${DIR}/SECURITY_FINDINGS.md with outputs_write: the current file unchanged plus a final
"Patch Review" section listing every hunk with its verdict and reason.

${CREDENTIALS}
${UNTRUSTED}`;

const REVISE_TASK = `Revise the security remediation patch of application {app} (round {round} of {maxRounds}).

${WORKSPACE}

The patch is {in}/${DIR}/security_remediation.patch, the findings are in {in}/${DIR}/SECURITY_FINDINGS.md and the
reviewer's verdicts are in {in}/${REVIEW}. Revise only the hunks that are PARTIAL or INTRODUCES-RISK, using the
reviewer's reasons, and rewrite ${DIR}/security_remediation.patch with outputs_write. In round {maxRounds} do not revise:
remove every hunk that is not RESOLVES and record each in the Remediation Log as "needs manual remediation" with the
reviewer's reason; never ship a hunk that failed its last review.

Rewrite ${DIR}/SECURITY_FINDINGS.md with outputs_write: update the Remediation Log and add (or replace) a final
"Patch Review" section with the verdicts of this round and what you changed.

${HEADER}
${CREDENTIALS}
${UNTRUSTED}`;

const reviewClean = async (ctx: StageContext): Promise<boolean> => {
  const review = (await ctx.readJson(`assessment/${ctx.app}/patch_review.json`)) as { clean?: unknown; hunks?: Array<{ verdict?: unknown }> } | undefined;
  if (review === undefined) return false;
  const hunks = Array.isArray(review.hunks) ? review.hunks : [];
  return review.clean === true && hunks.every((hunk) => hunk.verdict === "RESOLVES");
};

/** The workflow's arguments: the assessment and the map, when they are on the default branch, as leads. */
export async function scanArgs(ctx: StageContext): Promise<Record<string, unknown>> {
  const assessment = `assessment/${ctx.app}/ASSESSMENT.md`;
  const topology = `assessment/${ctx.app}/topology.json`;
  return {
    app: ctx.app,
    ...((await ctx.readText(assessment)) === undefined ? {} : { assessment }),
    ...((await ctx.readText(topology)) === undefined ? {} : { topology }),
  };
}

export const HARDEN: StagePlan = {
  id: "harden",
  message: (app) => `Harden ${app}: security findings and remediation patch`,
  documents: ["kintsugi.yaml", "standards/", `${DIR}/SECURITY_FINDINGS.md`],
  optional: [
    { path: `${DIR}/ASSESSMENT.md`, stage: "assess" },
    { path: `${DIR}/topology.json`, stage: "map" },
  ],
  steps: [
    { id: "scan", kind: "workflow", workflow: "harden-scan", args: scanArgs, resultTo: SCAN, intermediate: true },
    {
      id: "triage",
      kind: "agent",
      agent: "security-auditor",
      task: TRIAGE_TASK,
      expects: [`${DIR}/SECURITY_FINDINGS.md`, `${DIR}/security_remediation.patch`],
    },
    {
      id: "verify",
      kind: "repeat",
      max: ROUNDS,
      until: reviewClean,
      steps: [
        { id: "review", kind: "agent", agent: "security-auditor", task: REVIEW_TASK, schema: REVIEW_SCHEMA, resultTo: REVIEW, intermediate: [REVIEW] },
        {
          id: "revise",
          kind: "agent",
          agent: "security-auditor",
          task: REVISE_TASK,
          when: async (ctx) => !(await reviewClean(ctx)),
          expects: [`${DIR}/SECURITY_FINDINGS.md`, `${DIR}/security_remediation.patch`],
        },
      ],
    },
  ],
};
