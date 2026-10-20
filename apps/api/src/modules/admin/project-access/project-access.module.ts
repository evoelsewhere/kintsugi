// Wiring for the explicit Project Access feature.

import { Module } from "@nestjs/common";
import { ProjectAccessService } from "./application/project-access.service.js";
import { ProjectAccessRepository } from "./domain/project-access.repository.js";
import { PgProjectAccessRepository } from "./infrastructure/pg-project-access.repository.js";
import { ProjectAccessController } from "./interface/project-access.controller.js";

@Module({
  controllers: [ProjectAccessController],
  providers: [ProjectAccessService, { provide: ProjectAccessRepository, useClass: PgProjectAccessRepository }],
  exports: [ProjectAccessService],
})
export class ProjectAccessModule {}
