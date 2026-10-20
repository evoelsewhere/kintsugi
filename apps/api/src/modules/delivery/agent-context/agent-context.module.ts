// Wiring for the read-only Coding Agent Workflow task and immutable context APIs.

import { Module } from "@nestjs/common";
import { ProjectAccessModule } from "#modules/admin/project-access/index.js";
import { DocumentsModule } from "#modules/delivery/documents/index.js";
import { TaskQueryService } from "./application/task-query.service.js";
import { SnapshotService } from "./application/snapshot.service.js";
import { DocumentQueryService } from "./application/document-query.service.js";
import { AgentContextService } from "./application/agent-context.service.js";
import { AgentContextController } from "./interface/agent-context.controller.js";
import { ProjectAccessPort } from "./domain/project-access.ports.js";
import { ReviewReader } from "./domain/review-reader.port.js";
import { SnapshotRepository } from "./domain/snapshot.js";
import { TaskApprovalEvidenceReader, TaskProjectionRepository, TaskSourceReader } from "./domain/task.js";
import { GitTaskReader } from "./infrastructure/git-task.reader.js";
import { PgSnapshotRepository } from "./infrastructure/pg-snapshot.repository.js";
import { PgTaskProjectionRepository } from "./infrastructure/pg-task-projection.repository.js";
import { ProjectAccessAdapter } from "./infrastructure/project-access.adapter.js";
import { UnavailableReviewReader } from "./infrastructure/unavailable-review.reader.js";
import { UnknownTaskApprovalEvidenceReader } from "./infrastructure/unknown-task-approval.reader.js";

@Module({
  imports: [DocumentsModule, ProjectAccessModule],
  controllers: [AgentContextController],
  providers: [
    AgentContextService,
    TaskQueryService,
    SnapshotService,
    DocumentQueryService,
    GitTaskReader,
    PgSnapshotRepository,
    PgTaskProjectionRepository,
    UnknownTaskApprovalEvidenceReader,
    ProjectAccessAdapter,
    UnavailableReviewReader,
    { provide: SnapshotRepository, useExisting: PgSnapshotRepository },
    { provide: TaskSourceReader, useExisting: GitTaskReader },
    { provide: TaskProjectionRepository, useExisting: PgTaskProjectionRepository },
    { provide: TaskApprovalEvidenceReader, useExisting: UnknownTaskApprovalEvidenceReader },
    { provide: ProjectAccessPort, useExisting: ProjectAccessAdapter },
    { provide: ReviewReader, useExisting: UnavailableReviewReader },
  ],
  exports: [AgentContextService, TaskQueryService, SnapshotService, DocumentQueryService],
})
export class AgentContextModule {}
