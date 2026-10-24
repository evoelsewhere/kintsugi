// Application layer: starting the review of a member's merge request on the portal (ADR-0071). A run is the units of one merge
// request at one commit, as the member recorded them with the member command `build`, and one target repository; it is pinned to the
// commit of the document repository the overview was read at and reads the target repository at the head commit of the merge request.
// A unit the member recorded nothing for, a selection that spans several merge requests, a unit another review is working on or has an
// open pull request for, blocks the selection with a 409 that names each.

import { BadRequestException, ConflictException, Injectable, UnprocessableEntityException } from "@nestjs/common";
import type { Actor } from "#common/auth/decorators.js";
import { JobRunsService, type JobRunView, REVIEW } from "#modules/delivery/runtime-jobs/index.js";
import type { ReviewRunBody } from "../domain/build.js";
import { BuildService } from "./build.service.js";

/** Units per run: a reviewer job each, and a pull request a person can read. */
export const MAX_REVIEW_UNITS_PER_RUN = 20;
const DEFAULT_STAGE_MAX_AGENTS = 200;

/** KINTSUGI_STAGE_MAX_AGENTS, the worker's agent cap per stage run: one reviewer job per unit. */
function stageMaxAgents(): number {
  const value = Number(process.env["KINTSUGI_STAGE_MAX_AGENTS"]);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_STAGE_MAX_AGENTS;
}

interface Conflict {
  unit: string;
  reason: string;
}

@Injectable()
export class BuildReviewsService {
  constructor(
    private readonly build: BuildService,
    private readonly runs: JobRunsService,
  ) {}

  async start(projectId: string, applicationId: string, body: ReviewRunBody, actor: Actor): Promise<JobRunView> {
    const wanted = [...new Set(body.units)].sort();
    const overview = await this.build.overview(projectId, applicationId, { memberUsers: false });
    const byKey = new Map(overview.units.map((unit) => [unit.key, unit]));

    const unknown = wanted.filter((key) => !byKey.has(key));
    const undesigned = wanted.filter((key) => byKey.has(key) && !byKey.get(key)!.designed);
    if (unknown.length > 0 || undesigned.length > 0) {
      throw new BadRequestException({ message: `Unknown units, or units without a merged design: ${[...unknown, ...undesigned].slice(0, 20).join(", ")}`, details: { unknown, undesigned } });
    }

    const target = overview.targets.find((entry) => entry.repositoryId === body.target) ?? (body.target === undefined && overview.targets.length === 1 ? overview.targets[0] : undefined);
    if (target === undefined) {
      throw new BadRequestException(
        body.target === undefined && overview.targets.length > 1
          ? { message: `Name the target repository the merge request is on: ${overview.targets.map((entry) => entry.repositoryId).join(", ")}`, details: { targets: overview.targets.map((entry) => entry.repositoryId) } }
          : { message: body.target === undefined ? `Application ${applicationId} has no target repository; link one first` : `Repository ${body.target} is not a target repository of application ${applicationId}` },
      );
    }

    const cap = Math.min(MAX_REVIEW_UNITS_PER_RUN, Math.max(1, stageMaxAgents()));
    if (wanted.length > cap) {
      throw new UnprocessableEntityException({ message: `${wanted.length} units selected: a run takes at most ${cap}; split the selection`, details: { selected: wanted.length, max: cap } });
    }

    const conflicts = wanted.flatMap((key): Conflict[] => {
      const row = byKey.get(key)!;
      if (row.member?.mr === undefined || row.member.commit === undefined) return [{ unit: key, reason: "has no merge request recorded: the member records it with the member command build" }];
      if (row.review.state === "running") return [{ unit: key, reason: "is being reviewed" }];
      if (row.review.state === "in-pr") return [{ unit: key, reason: "has an open pull request of its review" }];
      return [];
    });
    const requests = new Map(wanted.flatMap((key) => (byKey.get(key)?.member?.mr === undefined ? [] : [[`${byKey.get(key)!.member!.mr}\u0000${byKey.get(key)!.member!.commit}`, byKey.get(key)!.member!] as const])));
    if (conflicts.length === 0 && requests.size > 1) {
      conflicts.push(...wanted.map((key): Conflict => ({ unit: key, reason: `is in ${byKey.get(key)!.member!.mr} at ${byKey.get(key)!.member!.commit!.slice(0, 12)}: review one merge request at a time` })));
    }
    if (conflicts.length > 0) {
      throw new ConflictException({
        message: `${conflicts.length} selected unit(s) cannot be reviewed now: ${conflicts
          .slice(0, 10)
          .map((conflict) => `${conflict.unit} ${conflict.reason}`)
          .join("; ")}`,
        details: { conflicts },
      });
    }

    const request = [...requests.values()][0]!;
    // Pinned: the default branch tip the overview was read at, and the head commit of the merge request.
    return this.runs.startRun(projectId, applicationId, REVIEW, actor, {
      pins: { [target.repositoryId]: request.commit! },
      inputs: {
        scope: { items: wanted, files: [], target: target.repositoryId, mr: { url: request.mr!, commit: request.commit!, ...(request.branch === undefined ? {} : { branch: request.branch }) } },
        documentsCommit: overview.ref.commit,
      },
    });
  }
}
