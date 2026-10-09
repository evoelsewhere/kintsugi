// Application layer: use cases of JobRuns. Extends the shared CRUD kernel
// (common/application/crud.service.ts) — add module-specific use cases here.

import { Injectable } from "@nestjs/common";
import { CrudService } from "../../../../common/application/crud.service.js";
import type { CreateJobRun, JobRun } from "../domain/job-run.js";
import { JobRunRepository } from "../domain/job-run.repository.js";

export type UpdateJobRun = Partial<CreateJobRun>;

@Injectable()
export class JobRunsService extends CrudService<JobRun, CreateJobRun> {
  constructor(items: JobRunRepository) {
    super(items, "JobRun");
  }
}
