// Interface layer: thin HTTP adapter — validates input, maps DTOs to application
// commands, delegates to the use cases. No business logic here.

import { Controller, Get, Param } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { JobRun } from "../domain/job-run.js";
import { JobRunsService } from "../application/job-runs.service.js";

@ApiTags("monitoring · agent observability")
@Controller("monitoring/observability")
export class JobRunsController {
  constructor(private readonly jobRuns: JobRunsService) {}

  @Get()
  @ApiOperation({ summary: "List job runs" })
  @ApiOkResponse({ description: "The matching records." })
  list(): Promise<JobRun[]> {
    return this.jobRuns.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one job run" })
  @ApiOkResponse({ description: "The record." })
  get(@Param("id") id: string): Promise<JobRun> {
    return this.jobRuns.get(id);
  }
}
