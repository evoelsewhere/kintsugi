// Temporary in-memory adapter (development skeleton). Replace it with the Postgres
// adapter when this module's data lands — one schema per domain; see
// admin/llm-providers/infrastructure/pg-llm-provider.repository.ts for the pattern.

import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { InMemoryRepository } from "../../../../common/infrastructure/in-memory.repository.js";
import type { CreateTemplate, Template } from "../domain/template.js";

@Injectable()
export class InMemoryTemplateRepository extends InMemoryRepository<Template, CreateTemplate> {
  constructor() {
    super((input) => ({ id: randomUUID(), ...input }));
  }
}
