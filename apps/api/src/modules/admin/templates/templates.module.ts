import { Module } from "@nestjs/common";
import { TemplatesController } from "./templates.controller.js";
import { TemplatesService } from "./templates.service.js";

/** admin · templates — docs/architecture/05-building-block-view.md. */
@Module({ controllers: [TemplatesController], providers: [TemplatesService], exports: [TemplatesService] })
export class TemplatesModule {}
