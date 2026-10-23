import { Body, Controller, Get, Put } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import { InstallationSettingsService } from "../application/installation-settings.service.js";
import type { CodingAgentConnectionLifetimeView } from "../domain/installation-settings.js";
import { codingAgentConnectionLifetimeSchema, type CodingAgentConnectionLifetimeInput } from "./installation-settings.dto.js";

@ApiTags("admin · settings")
@Controller("admin/settings")
@RequirePermission("security.manage")
export class CodingAgentSecurityController {
  constructor(private readonly settings: InstallationSettingsService) {}

  @Get("coding-agent-connection-lifetime")
  @ApiOperation({ summary: "Get the maximum Coding Agent Workflow connection age" })
  @ApiOkResponse({ description: "The connection age policy; isDefault while none was set." })
  codingAgentConnectionLifetime(): Promise<CodingAgentConnectionLifetimeView> {
    return this.settings.codingAgentConnectionLifetime();
  }

  @Put("coding-agent-connection-lifetime")
  @ApiOperation({ summary: "Set the maximum Coding Agent Workflow connection age" })
  @ApiOkResponse({ description: "The stored connection age policy." })
  setCodingAgentConnectionLifetime(
    @Body({ schema: codingAgentConnectionLifetimeSchema }) body: CodingAgentConnectionLifetimeInput,
    @CurrentActor() actor: Actor,
  ): Promise<CodingAgentConnectionLifetimeView> {
    return this.settings.setCodingAgentConnectionLifetime(body.maxAgeDays, actor);
  }
}
