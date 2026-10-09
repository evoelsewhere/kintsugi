// Temporary in-memory adapter (development skeleton). Replace it with the Postgres
// adapter when this module's data lands — one schema per domain; see
// admin/llm-providers/infrastructure/pg-llm-provider.repository.ts for the pattern.

import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { InMemoryRepository } from "../../../../common/infrastructure/in-memory.repository.js";
import type { CreateVerificationRun, VerificationRun } from "../domain/verification-run.js";
import { VerificationRunRepository } from "../domain/verification-run.repository.js";

@Injectable()
export class InMemoryVerificationRunRepository extends InMemoryRepository<VerificationRun, CreateVerificationRun> {
  constructor() {
    super((input) => ({ id: randomUUID(), ...input }));
  }
}
