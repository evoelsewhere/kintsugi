import { Controller, Get, Param } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JobRunsService } from "./job-runs.service.js";
import type { JobRun } from "./job-run.dto.js";

@ApiTags("monitoring · agent observability")
@Controller("monitoring/observability")
export class JobRunsController {
  constructor(private readonly jobRuns: JobRunsService) {}

  @Get()
  @ApiOperation({ summary: "List job runs" })
  @ApiOkResponse({ description: "The matching job-run records." })
  list(): Promise<JobRun[]> {
    return this.jobRuns.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one job-run" })
  @ApiOkResponse({ description: "The job-run." })
  get(@Param("id") id: string): Promise<JobRun> {
    return this.jobRuns.get(id);
  }
}
