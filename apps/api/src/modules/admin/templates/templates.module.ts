// Wiring of the templates module: interface + application + the
// infrastructure adapter bound to the domain port.

import { Module } from "@nestjs/common";
import { TemplatesService } from "./application/templates.service.js";
import { TemplateRepository } from "./domain/template.repository.js";
import { InMemoryTemplateRepository } from "./infrastructure/in-memory-template.repository.js";
import { TemplatesController } from "./interface/templates.controller.js";

/** admin · templates — docs/architecture/05-building-block-view.md. */
@Module({
  controllers: [TemplatesController],
  providers: [TemplatesService, { provide: TemplateRepository, useClass: InMemoryTemplateRepository }],
  exports: [TemplatesService, TemplateRepository],
})
export class TemplatesModule {}
