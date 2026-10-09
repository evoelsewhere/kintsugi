// Application layer: use cases of Projects. Extends the shared CRUD kernel
// (common/application/crud.service.ts) — add module-specific use cases here.

import { Injectable } from "@nestjs/common";
import { CrudService } from "../../../../common/application/crud.service.js";
import type { CreateProject, Project } from "../domain/project.js";
import { ProjectRepository } from "../domain/project.repository.js";

export type UpdateProject = Partial<CreateProject>;

@Injectable()
export class ProjectsService extends CrudService<Project, CreateProject> {
  constructor(items: ProjectRepository) {
    super(items, "Project");
  }
}
