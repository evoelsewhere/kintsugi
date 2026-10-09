// Wiring of the projects module: interface + application + the
// infrastructure adapter bound to the domain port.

import { Module } from "@nestjs/common";
import { ProjectsService } from "./application/projects.service.js";
import { ProjectRepository } from "./domain/project.repository.js";
import { InMemoryProjectRepository } from "./infrastructure/in-memory-project.repository.js";
import { ProjectsController } from "./interface/projects.controller.js";

/** admin · projects & applications — docs/architecture/05-building-block-view.md. */
@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, { provide: ProjectRepository, useClass: InMemoryProjectRepository }],
  exports: [ProjectsService, ProjectRepository],
})
export class ProjectsModule {}
