// Application layer: where the designed units of an application stand after the design (ADR-0071): what the member who
// built a unit recorded (the merge request and its head commit, the cases and the canary of their last run) and what the
// independent review of that merge request found. Nothing here is stored: the review is a document on the default branch
// (front matter a script wrote), the member's record is an activity row, a running review is a job run.

import { Injectable } from "@nestjs/common";
import { unitCodeReviewPath } from "@kintsugi/domain";
import { chunk } from "#common/util/async.js";
import { ProjectsService } from "#modules/admin/projects/index.js";
import { DesignService } from "#modules/delivery/design/index.js";
import { type DocumentContext, DocumentsService } from "#modules/delivery/documents/index.js";
import { JobRunsService, type JobRunView, REVIEW } from "#modules/delivery/runtime-jobs/index.js";
import { MemberActivityService } from "#modules/monitoring/member-activity/index.js";
import type { BuildOverviewView, BuildTargetView, MemberBuild, MergeRequestView, UnitBuildRow, UnitReview } from "../domain/build.js";

const READ_AT_ONCE = 8;
const RECENT_RUNS = 200;
const RECENT_ACTIVITY = 500;
const MEMBER_PLUGIN = "modernize";
const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const HTTP_URL = /^https?:\/\/[^\s<>"']{1,480}$/i;

/** The scalar fields of a document's front matter: `key: value` lines, JSON-quoted strings, numbers and booleans. */
function frontMatter(text: string | undefined): Record<string, string | number | boolean> {
  if (text === undefined) return {};
  const match = /^---\n([\s\S]*?)\n---/.exec(text.replace(/\r\n/g, "\n"));
  if (match === null) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const line of match[1]!.split("\n")) {
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (pair === null || pair[2] === "") continue;
    try {
      const value: unknown = JSON.parse(pair[2]!);
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[pair[1]!] = value;
    } catch {
      out[pair[1]!] = pair[2]!;
    }
  }
  return out;
}

const numberOf = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const textOf = (value: unknown, max: number): string | undefined => (typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined);

/** What a record of a member holds that Kintsugi shows: only well-formed values, a link only when it is an http(s) URL. */
export function memberBuildOf(record: { at: string; username: string; harness?: string; detail: Record<string, unknown> }, withUser: boolean): MemberBuild {
  const mr = textOf(record.detail["mr"], 500);
  const commit = textOf(record.detail["commit"], 64);
  const branch = textOf(record.detail["branch"], 200);
  const cases = numberOf(record.detail["cases"]);
  const failed = numberOf(record.detail["failed"]);
  const canary = record.detail["canary"] === "killed" || record.detail["canary"] === "survived" ? record.detail["canary"] : undefined;
  return {
    ...(mr !== undefined && HTTP_URL.test(mr) ? { mr } : {}),
    ...(branch === undefined ? {} : { branch }),
    ...(commit !== undefined && COMMIT.test(commit) ? { commit } : {}),
    ...(cases === undefined ? {} : { cases }),
    ...(failed === undefined ? {} : { failed }),
    ...(canary === undefined ? {} : { canary }),
    at: record.at,
    ...(withUser ? { username: record.username } : {}),
    ...(record.harness === undefined ? {} : { harness: record.harness }),
  };
}

@Injectable()
export class BuildService {
  constructor(
    private readonly design: DesignService,
    private readonly documents: DocumentsService,
    private readonly runs: JobRunsService,
    private readonly projects: ProjectsService,
    private readonly activity: MemberActivityService,
  ) {}

  /** The target repositories of an application. */
  async targets(projectId: string, applicationId: string): Promise<BuildTargetView[]> {
    const application = (await this.projects.getProject(projectId)).applications.find((entry) => entry.id === applicationId);
    return (application?.toBe.targets ?? []).map((target) => ({ repositoryId: target.repositoryId, ...(target.component === undefined ? {} : { component: target.component }) }));
  }

  /** Reviews that are running or whose pull request is open, per unit. */
  private async activeReviews(projectId: string, applicationId: string, context: DocumentContext): Promise<Map<string, UnitReview>> {
    const page = await this.runs.list(projectId, applicationId, { limit: RECENT_RUNS, offset: 0 });
    const active = new Map<string, UnitReview>();
    const { tips, defaultTip } = await this.documents.branchTips(context);
    for (const run of page.items) {
      if (run.kind !== "stage" || run.name !== REVIEW || run.scope === undefined) continue;
      const view = await this.reviewOf(run, context, tips, defaultTip);
      if (view === undefined) continue;
      for (const unit of run.scope.items) if (!active.has(unit)) active.set(unit, view);
    }
    return active;
  }

