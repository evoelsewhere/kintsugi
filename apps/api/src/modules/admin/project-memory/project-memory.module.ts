import { Module } from "@nestjs/common";
import { ProjectMemoryService } from "./application/project-memory.service.js";
import { ProjectMemoryRepository } from "./domain/project-memory.repository.js";
import { PgProjectMemoryRepository } from "./infrastructure/pg-project-memory.repository.js";
import { ProjectMemoryController } from "./interface/project-memory.controller.js";

@Module({ controllers: [ProjectMemoryController], providers: [ProjectMemoryService, { provide: ProjectMemoryRepository, useClass: PgProjectMemoryRepository }] })
export class ProjectMemoryModule {}
