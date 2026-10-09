// Port of Projects — the DI token of this module (shared kernel: common/domain/repository.ts).

import { Repository } from "../../../../common/domain/repository.js";
import type { CreateProject, Project } from "./project.js";

export abstract class ProjectRepository extends Repository<Project, CreateProject> {}
