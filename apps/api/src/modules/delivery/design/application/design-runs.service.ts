// Application layer: generating a design set on the portal (ADR-0049). A run is one set for a selection
// of units (inputs.scope: the unit keys and the set), resolved against the design overview on the default
// branch; it is pinned to the commit that was read, so every step of the run sees the same documents. A unit
// that already has the set, whose needed sets are not on the default branch, or that another run is generating or
// a pull request carries for the same set, blocks the selection (409 with the conflicts); Abandon on a run whose
// pull request was closed without merging releases its units. A set of scope `application` (ADR-0050) is generated
// for the application itself: the selection is the pseudo-unit `@app`, and only that.

import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { APPLICATION_UNIT_KEY, designSetDir } from "@kintsugi/domain";
import type { Actor } from "#common/auth/decorators.js";
import { DocumentsService } from "#modules/delivery/documents/index.js";
import { DESIGN, JobRunsService, type JobRunView } from "#modules/delivery/runtime-jobs/index.js";
import type { DesignActivityView, UnitSetActivity } from "../domain/design.js";
import { DesignService } from "./design.service.js";

/** How many recent runs of the application are looked at. */
const RECENT_RUNS = 200;

export interface DesignSelection {
  set?: string;
  units?: string[];
  /** A failed design run to resume instead (same as POST job-runs/:runId/retry). */
  resumeOf?: string;
  /** Write the set again for units that already have it, over their design (ADR-0081). */
  regenerate?: boolean;
  /** Explicitly produce a non-final design when the evidence is incomplete. */
  draft?: boolean;
}

type Conflict = { unit: string; state: "not-ready"; reasons: string[] } | { unit: string; state: "running" | "in-pr"; runId: string } | { unit: string; state: "written" } | { unit: string; state: "unwritten" } | { unit: string; state: "needs"; needs: string[] };

const reasonOf = (conflict: Conflict): string => {
  switch (conflict.state) {
    case "running":
      return "is being generated";
    case "in-pr":
      return "is in an open pull request";
    case "written":
      return "has this set already";
    case "unwritten":
      return "has no design of this set to regenerate";
    case "not-ready":
      return conflict.reasons.join("; ");
    case "needs":
      return `needs ${conflict.needs.join(", ")} first`;
  }
};

@Injectable()
export class DesignRunsService {
  constructor(
    private readonly design: DesignService,
    private readonly documents: DocumentsService,
    private readonly runs: JobRunsService,
  ) {}

