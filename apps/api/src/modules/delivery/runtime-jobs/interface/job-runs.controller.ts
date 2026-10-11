// Interface layer: runtime job runs of a project (ADR-0027, ADR-0029). Starting a stage needs
// jobs.run; reading runs needs a session; restricted records need restricted.read.

import { Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { ApiAcceptedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Page } from "#common/application/pagination.js";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import { JobRunsService } from "../application/job-runs.service.js";
import type { JobRunDetail, JobRunView, RestrictedRecordView } from "../domain/job-run.js";
import { type ListJobRunsQuery, listJobRunsQuerySchema } from "./job-run.dto.js";

@ApiTags("delivery · runtime jobs")
@Controller("projects/:id")
export class JobRunsController {
  constructor(private readonly runs: JobRunsService) {}

  @RequirePermission("jobs.run")
  @Post("applications/:appId/stages/:stage/run")
  @HttpCode(202)
  @ApiOperation({ summary: "Run a pipeline stage for an application (queued; first milestone: assess)" })
  @ApiAcceptedResponse({ description: "The queued stage run." })
  run(@Param("id") id: string, @Param("appId") appId: string, @Param("stage") stage: string, @CurrentActor() actor: Actor): Promise<JobRunView> {
    return this.runs.runStage(id, appId, stage, actor);
  }

  @Get("job-runs")
  @ApiOperation({ summary: "List the project's job runs, newest first: status, failure reason, document write" })
  @ApiOkResponse({ description: "A page of top-level job runs." })
  list(@Param("id") id: string, @Query({ schema: listJobRunsQuerySchema }) query: ListJobRunsQuery): Promise<Page<JobRunView>> {
    return this.runs.list(id, query.applicationId, { limit: query.limit, offset: query.offset });
  }

  @Get("job-runs/:runId")
  @ApiOperation({ summary: "Get a job run with its steps and artifacts" })
  @ApiOkResponse({ description: "The run, its steps (child runs) and the artifact index." })
  get(@Param("id") id: string, @Param("runId") runId: string): Promise<JobRunDetail> {
    return this.runs.get(id, runId);
  }

  @RequirePermission("restricted.read")
  @Get("job-runs/:runId/restricted")
  @ApiOperation({ summary: "Read the restricted records of a job run and its steps (never committed to Git)" })
  @ApiOkResponse({ description: "The decrypted restricted files." })
  restricted(@Param("id") id: string, @Param("runId") runId: string): Promise<RestrictedRecordView[]> {
    return this.runs.restricted(id, runId);
  }
}
