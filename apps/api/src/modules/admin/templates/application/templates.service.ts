// Application layer: use cases of Templates. Extends the shared CRUD kernel
// (common/application/crud.service.ts) — add module-specific use cases here.

import { Injectable } from "@nestjs/common";
import { CrudService } from "#common/application/crud.service.js";
import type { CreateTemplate, Template } from "../domain/template.js";
import { TemplateRepository } from "../domain/template.repository.js";

export type UpdateTemplate = Partial<CreateTemplate>;

@Injectable()
export class TemplatesService extends CrudService<Template, CreateTemplate> {
  constructor(items: TemplateRepository) {
    super(items, "Template");
  }
}
