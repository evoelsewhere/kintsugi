// WORKSPACE.md (ADR-0055): the guide at the root of a job workspace. It is generated from the manifest and what the
// worker knows, never written by an agent, and regenerated at the start of every attempt. The kernel tells every
// agent to read it first.

import { SOURCE_ZONES, sourceRole, type PinnedSource } from "@kintsugi/domain";

export interface GuideSource extends PinnedSource {
  /** Folder of the mount, relative to the workspace root. */
  path: string;
  /** Files of the checkout, when counted. */
  files?: number;
}

/** What an earlier attempt left, from the ledger. */
export interface GuideHistory {
  /** Steps that succeeded and are kept. */
  succeeded: number;
  failed: Array<{ key: string; reason: string }>;
}

export interface GuideInput {
  jobId: string;
  attempt: number;
  /** `stage understand`, `agent legacy-analyst`, ...: what the job is. */
  job: string;
  applicationId?: string;
  sources: readonly GuideSource[];
  documentsCommit?: string;
  history?: GuideHistory;
}

const short = (commit: string): string => commit.slice(0, 12);
const cell = (text: string): string => text.replaceAll("|", "\\|").replaceAll("\n", " ");

export function renderGuide(input: GuideInput): string {
  const asIs = input.sources.filter((source) => sourceRole(source) === "legacy");
  const toBe = input.sources.filter((source) => sourceRole(source) === "target");
  const lines: string[] = [
    "# Job workspace",
    "",
    `Job \`${input.jobId}\`, attempt ${input.attempt}: ${input.job}${input.applicationId === undefined ? "" : ` of the application \`${input.applicationId}\``}.`,
    "This file is generated for the job; do not edit it. Your working directory is the root of this workspace, and the paths in your task and here are relative to it.",
    "",
    "## Layout",
    "",
    "| Folder | What is in it | Access |",
    "|---|---|---|",
    `| \`${SOURCE_ZONES.legacy}/<repository>/\` | The legacy code, one folder per repository, at the pinned commit | read-only |`,
    `| \`${SOURCE_ZONES.target}/<repository>/\` | The target code that replaces it, one folder per repository, at the pinned commit | read-only |`,
    "| `steps/<step>/in/` | What your step is given: the project's documents and the outputs of the steps before it, at their document-repository paths. Your task names it as `{in}` | read-only |",
    "| `steps/<step>/out/` | Where your step writes, with the write and edit tools, by a path relative to it. Your task names it as `{out}` | write-only: it cannot be read back |",
    "| `WORKSPACE.md` | This guide | read-only |",
    "",
    "Anything else in the workspace is the worker's and is out of reach.",
    "",
    "Your task gives the exact paths of your step: `{in}` is a folder such as `steps/<step>/in`, `{out}` its sibling `steps/<step>/out`, and the legacy code is under",
    `\`${SOURCE_ZONES.legacy}/\`. Use them as written. There is no \`in/\`, \`out/\` or \`src/\` folder at the root of the workspace, and the folders of other steps are not yours.`,
    "",
  ];

  if (input.sources.length > 0) {
    lines.push("## Repositories", "", "| Zone | Repository | Commit | Files |", "|---|---|---|---|");
    for (const source of [...asIs, ...toBe]) {
      lines.push(`| ${SOURCE_ZONES[sourceRole(source)]} | ${cell(source.repositoryId)} | \`${short(source.commit)}\` | ${source.files === undefined ? "" : source.files} |`);
    }
    const sample = asIs[0] ?? toBe[0]!;
    lines.push(
      "",
      `Cite a file as \`<repository>/<path in the repository>\`, never with the zone folder: \`${sample.repositoryId}/<path>\`. You read it at \`${sample.path}/<path>\`.`,
      asIs.length > 1 ? `The application has ${asIs.length} legacy repositories. Read all of them: a repository nobody read is a gap in what is reported.` : "",
      "",
    );
  }
  if (input.documentsCommit !== undefined) lines.push(`The project's documents are read at the commit \`${short(input.documentsCommit)}\` of the document repository.`, "");

  lines.push(
    "## Working rules",
    "",
    "- Write each result to its file as soon as it is finished, not at the end: if the job is stopped, what is written is kept for the next attempt.",
    "- A path given to write or edit is relative to your output folder and is a document-repository path; never prefix it with a repository or a workspace folder.",
    "- Do not rewrite a file to check it, and do not look for what you wrote: your output folder cannot be read, and a step is done when its files are written. Then reply with your result (DONE when the task asks for nothing else) and stop.",
    "",
  );

  if (input.attempt > 1 && input.history !== undefined) {
    lines.push("## Earlier attempts", "", `This is attempt ${input.attempt}. ${input.history.succeeded} step${input.history.succeeded === 1 ? "" : "s"} of the earlier attempts succeeded and ${input.history.succeeded === 1 ? "is" : "are"} not run again.`);
    if (input.history.failed.length > 0) {
      lines.push("", "Steps that failed and run again:", "");
      for (const failure of input.history.failed.slice(0, 20)) lines.push(`- \`${failure.key}\`: ${failure.reason.replaceAll("\n", " ").slice(0, 200)}`);
    }
    lines.push("");
  }

  return `${lines.filter((line, index, all) => !(line === "" && all[index - 1] === "")).join("\n")}\n`;
}
