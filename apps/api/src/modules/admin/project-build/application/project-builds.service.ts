// Application layer: use cases of ProjectBuilds. Extends the shared CRUD kernel
// (common/application/crud.service.ts) — add module-specific use cases here.

import { Injectable } from "@nestjs/common";
import { CrudService } from "../../../../common/application/crud.service.js";
import type { CreateProjectBuild, ProjectBuild } from "../domain/project-build.js";
import { ProjectBuildRepository } from "../domain/project-build.repository.js";

export type UpdateProjectBuild = Partial<CreateProjectBuild>;

@Injectable()
export class ProjectBuildsService extends CrudService<ProjectBuild, CreateProjectBuild> {
  constructor(items: ProjectBuildRepository) {
    super(items, "ProjectBuild");
  }
}
