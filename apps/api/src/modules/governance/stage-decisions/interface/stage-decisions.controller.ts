import { Body, Controller, HttpCode, Param, Post } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import { StageDecisionsService } from "../application/stage-decisions.service.js";
import type { StageDecisionRecord } from "@kintsugi/orchestrator";
import { type RecordStageDecisionInput, recordStageDecisionSchema } from "./stage-decisions.dto.js";

@ApiTags("governance · procedural stage decisions")
@Controller("governance/stage-decisions")
export class StageDecisionsController {
  constructor(private readonly decisions: StageDecisionsService) {}

  @RequirePermission("workitems.manage")
  @Post(":runId/:stageId/:gateId")
  @HttpCode(200)
  @ApiOperation({ summary: "Record a human procedural choice for a stage waiting on a decision" })
  @ApiOkResponse({ description: "The choice recorded for the run, stage and gate." })
  record(
    @Param("runId") runId: string,
    @Param("stageId") stage: string,
    @Param("gateId") gate: string,
    @Body({ schema: recordStageDecisionSchema }) body: RecordStageDecisionInput,
    @CurrentActor() actor: Actor,
  ): Promise<StageDecisionRecord> {
    return this.decisions.record({ runId, stage, gate, choice: body.choice }, actor);
  }
}
