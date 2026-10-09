// Wiring of the project-builds module: interface + application + the
// infrastructure adapter bound to the domain port.

import { Module } from "@nestjs/common";
import { ProjectBuildsService } from "./application/project-builds.service.js";
import { ProjectBuildRepository } from "./domain/project-build.repository.js";
import { InMemoryProjectBuildRepository } from "./infrastructure/in-memory-project-build.repository.js";
import { ProjectBuildsController } from "./interface/project-builds.controller.js";

/** admin · project build — docs/architecture/05-building-block-view.md. */
@Module({
  controllers: [ProjectBuildsController],
  providers: [ProjectBuildsService, { provide: ProjectBuildRepository, useClass: InMemoryProjectBuildRepository }],
  exports: [ProjectBuildsService, ProjectBuildRepository],
})
export class ProjectBuildsModule {}
