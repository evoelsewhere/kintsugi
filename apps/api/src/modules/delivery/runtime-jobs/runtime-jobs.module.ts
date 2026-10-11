// Wiring of the runtime jobs module: the use cases plus the Postgres store, the pg-boss queue
// and the built-in stage catalog bound to the domain ports. Projects come from the projects module.

import { Module } from "@nestjs/common";
import { ProjectsModule } from "#modules/admin/projects/index.js";
import { JobRunsService } from "./application/job-runs.service.js";
import { StagesService } from "./application/stages.service.js";
import { JobRunQueue, JobRunStore, StageCatalog } from "./domain/job-run.ports.js";
import { BuiltinStageCatalog } from "./infrastructure/builtin-stage.catalog.js";
import { PgBossJobRunQueue } from "./infrastructure/pg-boss-job-run.queue.js";
import { PgJobRunStore } from "./infrastructure/pg-job-run.store.js";
import { AllJobRunsController } from "./interface/all-job-runs.controller.js";
import { JobRunsController } from "./interface/job-runs.controller.js";
import { RestrictedRecordsController } from "./interface/restricted-records.controller.js";
import { StagesController } from "./interface/stages.controller.js";

/** delivery · runtime jobs (B1 + E1/E4, ADR-0029): the API records and enqueues, the worker runs. */
@Module({
  imports: [ProjectsModule],
  controllers: [JobRunsController, AllJobRunsController, StagesController, RestrictedRecordsController],
  providers: [
    JobRunsService,
    StagesService,
    { provide: JobRunStore, useClass: PgJobRunStore },
    { provide: JobRunQueue, useClass: PgBossJobRunQueue },
    { provide: StageCatalog, useClass: BuiltinStageCatalog },
  ],
  exports: [JobRunsService],
})
export class RuntimeJobsModule {}
