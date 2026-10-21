// Application layer: stage results for one application, read from the paths provided by the domain
// document-layout module at a ref and built with the reader parsers. The
// default ref is the output of the stage's latest successful run (its branch tip, open or
// merged), else the default branch. Also the headline numbers of every stage for the overview.

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  CATALOG_ITEM_ID_PATTERN,
  assessmentCatalogModulePath,
  assessmentDir,
  generatedDir,
  unitDataObjectsPath,
  unitFindingsPath,
  unitRulesPath,
  unitUnderstandingDir,
  unitUnderstandingPath,
} from "@kintsugi/domain";
import { JobRunsService, type JobRunView } from "#modules/delivery/runtime-jobs/index.js";
import { type DocumentRef, MAX_DOCUMENT_BYTES, RESULT_STAGES, type ResultStage, type StageFile, type StageHeadline, type StageResults } from "../domain/document.js";
import { DocumentRepoReader } from "../domain/document.ports.js";
import { type DocumentContext, DocumentsService } from "./documents.service.js";
import {
  STAGE_OUTPUTS,
  type StageSource,
  assessHeadline,
  assessResults,
  hardenHeadline,
  hardenResults,
  mapHeadline,
  mapResults,
  missingInputsOf,
  rulesHeadline,
  rulesResults,
  stageDir,
  understandHeadline,
  understandResults,
} from "./stage-results.builders.js";

/** How many recent runs of the application are looked at for a stage's refs. */
const RECENT_RUNS = 100;

const HEADLINES: Record<ResultStage, (source: StageSource) => Promise<{ counts: Record<string, number>; headline: string[] }>> = {
  assess: assessHeadline,
  map: mapHeadline,
  "extract-rules": rulesHeadline,
  harden: hardenHeadline,
  understand: understandHeadline,
};

export const isResultStage = (stage: string): stage is ResultStage => (RESULT_STAGES as readonly string[]).includes(stage);

@Injectable()
export class StageResultsService {
  constructor(
    private readonly documents: DocumentsService,
    private readonly runs: JobRunsService,
    private readonly reader: DocumentRepoReader,
  ) {}

  async results(projectId: string, applicationId: string, stage: string, ref: string | undefined, compare: boolean): Promise<StageResults> {
    if (!isResultStage(stage)) throw new BadRequestException(`Stage "${stage}" has no results view (available: ${RESULT_STAGES.join(", ")})`);
    const context = await this.documents.context(projectId);
    this.application(context, applicationId);
    const runs = await this.stageRuns(projectId, applicationId, stage);
    const selected = ref === undefined ? await this.defaultRef(context, runs) : await this.describe(context, ref, runs);
    const source = await this.source(context, applicationId, stage, selected.commit);
    const appDir = stageDir(stage, applicationId);
    const runId = selected.runId;
    const common = {
      applicationId,
      ref: selected,
      files: source.files,
      empty: source.files.every((file) => !STAGE_OUTPUTS[stage].files.includes(file.path.slice(appDir.length + 1))),
    };

    let results: StageResults;
    switch (stage) {
      case "assess":
        results = { stage, ...common, ...(await assessResults(source, appDir)) };
        break;
      case "map":
        results = { stage, ...common, ...(await mapResults(source, appDir)) };
        break;
      case "extract-rules":
        results = { stage, ...common, ...(await rulesResults(source, appDir)) };
        break;
      case "harden":
        results = { stage, ...common, ...(await hardenResults(source, appDir)), restrictedRecords: runId === undefined ? 0 : await this.restrictedCount(projectId, runId), ...(runId === undefined ? {} : { runId }) };
        break;
      case "understand": {
        // Work-item status is current on the default branch, not on the run's branch.
        const tip = await this.defaultBranchRef(context);
        const statusSource = tip.commit === selected.commit ? undefined : await this.source(context, applicationId, stage, tip.commit);
        results = { stage, ...common, ...(await understandResults(source, appDir, applicationId, missingInputsOf(runs.find((run) => run.id === runId)?.outputSummary), statusSource)) };
        break;
      }
    }

    if (compare) {
      const previous = await this.previousRef(context, runs, selected);
      if (previous !== undefined) {
        const counts = (await HEADLINES[stage](await this.source(context, applicationId, stage, previous.commit))).counts;
        results.previous = { ref: previous, counts };
      }
    }
    return results;
  }

