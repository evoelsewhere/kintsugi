import { Module } from "@nestjs/common";
import { ProjectAccessModule } from "#modules/admin/project-access/index.js";
import { ProjectsModule } from "#modules/admin/projects/index.js";
import { AgentContextModule } from "#modules/delivery/agent-context/index.js";
import { GatePublicationService } from "./application/gate-publication.service.js";
import { GateDecisionEvidenceReader } from "./domain/gate-decision-evidence.reader.js";
import { GatePublicationRepository } from "./domain/gate-publication.repository.js";
import { PgGateDecisionEvidenceReader } from "./infrastructure/pg-gate-decision-evidence.reader.js";
import { PgGatePublicationRepository } from "./infrastructure/pg-gate-publication.repository.js";
import { GatePublicationController } from "./interface/gate-publication.controller.js";

@Module({
  imports: [ProjectsModule, ProjectAccessModule, AgentContextModule],
  controllers: [GatePublicationController],
  providers: [
    GatePublicationService,
    PgGatePublicationRepository,
    PgGateDecisionEvidenceReader,
    { provide: GatePublicationRepository, useExisting: PgGatePublicationRepository },
    { provide: GateDecisionEvidenceReader, useExisting: PgGateDecisionEvidenceReader },
  ],
  exports: [GatePublicationService],
})
export class GatePublicationModule {}
