// Interface layer: the pipeline stages (ADR-0027), read-only. Needs a session.

import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { StagesService } from "../application/stages.service.js";
import type { StageView } from "../domain/job-run.js";

@ApiTags("delivery · runtime jobs")
@Controller("stages")
export class StagesController {
  constructor(private readonly stages: StagesService) {}

  @Get()
  @ApiOperation({ summary: "List the pipeline stages in order: who runs each (runtime, member, portal), its agents, writes and gates" })
  @ApiOkResponse({ description: "The stages; `runnable` marks those the portal can start." })
  list(): Promise<StageView[]> {
    return this.stages.list();
  }
}