  /**
   * The results of the understand stage (ADR-0033) as one of the result views — `map` (topology),
   * `extract-rules` (rules), `harden` (security findings), `understand` (traceability) — for the
   * whole application (the generated views under generated/) or one catalog item (the documents of its
   * understanding folder), at a ref (default: the default branch; a run's branch shows that run's items).
   */
  async understandResults(projectId: string, applicationId: string, view: string, item: string | undefined, ref: string | undefined): Promise<StageResults & { scope: { item?: string } }> {
    if (view === "assess" || !isResultStage(view)) throw new BadRequestException(`View "${view}" is not an understand result (available: map, extract-rules, harden, understand)`);
    if (item !== undefined && !CATALOG_ITEM_ID_PATTERN.test(item)) throw new BadRequestException(`"${item.slice(0, 130)}" is not a catalog item id`);
    const context = await this.documents.context(projectId);
    this.application(context, applicationId);
    const selected = ref === undefined ? await this.defaultBranchRef(context) : await this.describe(context, ref, []);
    const overrides = new Map<string, string | null>();
    let dir: string;
    if (item === undefined) {
      // The topology of the application is an assessment document; the other views are read models under generated/.
      dir = view === "map" ? assessmentDir(applicationId) : generatedDir(applicationId);
    } else {
      const [module = "", unit = ""] = item.split("/");
      // The unit's understanding folder holds the documents; the views read them under the names of the aggregates.
      dir = unitUnderstandingDir(applicationId, module, unit);
      const readAt = (path: string): Promise<string | undefined> => this.documents.readText(context, selected.commit, path);
      if (view === "extract-rules") {
        overrides.set("BUSINESS_RULES.md", (await readAt(unitRulesPath(applicationId, module, unit))) ?? null);
        overrides.set("DATA_OBJECTS.md", (await readAt(unitDataObjectsPath(applicationId, module, unit))) ?? null);
      }
      if (view === "harden") overrides.set("SECURITY_FINDINGS.md", (await readAt(unitFindingsPath(applicationId, module, unit))) ?? null);
      if (view === "understand") {
        const moduleDocument = await readAt(assessmentCatalogModulePath(applicationId, module));
        if (moduleDocument === undefined || !moduleDocument.includes(`\n## ${item}: `)) throw new NotFoundException(`${item} is not in the catalog of ${applicationId} at ${selected.ref}`);
        // The understanding record marks the unit understood; it stands in for the totals file the aggregate view counts from.
        overrides.set("traceability.md", (await readAt(unitUnderstandingPath(applicationId, module, unit))) ?? null);
      }
    }
    const source = await this.sourceAt(context, dir, STAGE_OUTPUTS[view].files, selected.commit, overrides, true);
    const appDir = dir;
    const empty = !(await Promise.all(STAGE_OUTPUTS[view].countsFrom.map((name) => source.read(name)))).some((text) => text !== null);
    const common = { applicationId, ref: selected, files: source.files, empty, scope: item === undefined ? {} : { item } };
    switch (view) {
      case "map":
        return { stage: view, ...common, ...(await mapResults(source, appDir)) };
      case "extract-rules":
        return { stage: view, ...common, ...(await rulesResults(source, appDir)) };
      case "harden":
        return { stage: view, ...common, ...(await hardenResults(source, appDir)), restrictedRecords: 0 };
      case "understand":
        return { stage: view, ...common, ...(await understandResults(source, appDir, applicationId, [], undefined, item)) };
      default:
        throw new BadRequestException(`View "${view}" is not an understand result`);
    }
  }

  /** The headline numbers of every result stage of an application, at each stage's default ref. */
  async headlines(projectId: string, applicationId: string): Promise<StageHeadline[]> {
    const context = await this.documents.context(projectId);
    this.application(context, applicationId);
    const all = (await this.runs.list(projectId, applicationId, { limit: RECENT_RUNS, offset: 0 })).items;
    return Promise.all(
      RESULT_STAGES.map(async (stage) => {
        const runs = all.filter((run) => run.kind === "stage" && run.name === stage && run.status === "succeeded");
        // Without a successful run, the default branch holds nothing this application's stage wrote.
        if (runs.length === 0) return { stage, headline: [] };
        const ref = await this.defaultRef(context, runs);
        const { headline } = await HEADLINES[stage](await this.source(context, applicationId, stage, ref.commit));
        return { stage, headline, ref };
      }),
    );
  }

  private application(context: DocumentContext, applicationId: string): void {
    if (!context.project.applications.some((application) => application.id === applicationId)) {
      throw new NotFoundException(`Application ${applicationId} not found in project ${context.project.id}`);
    }
  }

  /** Successful top-level runs of the stage for the application, newest first. */
  private async stageRuns(projectId: string, applicationId: string, stage: ResultStage): Promise<JobRunView[]> {
    const page = await this.runs.list(projectId, applicationId, { limit: RECENT_RUNS, offset: 0 });
    return page.items.filter((run) => run.kind === "stage" && run.name === stage && run.status === "succeeded");
  }

  private async defaultBranchRef(context: DocumentContext): Promise<DocumentRef> {
    const resolved = await this.documents.resolve(context, undefined);
    return { ...resolved, kind: "default", status: "default", branch: context.defaultBranch, label: `Default branch (${context.defaultBranch})` };
  }

  /** The output of the latest successful run whose branch is still there (or that committed to the default branch), else the default branch. */
  private async defaultRef(context: DocumentContext, runs: JobRunView[]): Promise<DocumentRef> {
    const fallback = await this.defaultBranchRef(context);
    for (const run of runs) {
      const ref = await this.refOfRun(context, run, fallback);
      if (ref !== undefined) return ref;
    }
    return fallback;
  }

