// Wiring of the runtime jobs module: the use cases plus the Postgres store and the pg-boss
// queue bound to the domain ports. Projects come from the projects module.

import { Module } from "@nestjs/common";
import { ProjectsModule } from "#modules/admin/projects/index.js";
import { JobRunsService } from "./application/job-runs.service.js";
import { JobRunQueue, JobRunStore } from "./domain/job-run.ports.js";
import { PgBossJobRunQueue } from "./infrastructure/pg-boss-job-run.queue.js";
import { PgJobRunStore } from "./infrastructure/pg-job-run.store.js";
import { JobRunsController } from "./interface/job-runs.controller.js";

/** delivery · runtime jobs (B1 + E1/E4, ADR-0029): the API records and enqueues, the worker runs. */
@Module({
  imports: [ProjectsModule],
  controllers: [JobRunsController],
  providers: [JobRunsService, { provide: JobRunStore, useClass: PgJobRunStore }, { provide: JobRunQueue, useClass: PgBossJobRunQueue }],
  exports: [JobRunsService],
})
export class RuntimeJobsModule {}
