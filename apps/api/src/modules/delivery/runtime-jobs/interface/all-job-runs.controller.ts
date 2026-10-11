// Interface layer: job runs across projects (the runs overview), read-only. Needs a session,
// like the project-scoped list.

import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Page } from "#common/application/pagination.js";
import { JobRunsService } from "../application/job-runs.service.js";
import type { JobRunView } from "../domain/job-run.js";
import { type ListAllJobRunsQuery, listAllJobRunsQuerySchema } from "./job-run.dto.js";

@ApiTags("delivery · runtime jobs")
@Controller("job-runs")
export class AllJobRunsController {
  constructor(private readonly runs: JobRunsService) {}

  @Get()
  @ApiOperation({ summary: "List top-level job runs across projects, newest first (filter by status list, project, application)" })
  @ApiOkResponse({ description: "A page of top-level job runs." })
  list(@Query({ schema: listAllJobRunsQuerySchema }) query: ListAllJobRunsQuery): Promise<Page<JobRunView>> {
    return this.runs.listAll(
      {
        ...(query.status === undefined ? {} : { statuses: query.status }),
        ...(query.projectId === undefined ? {} : { projectId: query.projectId }),
        ...(query.applicationId === undefined ? {} : { applicationId: query.applicationId }),
      },
      { limit: query.limit, offset: query.offset },
    );
  }
}