  /** The ref of a run's output; undefined when its branch is gone. */
  private async refOfRun(context: DocumentContext, run: JobRunView, defaultRef: DocumentRef): Promise<DocumentRef | undefined> {
    const branch = run.documentWrite?.branch;
    if (branch === undefined) {
      // Committed straight to the default branch (auto-commit paths) or nothing changed.
      return run.documentWrite?.status === "committed" || run.documentWrite?.status === "unchanged" ? { ...defaultRef, runId: run.id, stage: run.name, date: run.finishedAt ?? run.createdAt } : undefined;
    }
    const commit = await this.reader.branchTip(context.repo, branch);
    if (commit === undefined) return undefined;
    const merged = await this.reader.isAncestor(context.repo, commit, defaultRef.commit);
    return {
      ref: `refs/heads/${branch}`,
      kind: "run",
      commit,
      status: merged ? "merged" : "open",
      branch,
      date: run.finishedAt ?? run.createdAt,
      stage: run.name,
      ...(run.applicationId === undefined ? {} : { applicationId: run.applicationId }),
      runId: run.id,
      ...(run.documentWrite?.id === undefined ? {} : { writeId: run.documentWrite.id }),
      label: `${run.name} run`,
    };
  }

  /** An explicit ref, described as a run's output when it is one. */
  private async describe(context: DocumentContext, ref: string, runs: JobRunView[]): Promise<DocumentRef> {
    const resolved = await this.documents.resolve(context, ref);
    if (resolved.ref === `refs/heads/${context.defaultBranch}`) return this.defaultBranchRef(context);
    const run = runs.find((entry) => entry.documentWrite?.branch !== undefined && `refs/heads/${entry.documentWrite.branch}` === resolved.ref);
    if (run !== undefined) {
      const described = await this.refOfRun(context, run, await this.defaultBranchRef(context));
      if (described !== undefined) return described;
    }
    const branch = resolved.ref.startsWith("refs/heads/") ? resolved.ref.slice("refs/heads/".length) : undefined;
    return { ...resolved, kind: branch === undefined ? "commit" : "write", status: branch === undefined ? "commit" : "open", ...(branch === undefined ? {} : { branch }), label: branch ?? resolved.commit.slice(0, 12) };
  }

  /** The output of the successful run before the selected one (older), when its branch is still there. */
  private async previousRef(context: DocumentContext, runs: JobRunView[], selected: DocumentRef): Promise<DocumentRef | undefined> {
    const index = selected.runId === undefined ? -1 : runs.findIndex((run) => run.id === selected.runId);
    if (index < 0) return undefined;
    const fallback = await this.defaultBranchRef(context);
    for (const run of runs.slice(index + 1)) {
      const ref = await this.refOfRun(context, run, fallback);
      if (ref !== undefined && ref.commit !== selected.commit) return ref;
    }
    return undefined;
  }

  /** The stage's output directory at a commit, and reads of other document-repo paths at the same commit. */
  private source(context: DocumentContext, applicationId: string, stage: ResultStage, commit: string): Promise<StageSource> {
    return this.sourceAt(context, stageDir(stage, applicationId), STAGE_OUTPUTS[stage].files, commit);
  }

  /** A directory at a commit as a stage source; `overrides` stand in for files of that name (null: absent). */
  private async sourceAt(
    context: DocumentContext,
    dir: string,
    names: readonly string[],
    commit: string,
    overrides: ReadonlyMap<string, string | null> = new Map(),
    // A per-unit or generated directory lists every file it holds; a stage's results are its stage outputs.
    listAll = false,
  ): Promise<StageSource> {
    const entries = (await this.reader.list(context.repo, commit, dir)) ?? [];
    const known = new Map(entries.filter((entry) => entry.kind === "file").map((entry) => [entry.name, entry.size ?? 0]));
    const files: StageFile[] = listAll
      ? [...known.entries()].map(([name, size]) => ({ path: `${dir}/${name}`, size }))
      : names.flatMap((name) => (known.has(name) ? [{ path: `${dir}/${name}`, size: known.get(name) ?? 0 }] : []));
    return {
      files,
      read: async (name) => {
        if (overrides.has(name)) return overrides.get(name) ?? null;
        const size = known.get(name);
        if (size === undefined) return null;
        const read = await this.reader.read(context.repo, commit, `${dir}/${name}`, MAX_DOCUMENT_BYTES, size);
        return read.status === "ok" ? read.content : null;
      },
      list: async (path) => ((await this.reader.list(context.repo, commit, path)) ?? []).flatMap((entry) => (entry.kind === "file" ? [{ path: entry.path, size: entry.size ?? 0 }] : [])),
      readPath: async (path, size) => {
        const read = await this.reader.read(context.repo, commit, path, MAX_DOCUMENT_BYTES, size);
        return read.status === "ok" ? read.content : null;
      },
    };
  }

  /** Restricted records of a run and its steps: a count, never names or content. */
  private async restrictedCount(projectId: string, runId: string): Promise<number> {
    const run = await this.runs.get(projectId, runId);
    return run.restrictedRecords + run.steps.reduce((sum, step) => sum + step.restrictedRecords, 0);
  }
}
