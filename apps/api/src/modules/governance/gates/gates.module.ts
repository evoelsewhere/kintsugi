import { Module } from "@nestjs/common";
import { GatesController } from "./gates.controller.js";
import { GatesService } from "./gates.service.js";

/** governance · quality gates — docs/architecture/05-building-block-view.md. */
@Module({ controllers: [GatesController], providers: [GatesService], exports: [GatesService] })
export class GatesModule {}
