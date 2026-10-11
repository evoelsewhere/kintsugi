// Port of VerificationRuns — the DI token of this module (shared kernel: common/domain/repository.ts).

import { Repository } from "#common/domain/repository.js";
import type { CreateVerificationRun, VerificationRun } from "./verification-run.js";

export abstract class VerificationRunRepository extends Repository<VerificationRun, CreateVerificationRun> {}
