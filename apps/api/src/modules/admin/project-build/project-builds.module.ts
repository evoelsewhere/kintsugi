import { Module } from "@nestjs/common";
import { ProjectBuildsController } from "./project-builds.controller.js";
import { ProjectBuildsService } from "./project-builds.service.js";

/** admin · project build — docs/architecture/05-building-block-view.md. */
@Module({ controllers: [ProjectBuildsController], providers: [ProjectBuildsService], exports: [ProjectBuildsService] })
export class ProjectBuildsModule {}
