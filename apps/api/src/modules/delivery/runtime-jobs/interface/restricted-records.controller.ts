// Interface layer: the restricted records across projects (governance), metadata only — never
// the content, so the list is not audited. Needs restricted.read; opening a record stays the
// audited GET /projects/:id/job-runs/:runId/restricted.

import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Page } from "#common/application/pagination.js";
import { RequirePermission } from "#common/auth/decorators.js";
import { JobRunsService } from "../application/job-runs.service.js";
import type { RestrictedRecordSummary } from "../domain/job-run.js";
import { type ListRestrictedRecordsQuery, listRestrictedRecordsQuerySchema } from "./job-run.dto.js";

@ApiTags("governance · restricted records")
@Controller("governance/restricted-records")
@RequirePermission("restricted.read")
export class RestrictedRecordsController {
  constructor(private readonly runs: JobRunsService) {}

  @Get()
  @ApiOperation({ summary: "List restricted records, newest first: run, step, path, size (never the content)" })
  @ApiOkResponse({ description: "A page of restricted record summaries." })
  list(@Query({ schema: listRestrictedRecordsQuerySchema }) query: ListRestrictedRecordsQuery): Promise<Page<RestrictedRecordSummary>> {
    return this.runs.listRestricted(
      {
        ...(query.projectId === undefined ? {} : { projectId: query.projectId }),
        ...(query.jobRunId === undefined ? {} : { jobRunId: query.jobRunId }),
      },
      { limit: query.limit, offset: query.offset },
    );
  }
}
