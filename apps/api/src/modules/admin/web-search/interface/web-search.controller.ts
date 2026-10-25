import { Body, Controller, Get, HttpCode, Param, Put } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { CurrentActor, RequirePermission, type Actor } from "#common/auth/decorators.js";
import { WebSearchService } from "../application/web-search.service.js";
const settingsSchema = z.object({ enabled: z.boolean(), agents: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,99}$/)).max(100) }).strict();
@ApiTags("admin · web search")
@Controller("admin/projects/:projectId/web-search")
@RequirePermission("project.web-search.manage")
export class WebSearchController {
  constructor(private readonly search: WebSearchService) {}
  @Get()
  @ApiOperation({ summary: "Read project DuckDuckGo search permission" })
  view(@Param("projectId") projectId: string) { return this.search.view(projectId); }
  @Put()
  @HttpCode(204)
  @ApiOperation({ summary: "Configure outbound search and the runtime agents allowed to query the public web" })
  configure(@Param("projectId") projectId: string, @Body({ schema: settingsSchema }) input: z.infer<typeof settingsSchema>, @CurrentActor() actor: Actor) {
    return this.search.configure(projectId, input, actor);
  }
}
