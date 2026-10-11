// Wiring of the gates module: interface + application + the Postgres adapter bound to the
// domain port. Projects come from the projects module; the audit trail is global.

import { Module } from "@nestjs/common";
import { ProjectsModule } from "#modules/admin/projects/index.js";
import { GatesService } from "./application/gates.service.js";
import { GateRepository } from "./domain/gate.repository.js";
import { PgGateRepository } from "./infrastructure/pg-gate.repository.js";
import { GatesController } from "./interface/gates.controller.js";

/** governance · quality gates — docs/architecture/05-building-block-view.md. */
@Module({
  imports: [ProjectsModule],
  controllers: [GatesController],
  providers: [GatesService, { provide: GateRepository, useClass: PgGateRepository }],
  exports: [GatesService],
})
export class GatesModule {}
