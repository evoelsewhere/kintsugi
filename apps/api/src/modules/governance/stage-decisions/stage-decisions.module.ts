import { Module } from "@nestjs/common";
import { ProjectAccessModule } from "#modules/admin/project-access/index.js";
import { StageDecisionsService } from "./application/stage-decisions.service.js";
import { StageDecisionRepository } from "./domain/stage-decision.repository.js";
import { PgStageDecisionRepository } from "./infrastructure/pg-stage-decision.repository.js";
import { StageDecisionsController } from "./interface/stage-decisions.controller.js";

@Module({
  imports: [ProjectAccessModule],
  controllers: [StageDecisionsController],
  providers: [StageDecisionsService, { provide: StageDecisionRepository, useClass: PgStageDecisionRepository }],
})
export class StageDecisionsModule {}
