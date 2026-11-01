// Interface layer: job runs across projects (the runs overview), read-only. A session is enough, and the list shows
// the runs of the projects the caller holds Project Access on (ADR-0099 decision 4).

import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Page } from "#common/application/pagination.js";
import { type Actor, CurrentActor } from "#common/auth/decorators.js";
import { ProjectAccessService } from "#modules/admin/project-access/index.js";
import { JobRunsService } from "../application/job-runs.service.js";
import type { JobRunView } from "../domain/job-run.js";
import { type ListAllJobRunsQuery, listAllJobRunsQuerySchema } from "./job-run.dto.js";

@ApiTags("delivery · runtime jobs")
@Controller("job-runs")
export class AllJobRunsController {
  constructor(
    private readonly runs: JobRunsService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List top-level job runs across projects, newest first (filter by status list, project, application)" })
  @ApiOkResponse({ description: "A page of top-level job runs." })
  async list(@Query({ schema: listAllJobRunsQuerySchema }) query: ListAllJobRunsQuery, @CurrentActor() actor: Actor): Promise<Page<JobRunView>> {
    return this.runs.listAll(
      {
        projectIds: await this.access.readableProjectIds(actor.id),
        ...(query.status === undefined ? {} : { statuses: query.status }),
        ...(query.projectId === undefined ? {} : { projectId: query.projectId }),
        ...(query.applicationId === undefined ? {} : { applicationId: query.applicationId }),
      },
      { limit: query.limit, offset: query.offset },
    );
  }
}
