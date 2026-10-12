// Interface layer: runtime job runs of a project (ADR-0027, ADR-0029). Starting and cancelling
// need jobs.run; reading runs and following their live events needs a session; restricted
// records need restricted.read.

import { Controller, Get, Headers, HttpCode, Param, Post, Query, Req, Res } from "@nestjs/common";
import { ApiAcceptedResponse, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import type { Page } from "#common/application/pagination.js";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import { openEventStream } from "#common/interface/sse.js";
import { JobRunsService } from "../application/job-runs.service.js";
import type { JobRunDetail, JobRunView, RestrictedRecordView } from "../domain/job-run.js";
import { type JobRunEventsQuery, type ListJobRunsQuery, eventIdSchema, jobRunEventsQuerySchema, listJobRunsQuerySchema } from "./job-run.dto.js";

@ApiTags("delivery · runtime jobs")
@Controller("projects/:id")
export class JobRunsController {
  constructor(private readonly runs: JobRunsService) {}

  @RequirePermission("jobs.run")
  @Post("applications/:appId/stages/:stage/run")
  @HttpCode(202)
  @ApiOperation({ summary: "Run a pipeline stage for an application (queued); 409 when it cannot start yet" })
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

  @RequirePermission("jobs.run")
  @Post("job-runs/:runId/cancel")
  @HttpCode(200)
  @ApiOperation({ summary: "Cancel a job run: a queued run at once, a running one by the worker (its processes are killed)" })
  @ApiOkResponse({ description: "The run: `cancelled`, or `running` with cancelRequestedAt until the worker has stopped it. 409 when it has already finished." })
  cancel(@Param("id") id: string, @Param("runId") runId: string, @CurrentActor() actor: Actor): Promise<JobRunView> {
    return this.runs.cancel(id, runId, actor);
  }

  @RequirePermission("jobs.run")
  @Post("job-runs/:runId/retry")
  @HttpCode(202)
  @ApiOperation({ summary: "Retry a failed stage run: a new run on the same commits and scope that skips the agent steps that succeeded (ADR-0033)" })
  @ApiAcceptedResponse({ description: "The queued retry; 409 unless the run failed." })
  retry(@Param("id") id: string, @Param("runId") runId: string, @CurrentActor() actor: Actor): Promise<JobRunView> {
    return this.runs.retry(id, runId, actor);
  }

  @RequirePermission("jobs.run")
  @Post("job-runs/:runId/abandon")
  @HttpCode(200)
  @ApiOperation({ summary: "Abandon the pull request of an understand run that was closed without merging: its items are released (ADR-0033)" })
  @ApiOkResponse({ description: "The run with abandonedAt; 409 when it has no pull request or was abandoned already." })
  abandon(@Param("id") id: string, @Param("runId") runId: string, @CurrentActor() actor: Actor): Promise<JobRunView> {
    return this.runs.abandon(id, runId, actor);
  }

  @Get("job-runs/:runId/events")
  @ApiProduces("text/event-stream")
  @ApiOperation({
    summary: "Follow a job run live (Server-Sent Events)",
    description:
      "Events: `job-event` (a JobRunEventView; its id is the SSE id), `status` (the run, when its status changes), `end` (the finished run; the stream closes). " +
      "Resume with Last-Event-ID or ?after=<event id>. Errors before the stream opens use the uniform envelope.",
  })
  async events(
    @Param("id") id: string,
    @Param("runId") runId: string,
    @Query({ schema: jobRunEventsQuerySchema }) query: JobRunEventsQuery,
    @Headers("last-event-id") lastEventId: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.runs.summary(id, runId); // 404 as an envelope, before the stream opens
    const resume = eventIdSchema.safeParse(lastEventId);
    const after = resume.success ? resume.data : query.after;
    const stream = openEventStream(request, response);
    try {
      for await (const update of this.runs.follow(id, runId, after, stream.signal)) {
        if (update.type === "event") stream.send("job-event", update.event, update.event.id);
        else stream.send(update.type, update.run);
      }
    } catch {
      stream.send("error", { message: "The event stream failed; reconnect to resume." });
    } finally {
      stream.close();
    }
  }

  @RequirePermission("restricted.read")
  @Get("job-runs/:runId/restricted")
  @ApiOperation({ summary: "Read the restricted records of a job run and its steps (never committed to Git); every read is audited" })
  @ApiOkResponse({ description: "The decrypted restricted files." })
  restricted(@Param("id") id: string, @Param("runId") runId: string, @CurrentActor() actor: Actor): Promise<RestrictedRecordView[]> {
    return this.runs.restricted(id, runId, actor);
  }
}
