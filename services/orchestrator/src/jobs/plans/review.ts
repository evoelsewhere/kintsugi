// The `review` stage (ADR-0071): an independent reviewer reads the merge request a member opened for one or several designed
// units. The member built the units on their own machine (implement and test, with the member command `build`); Kintsugi only
// collected which unit was built in which merge request and at which commit. The runtime writes no code: it reads the target
// repository at that commit (mounted read-only under to-be/), judges it against the units' rules, design and the project's
// standards, and publishes the findings as documents. The flow is the one of `design`: a script prepares, an agent job per unit
// works, a script checks it, a script renders the pull request.
//
//   prepare_review.py       per unit its rules and merged design, and the merge request (scratch)
//   mr_changes.py           the files the merge request changes, from the merge base with the default branch (scratch)
//   forEach unit            a code-reviewer job reads the code and the tests and writes its findings (scratch)
//   check_code_review.py    the findings per unit; a note that does not read counts as not reviewed
//   parity.py               per rule of each unit: the changed files that name it, the member's reported run, what the reviewer disputes (scratch, ADR-0088)
//   render_review.py        _build/review.md for each unit (published) and the description of the pull request (scratch)

import {
  DOCUMENT_PATH_TOKENS,
  architectureDir,
  assessmentCatalogPath,
  buildChangesPath,
  buildManifestPath,
  buildParityPath,
  buildReviewNotePath,
  buildReviewReportPath,
  buildRunDir,
  buildSummaryPath,
  generatedDir,
  legacyDir,
  modernDir,
  standardsDir,
  transitionDir,
  unitKeyAsIsPath,
  unitKeyLegacyPath,
} from "@kintsugi/domain";
import type { AgentStep, ForEachStep, StageContext, StagePlan, StageScope } from "../plan.js";
import { CREDENTIALS, UNTRUSTED } from "./common.js";

const APP = DOCUMENT_PATH_TOKENS.app;
const MANIFEST = buildManifestPath(APP);
const CHANGES = buildChangesPath(APP);
const REPORT = buildReviewReportPath(APP);
const PARITY = buildParityPath(APP);
const SUMMARY = buildSummaryPath(APP);
const SCRATCH = buildRunDir(APP);
const REVIEWER = "code-reviewer";
const REPOSITORY_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

/** The units of the run (inputs.scope.items). */
function unitsOf(ctx: StageContext): string[] {
  const items = ctx.scope?.items ?? [];
  if (items.length === 0) throw new Error("the review stage needs the units of a merge request (inputs.scope.items)");
  return [...items];
}

/** The target repository and the merge request the run reads (inputs.scope.target, inputs.scope.mr). */
export function mergeRequestOf(ctx: StageContext): { target: string; url: string; commit: string; branch: string } {
  const target = ctx.scope?.target;
  const mr = ctx.scope?.mr;
  if (target === undefined || !REPOSITORY_ID.test(target)) throw new Error("the review stage needs the target repository of the merge request (inputs.scope.target)");
  if (mr === undefined) throw new Error("the review stage needs the merge request a member recorded (inputs.scope.mr)");
  return { target, url: mr.url, commit: mr.commit, branch: mr.branch ?? "" };
}

interface Manifest {
  units?: Record<string, { error?: unknown }>;
}

/** The units the prepare step found reviewable (a unit with an `error` is left out of the run). */
async function preparedUnits(ctx: StageContext): Promise<Array<{ key: string; item: string }>> {
  const manifest = (await ctx.readJson(MANIFEST)) as Manifest | undefined;
  const keys = Object.entries(manifest?.units ?? {})
    .filter(([, unit]) => unit.error === null || unit.error === undefined)
    .map(([key]) => key);
  if (keys.length === 0) throw new Error("nothing to review: no unit of the merge request can be reviewed (see the prepare step for the reason of each)");
  return keys.map((key) => ({ key, item: key }));
}

const WORKSPACE = (target: string): string => `Your working directory is the job workspace. Read-only: the target repository "${target}" at {tobe}/${target}/, checked out at the head commit of the merge request
(the code and the tests the member wrote), the legacy repositories under {src}/<repository id>/ (cite what you rely on as <repository id>/<path>:line), and the project's documents and
the outputs of the steps before yours under {in}, at their document-repository paths. You cannot run anything: say so where a finding depends on a run. \`write\` works in your output
directory: give it the full path the task names.`;

