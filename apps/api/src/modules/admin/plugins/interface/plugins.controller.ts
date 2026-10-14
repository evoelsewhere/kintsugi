// Interface layer: Administration → Plugins (ADR-0035). Reading the catalog needs a session.

import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PluginsService } from "../application/plugins.service.js";
import type { PluginDetail, PluginFileContent, PluginSummary } from "../domain/plugin.js";

const fileQuerySchema = z.object({ path: z.string().min(1).max(300) });
type FileQuery = z.infer<typeof fileQuerySchema>;

@ApiTags("admin · plugins")
@Controller("admin/plugins")
export class PluginsController {
  constructor(private readonly plugins: PluginsService) {}

  @Get()
  @ApiOperation({ summary: "List the plugins of the marketplace with their component counts" })
  @ApiOkResponse({ description: "The plugin catalog." })
  list(): Promise<PluginSummary[]> {
    return this.plugins.list();
  }

  @Get(":name")
  @ApiOperation({ summary: "Get a plugin: its components and the files of its folder" })
  @ApiOkResponse({ description: "The plugin." })
  get(@Param("name") name: string): Promise<PluginDetail> {
    return this.plugins.get(name);
  }

  @Get(":name/file")
  @ApiOperation({ summary: "Read one file of a plugin" })
  @ApiOkResponse({ description: "The file's path and text." })
  file(@Param("name") name: string, @Query({ schema: fileQuerySchema }) query: FileQuery): Promise<PluginFileContent> {
    return this.plugins.file(name, query.path);
  }
}
