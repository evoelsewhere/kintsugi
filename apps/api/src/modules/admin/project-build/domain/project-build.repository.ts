// Port of ProjectBuilds — the DI token of this module (shared kernel: common/domain/repository.ts).

import { Repository } from "#common/domain/repository.js";
import type { CreateProjectBuild, ProjectBuild } from "./project-build.js";

export abstract class ProjectBuildRepository extends Repository<ProjectBuild, CreateProjectBuild> {}
