import { Module } from "@nestjs/common";
import { JobRunsController } from "./job-runs.controller.js";
import { JobRunsService } from "./job-runs.service.js";

/** monitoring · agent observability — docs/architecture/05-building-block-view.md. */
@Module({ controllers: [JobRunsController], providers: [JobRunsService], exports: [JobRunsService] })
export class JobRunsModule {}
