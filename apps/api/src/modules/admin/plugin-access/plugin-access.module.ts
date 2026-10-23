// Wiring for the use of member plugins per project.

import { Module } from "@nestjs/common";
import { PluginsModule } from "#modules/admin/plugins/index.js";
import { PluginAccessService } from "./application/plugin-access.service.js";
import { PluginAccessRepository } from "./domain/plugin-access.repository.js";
import { PgPluginAccessRepository } from "./infrastructure/pg-plugin-access.repository.js";
import { PluginAccessController } from "./interface/plugin-access.controller.js";

@Module({
  imports: [PluginsModule],
  controllers: [PluginAccessController],
  providers: [PluginAccessService, { provide: PluginAccessRepository, useClass: PgPluginAccessRepository }],
  exports: [PluginAccessService],
})
export class PluginAccessModule {}
