// Port of JobRuns — the DI token of this module (shared kernel: common/domain/repository.ts).

import { Repository } from "../../../../common/domain/repository.js";
import type { CreateJobRun, JobRun } from "./job-run.js";

export abstract class JobRunRepository extends Repository<JobRun, CreateJobRun> {}
