// Wiring for the read-only Coding Agent Workflow task and immutable context APIs.

import { Module } from "@nestjs/common";
import { ProjectAccessModule } from "#modules/admin/project-access/index.js";
import { AuthModule } from "#modules/core/auth/index.js";
import { DocumentsModule } from "#modules/delivery/documents/index.js";
import { MemberReviewsModule, ReviewQueryService } from "#modules/delivery/member-reviews/index.js";
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
import { PgTaskApprovalEvidenceReader } from "./infrastructure/pg-task-approval-evidence.reader.js";
import { MemberEventService } from "./application/member-event.service.js";
import { MemberEventPrincipalRevalidator, MemberEventReader } from "./domain/member-event.port.js";
import { AuthMemberEventPrincipalRevalidator } from "./infrastructure/auth-member-event-principal.revalidator.js";
import { PgMemberEventReader } from "./infrastructure/pg-member-event.reader.js";

@Module({
  imports: [AuthModule, DocumentsModule, MemberReviewsModule, ProjectAccessModule],
  controllers: [AgentContextController],
  providers: [
    AgentContextService,
    MemberEventService,
    TaskQueryService,
    SnapshotService,
    DocumentQueryService,
    GitTaskReader,
    PgSnapshotRepository,
    PgTaskProjectionRepository,
    PgTaskApprovalEvidenceReader,
    PgMemberEventReader,
    AuthMemberEventPrincipalRevalidator,
    ProjectAccessAdapter,
    { provide: SnapshotRepository, useExisting: PgSnapshotRepository },
    { provide: TaskSourceReader, useExisting: GitTaskReader },
    { provide: TaskProjectionRepository, useExisting: PgTaskProjectionRepository },
    { provide: TaskApprovalEvidenceReader, useExisting: PgTaskApprovalEvidenceReader },
    { provide: ProjectAccessPort, useExisting: ProjectAccessAdapter },
    { provide: MemberEventReader, useExisting: PgMemberEventReader },
    { provide: MemberEventPrincipalRevalidator, useExisting: AuthMemberEventPrincipalRevalidator },
    { provide: ReviewReader, useExisting: ReviewQueryService },
  ],
  exports: [AgentContextService, TaskQueryService, SnapshotService, DocumentQueryService],
})
export class AgentContextModule {}
