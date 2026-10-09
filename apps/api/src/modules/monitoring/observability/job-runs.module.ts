// Wiring of the job-runs module: interface + application + the
// infrastructure adapter bound to the domain port.

import { Module } from "@nestjs/common";
import { JobRunsService } from "./application/job-runs.service.js";
import { JobRunRepository } from "./domain/job-run.repository.js";
import { InMemoryJobRunRepository } from "./infrastructure/in-memory-job-run.repository.js";
import { JobRunsController } from "./interface/job-runs.controller.js";

/** monitoring · agent observability — docs/architecture/05-building-block-view.md. */
@Module({
  controllers: [JobRunsController],
  providers: [JobRunsService, { provide: JobRunRepository, useClass: InMemoryJobRunRepository }],
  exports: [JobRunsService, JobRunRepository],
})
export class JobRunsModule {}