  private async reviewOf(run: JobRunView, context: DocumentContext, tips: Parameters<DocumentsService["runRef"]>[2], defaultTip: Parameters<DocumentsService["runRef"]>[3]): Promise<UnitReview | undefined> {
    if (run.status === "queued" || run.status === "running") return { state: "running", runId: run.id };
    if (run.status !== "succeeded" || run.abandonedAt !== undefined || run.documentWrite?.status !== "pr-opened") return undefined;
    if ((await this.documents.runRef(context, run, tips, defaultTip))?.status !== "open") return undefined;
    return { state: "in-pr", runId: run.id, ...(run.documentWrite.prUrl === undefined ? {} : { prUrl: run.documentWrite.prUrl }) };
  }

  /** The newest `build.*` record of a member for each unit (the summary of a record is the unit key), the merge request one first. */
  async memberBuilds(projectId: string, withUser: boolean): Promise<Map<string, MemberBuild>> {
    const page = await this.activity.list({ projectId, pluginName: MEMBER_PLUGIN, limit: RECENT_ACTIVITY, offset: 0 });
    const latest = new Map<string, MemberBuild>();
    const tests = new Map<string, MemberBuild>();
    for (const record of page.items) {
      if (!record.kind.startsWith("build.")) continue;
      const build = memberBuildOf(record, withUser);
      if (record.kind === "build.mr" && build.mr !== undefined && build.commit !== undefined && !latest.has(record.summary)) latest.set(record.summary, build);
      else if (record.kind === "build.test" && !tests.has(record.summary)) tests.set(record.summary, build);
    }
    // A merge request without the numbers of its own gets those of the last test run recorded for the unit.
    for (const [unit, build] of latest) {
      const test = tests.get(unit);
      if (test === undefined) continue;
      latest.set(unit, { ...build, ...(build.cases === undefined && test.cases !== undefined ? { cases: test.cases } : {}), ...(build.failed === undefined && test.failed !== undefined ? { failed: test.failed } : {}), ...(build.canary === undefined && test.canary !== undefined ? { canary: test.canary } : {}) });
    }
    return latest;
  }

  async overview(projectId: string, applicationId: string, options: { memberUsers: boolean }): Promise<BuildOverviewView> {
    const [design, context] = await Promise.all([this.design.overview(projectId, applicationId, undefined), this.documents.context(projectId)]);
    const commit = design.ref.commit;
    const [targets, active, member] = await Promise.all([this.targets(projectId, applicationId), this.activeReviews(projectId, applicationId, context), this.memberBuilds(projectId, options.memberUsers)]);

    const rows: UnitBuildRow[] = [];
    for (const group of chunk(design.units, READ_AT_ONCE)) {
      rows.push(
        ...(await Promise.all(
          group.map(async (unit): Promise<UnitBuildRow> => {
            const designed = Object.values(unit.sets).some((set) => set.files.total - set.files.missing > 0);
            const recorded = member.get(unit.key);
            const busy = active.get(unit.key);
            const published = frontMatter(await this.documents.readText(context, commit, unitCodeReviewPath(applicationId, unit.key)));
            const reviewedCommit = typeof published["commit"] === "string" ? published["commit"] : undefined;
            const review: UnitReview =
              busy ??
              (published["reviewed"] === "true"
                ? {
                    state: "reviewed",
                    ...(numberOf(published["blockers"]) === undefined ? {} : { blockers: numberOf(published["blockers"])! }),
                    ...(numberOf(published["majors"]) === undefined ? {} : { majors: numberOf(published["majors"])! }),
                    ...(numberOf(published["minors"]) === undefined ? {} : { minors: numberOf(published["minors"])! }),
                    ...(recorded?.commit !== undefined && reviewedCommit !== undefined && recorded.commit !== reviewedCommit ? { stale: true } : {}),
                  }
                : { state: "none" });
            return {
              key: unit.key,
              module: unit.module,
              unit: unit.unit,
              kind: unit.kind,
              ...(unit.title === undefined ? {} : { title: unit.title }),
              designed,
              rules: unit.rules.total,
              ...(recorded === undefined ? {} : { member: recorded }),
              review,
            };
          }),
        )),
      );
    }
    return { ref: design.ref, targets, units: rows, mergeRequests: mergeRequestsOf(rows) };
  }
}

/** The merge requests the members recorded, each with its units; a unit that moved to a newer commit is in the newer merge request only. */
export function mergeRequestsOf(rows: readonly UnitBuildRow[]): MergeRequestView[] {
  const byRequest = new Map<string, MergeRequestView>();
  for (const row of rows) {
    const record = row.member;
    if (!row.designed || record?.mr === undefined || record.commit === undefined) continue;
    const key = `${record.mr}\u0000${record.commit}`;
    const existing = byRequest.get(key) ?? { url: record.mr, ...(record.branch === undefined ? {} : { branch: record.branch }), commit: record.commit, units: [], reviewed: true };
    existing.units.push(row.key);
    if (row.review.state !== "reviewed" || row.review.stale === true) existing.reviewed = false;
    byRequest.set(key, existing);
  }
  return [...byRequest.values()].sort((a, b) => a.url.localeCompare(b.url) || a.commit.localeCompare(b.commit));
}
