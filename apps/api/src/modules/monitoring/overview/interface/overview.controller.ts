// Interface layer: the monitoring overview and the repository sync view, read-only. Need a
// session (no permission code), like the other monitoring reads.

import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { OverviewService } from "../application/overview.service.js";
import type { MonitoredRepository, MonitoringOverview, WorkerStatus } from "../domain/overview.js";

@ApiTags("monitoring · overview")
@Controller("monitoring")
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  @Get("overview")
  @ApiOperation({ summary: "What the installation is doing: counts, what needs attention, recent activity and the worker's queues" })
  @ApiOkResponse({ description: "The overview; `worker.queues` is null when the job queue cannot be read." })
  get(): Promise<MonitoringOverview> {
    return this.overview.overview();
  }

  @Get("workers")
  @ApiOperation({ summary: "List worker processes from their heartbeats: host, pid, version, last beat, active jobs, queues and state (up when seen < 45 s ago)" })
  @ApiOkResponse({ description: "The workers, the latest beat first." })
  workers(): Promise<WorkerStatus[]> {
    return this.overview.workers();
  }

  @Get("repositories")
  @ApiOperation({ summary: "List registered repositories with their sync state and the projects that use them (never credentials)" })
  @ApiOkResponse({ description: "The repositories, ordered by id." })
  repositories(): Promise<MonitoredRepository[]> {
    return this.overview.repositories();
  }
}
