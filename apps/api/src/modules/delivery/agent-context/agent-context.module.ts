// Wiring for the read-only Coding Agent Workflow task context.

import { Module } from "@nestjs/common";
import { ProjectAccessModule } from "#modules/admin/project-access/index.js";
import { DocumentsModule } from "#modules/delivery/documents/index.js";
import { TaskQueryService } from "./application/task-query.service.js";
import { ProjectAccessPort } from "./domain/project-access.ports.js";
import { TaskApprovalEvidenceReader, TaskProjectionRepository, TaskSourceReader } from "./domain/task.js";
import { GitTaskReader } from "./infrastructure/git-task.reader.js";
import { PgTaskProjectionRepository } from "./infrastructure/pg-task-projection.repository.js";
import { ProjectAccessAdapter } from "./infrastructure/project-access.adapter.js";
import { UnknownTaskApprovalEvidenceReader } from "./infrastructure/unknown-task-approval.reader.js";

@Module({
  imports: [DocumentsModule, ProjectAccessModule],
  providers: [
    TaskQueryService,
    GitTaskReader,
    PgTaskProjectionRepository,
    UnknownTaskApprovalEvidenceReader,
    ProjectAccessAdapter,
    { provide: TaskSourceReader, useExisting: GitTaskReader },
    { provide: TaskProjectionRepository, useExisting: PgTaskProjectionRepository },
    { provide: TaskApprovalEvidenceReader, useExisting: UnknownTaskApprovalEvidenceReader },
    { provide: ProjectAccessPort, useExisting: ProjectAccessAdapter },
  ],
  exports: [TaskQueryService],
})
export class AgentContextModule {}
