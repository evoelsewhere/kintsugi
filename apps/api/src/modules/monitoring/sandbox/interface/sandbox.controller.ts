// Interface layer: the sandbox view of Monitoring (ADR-0058). Reading needs a session, like the other monitoring reads;
// removing a workspace needs `sandbox.manage`. Thin HTTP adapters over SandboxService.

import { Controller, Delete, Get, HttpCode, Param } from "@nestjs/common";
import { ApiAcceptedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import { SandboxService, type SandboxWorkspaces } from "../application/sandbox.service.js";

@ApiTags("monitoring · sandbox")
@Controller("monitoring/sandbox")
export class SandboxController {
  constructor(private readonly sandbox: SandboxService) {}

  @Get("workspaces")
  @ApiOperation({ summary: "List the job workspaces on the worker's data volume with their run, state, size and when the sweep removes them" })
  @ApiOkResponse({ description: "The workspaces, the most recently changed first; `blockedBy` says why one cannot be removed now." })
  workspaces(): Promise<SandboxWorkspaces> {
    return this.sandbox.workspaces();
  }

  @Delete("workspaces/:jobId")
  @HttpCode(202)
  @RequirePermission("sandbox.manage")
  @ApiOperation({ summary: "Remove one job workspace: the worker deletes it. Refused while its run is active or the write of its output is pending" })
  @ApiAcceptedResponse({ description: "The removal was handed to the worker." })
  async remove(@Param("jobId") jobId: string, @CurrentActor() actor: Actor): Promise<{ jobId: string; status: "queued" }> {
    await this.sandbox.remove(jobId, actor);
    return { jobId, status: "queued" };
  }
}
