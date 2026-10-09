import { Module } from "@nestjs/common";
import { IncidentsController } from "./incidents.controller.js";
import { IncidentsService } from "./incidents.service.js";

/** delivery · hypercare & operate — docs/architecture/05-building-block-view.md. */
@Module({ controllers: [IncidentsController], providers: [IncidentsService], exports: [IncidentsService] })
export class IncidentsModule {}