  async start(projectId: string, applicationId: string, selection: DesignSelection, actor: Actor): Promise<JobRunView> {
    if (selection.resumeOf !== undefined) {
      const previous = await this.runs.summary(projectId, selection.resumeOf);
      if (previous.name !== DESIGN || previous.applicationId !== applicationId) throw new BadRequestException(`Job run ${selection.resumeOf} is not a design run of ${applicationId}`);
      return this.runs.retry(projectId, selection.resumeOf, actor);
    }
    const set = selection.set ?? "";
    const wanted = [...new Set(selection.units ?? [])].sort();
    if (set === "" || wanted.length === 0) throw new BadRequestException("Name the design set and at least one unit");

    const overview = await this.design.overview(projectId, applicationId, undefined);
    const sets = await this.design.sets(projectId, overview.ref.commit, applicationId);
    if (!sets.sets.some((entry) => entry.id === set)) throw new BadRequestException({ message: `The project defines no design set "${set}" (${designSetDir(set)}/)`, details: { set } });
    const faults = sets.problems.filter((problem) => problem.path.startsWith(`${designSetDir(set)}/`));
    if (faults.length > 0) {
      throw new ConflictException({ message: `The design set "${set}" has ${faults.length} fault(s) in its definition: ${faults[0]!.path}: ${faults[0]!.message}`, details: { problems: faults.slice(0, 20) } });
    }

    const forApplication = sets.sets.find((entry) => entry.id === set)?.scope === "application";
    const byKey = new Map(overview.units.map((unit) => [unit.key, unit]));
    if (forApplication) {
      if (wanted.length !== 1 || wanted[0] !== APPLICATION_UNIT_KEY) {
        throw new BadRequestException({ message: `The design set "${set}" is for the application as a whole: select ${APPLICATION_UNIT_KEY} only`, details: { set, notApplicable: wanted.filter((key) => key !== APPLICATION_UNIT_KEY) } });
      }
    } else {
      const unknown = wanted.filter((key) => key !== APPLICATION_UNIT_KEY && !byKey.has(key));
      const notApplicable = wanted.filter((key) => key === APPLICATION_UNIT_KEY || (byKey.has(key) && byKey.get(key)!.sets[set] === undefined));
      if (unknown.length > 0 || notApplicable.length > 0) {
        throw new BadRequestException({
          message: `Unknown units, or units the set "${set}" does not apply to: ${[...unknown, ...notApplicable].slice(0, 20).join(", ")}`,
          details: { unknown, notApplicable },
        });
      }
    }

    const regenerate = selection.regenerate === true;
    const draft = selection.draft === true;
    const busy = new Map((await this.activity(projectId, applicationId)).items.filter((item) => item.set === set).map((item) => [item.unit, item]));
    const needs = overview.sets.find((entry) => entry.id === set)?.needs ?? [];
    const conflicts = wanted.flatMap((key): Conflict[] => {
      const active = busy.get(key);
      if (active !== undefined) return [{ unit: key, state: active.state, runId: active.runId }];
      const summary = forApplication ? overview.application.sets[set] : byKey.get(key)!.sets[set];
      if (summary === undefined) return [];
      if (summary.draftAllowed === false) return [{ unit: key, state: "not-ready", reasons: ["The unit is not active in the merged catalog; assess and merge its scope first."] }];
      if (!draft && (summary.blockers?.length ?? 0) > 0) return [{ unit: key, state: "not-ready", reasons: summary.blockers! }];
      // A regeneration needs a design to replace; a first design needs the sets it builds on and no design yet.
      if (regenerate) return summary.files.conformant + summary.files.problems > 0 ? [] : [{ unit: key, state: "unwritten" }];
      if (summary.ready || (draft && summary.files.conformant + summary.files.problems === 0)) return [];
      return [summary.state === "missing" ? { unit: key, state: "needs", needs } : { unit: key, state: "written" }];
    });
    if (conflicts.length > 0) {
      throw new ConflictException({
        message: `${conflicts.length} selected unit(s) cannot be ${regenerate ? "regenerated" : "designed"} now: ${conflicts
          .slice(0, 10)
          .map((conflict) => `${conflict.unit} ${reasonOf(conflict)}`)
          .join("; ")} (abandon a closed pull request to release its units)`,
        details: { conflicts },
      });
    }
    // Pinned: the default branch tip the overview was read at.
    return this.runs.startRun(projectId, applicationId, DESIGN, actor, { inputs: { scope: { items: wanted, files: [], set, ...(regenerate ? { regenerate: true } : {}), ...(draft ? { draft: true } : {}) }, documentsCommit: overview.ref.commit } });
  }

  /** The units a run is generating or a pull request carries, per design set: what a new selection cannot take. */
  async activity(projectId: string, applicationId: string): Promise<DesignActivityView> {
    const context = await this.documents.context(projectId);
    const page = await this.runs.list(projectId, applicationId, { limit: RECENT_RUNS, offset: 0 });
    const designRuns = page.items.filter((run) => run.kind === "stage" && run.name === DESIGN && run.scope?.set !== undefined);
    if (designRuns.length === 0) return { items: [] };
    const { tips, defaultTip } = await this.documents.branchTips(context);
    const items: UnitSetActivity[] = [];
    for (const run of designRuns) {
      const set = run.scope!.set!;
      if (run.status === "queued" || run.status === "running") {
        items.push(...run.scope!.items.map((unit): UnitSetActivity => ({ unit, set, state: "running", runId: run.id })));
      } else if (run.status === "succeeded" && run.documentWrite?.status === "pr-opened" && run.abandonedAt === undefined) {
        const ref = await this.documents.runRef(context, run, tips, defaultTip);
        if (ref?.status !== "open") continue;
        const pr = ref.branch === undefined ? {} : { pr: { branch: ref.branch, ...(run.documentWrite.prUrl === undefined ? {} : { url: run.documentWrite.prUrl }) } };
        items.push(...run.scope!.items.map((unit): UnitSetActivity => ({ unit, set, state: "in-pr", runId: run.id, ...pr })));
      }
    }
    return { items };
  }
}
