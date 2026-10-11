// Wiring of the projects module: interface + application + the Postgres adapter bound to
// the domain port. Repositories come from the Git module (Settings -> Git).

import { Module } from "@nestjs/common";
import { GitModule } from "../git/git.module.js";
import { ProjectsService } from "./application/projects.service.js";
import { ProjectStore } from "./domain/project.store.js";
import { PgProjectStore } from "./infrastructure/pg-project.store.js";
import { ProjectsController } from "./interface/projects.controller.js";

/** admin · projects & applications (A1) — docs/architecture/05-building-block-view.md, ADR-0028. */
@Module({
  imports: [GitModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, { provide: ProjectStore, useClass: PgProjectStore }],
  exports: [ProjectsService, ProjectStore],
})
export class ProjectsModule {}
