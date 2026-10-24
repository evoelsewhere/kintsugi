// Interface layer: the units members build and the review of their merge requests (ADR-0071). Reading needs a session, like
// the documents it comes from; starting a review needs `jobs.run`.

import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { ApiAcceptedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import type { JobRunView } from "#modules/delivery/runtime-jobs/index.js";
import { BuildReviewsService } from "../application/build-reviews.service.js";
import { BuildService } from "../application/build.service.js";
import type { BuildOverviewView } from "../domain/build.js";
import { type ReviewRunInput, reviewRunSchema } from "./build.dto.js";

@ApiTags("delivery · build")
@Controller("projects/:id/applications/:appId/build")
export class BuildController {
  constructor(
    private readonly build: BuildService,
    private readonly reviews: BuildReviewsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Every designed unit with what a member recorded for it, its merge request and the state of its review",
    description:
      "The implementation and the unit tests are the member's, made on their machine with the member command `build`; Kintsugi only collects which unit was built in which merge request (`build.mr` records: the merge request, its branch and head commit, and the counts of the last test run). The review is the runtime's. Derived on every read: the published `_build/review.md` of a unit, the runs of the application and the member's records; the names of members are included for a reader with `member.activity.view`.",
  })
  @ApiOkResponse({ description: "The target repositories, the units (designed or not, the member's record, the review) and the merge requests with their units." })
  overview(@Param("id") id: string, @Param("appId") appId: string, @CurrentActor() actor: Actor): Promise<BuildOverviewView> {
    return this.build.overview(id, appId, { memberUsers: actor.permissions.includes("member.activity.view") });
  }

  @RequirePermission("jobs.run")
  @Post("reviews")
  @HttpCode(202)
  @ApiOperation({
    summary: "Review the merge request a member recorded for some units",
    description:
      "The units of one merge request at one commit and the target repository it is on (ADR-0071). The runtime reads the repository at that commit, writes no code, and proposes the findings as `_build/review.md` per unit in a pull request on the document repository. 400 for an unknown unit, a unit without a merged design, or a target the application does not have; 409 when a unit has no merge request recorded, the units span several merge requests, or a unit is being reviewed or has an open review pull request; 422 above the units cap of a run.",
  })
  @ApiAcceptedResponse({ description: "The queued review run." })
  review(@Param("id") id: string, @Param("appId") appId: string, @Body({ schema: reviewRunSchema }) body: ReviewRunInput, @CurrentActor() actor: Actor): Promise<JobRunView> {
    return this.reviews.start(id, appId, body, actor);
  }
}