const reviewTask = (target: string): string => `Review unit {key} of application {app}: its code and its tests in the merge request {mr}. You did not write them.

${WORKSPACE(target)}

Read, under {in}:
- What the unit is: ${unitKeyAsIsPath(APP, "{key}")} (the specification), ${unitKeyLegacyPath(APP, "{key}", "rules.md")} and the files under ${unitKeyLegacyPath(APP, "{key}", "rules/")}, ${unitKeyLegacyPath(APP, "{key}", "rules-review.md")}.
- What the target must do: the unit's merged design documents, listed for {key} under "design" in ${MANIFEST}, with the common design (${architectureDir()}/blueprint.md, ${architectureDir()}/common/) and the project's standards (${standardsDir()}/conventions/, ${standardsDir()}/mappings/).
- The merge request: ${MANIFEST} names it ("mr": its URL, head commit and branch); ${CHANGES} lists the files it changes against the default branch. It may build several units: find the code and the tests of {key} by the rule ids in comments and test names (RULE-…), by the design's names and by the changed files, and review only those.

Follow the code-review skill: the five lenses, one after the other. Write your review note at ${buildReviewNotePath(APP, "{key}")}, in the form your instructions give (front matter unit "{key}", the table Severity | File | Where | Category | Finding | Suggestion); write no other file.

${CREDENTIALS}
${UNTRUSTED}`;

/** The pull-request title: the units of the merge request (the module when one module's units are selected). */
export function reviewMessage(app: string, scope?: StageScope): string {
  const items = scope?.items ?? [];
  const modules = [...new Set(items.map((id) => id.split("/")[0]))];
  if (items.length > 0 && modules.length === 1) return `Review ${app}: ${modules[0]} (${items.length} unit${items.length === 1 ? "" : "s"})`;
  const names = items.map((id) => id.split("/")[1] ?? id);
  return `Review ${app}: ${names.slice(0, 2).join(", ")}${names.length > 2 ? ` +${names.length - 2}` : ""}`;
}

const reviewStep: AgentStep = {
  id: "review-unit",
  kind: "agent",
  agent: REVIEWER,
  task: (ctx) => reviewTask(mergeRequestOf(ctx).target).replaceAll("{mr}", mergeRequestOf(ctx).url),
  intermediate: true,
};

const eachUnit: ForEachStep = {
  id: "review",
  kind: "forEach",
  concurrency: 3,
  tolerateFailures: true,
  items: preparedUnits,
  step: reviewStep,
};

export const REVIEW: StagePlan = {
  id: "review",
  message: reviewMessage,
  description: (app) => buildSummaryPath(app),
  documents: ["kintsugi.yaml", `${standardsDir()}/`, `${architectureDir()}/`, `${transitionDir()}/`, `${legacyDir(APP)}/`, `${modernDir(APP)}/`, `${generatedDir(APP)}/`],
  requires: [{ path: assessmentCatalogPath(APP), stage: "design" }],
  reviewAll: true,
  steps: [
    {
      id: "prepare",
      kind: "script",
      script: "prepare_review.py",
      args: (ctx) => {
        const mr = mergeRequestOf(ctx);
        return ["--require-ready", "{app}", unitsOf(ctx).join(","), "--target", mr.target, "--mr-url", mr.url, "--mr-commit", mr.commit, "--mr-branch", mr.branch, "--root", "{in}", "--manifest", `{out}/${MANIFEST}`];
      },
      intermediate: true,
      expects: [MANIFEST],
    },
    {
      id: "changes",
      kind: "script",
      script: "mr_changes.py",
      args: (ctx) => {
        const mr = mergeRequestOf(ctx);
        return ["--tobe", `{tobe}/${mr.target}`, "--commit", mr.commit, "--out", `{out}/${CHANGES}`];
      },
      intermediate: true,
      expects: [CHANGES],
    },
    eachUnit,
    {
      id: "check",
      kind: "script",
      script: "check_code_review.py",
      args: (ctx) => ["{app}", unitsOf(ctx).join(","), "--root", "{in}", "--report", `{out}/${REPORT}`],
      intermediate: true,
      expects: [REPORT],
    },
    {
      id: "parity",
      kind: "script",
      script: "parity.py",
      args: (ctx) => {
        const mr = mergeRequestOf(ctx);
        return ["--manifest", `{in}/${MANIFEST}`, "--changes", `{in}/${CHANGES}`, "--report", `{in}/${REPORT}`, "--tobe", `{tobe}/${mr.target}`, "--tests", JSON.stringify(ctx.scope?.mr?.tests ?? {}), "--out", `{out}/${PARITY}`];
      },
      intermediate: true,
      expects: [PARITY],
    },
    {
      id: "summary",
      kind: "script",
      script: "render_review.py",
      args: (ctx) => ["{app}", unitsOf(ctx).join(","), "--manifest", `{in}/${MANIFEST}`, "--root", "{in}", "--scratch", `{in}/${SCRATCH}`, "--out", "{out}", "--summary", `{out}/${SUMMARY}`],
      // The documents it renders are published; the description of the pull request is not.
      intermediate: [SUMMARY],
      expects: [SUMMARY],
    },
  ],
};
