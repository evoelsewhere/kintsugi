// Wiring of the plugin catalog: the use cases plus the packaged built-in catalog bound to the domain port.

import { Module } from "@nestjs/common";
import { PluginsService } from "./application/plugins.service.js";
import { PluginCatalog } from "./domain/plugin.catalog.js";
import { PackagedPluginCatalog } from "./infrastructure/packaged-plugin.catalog.js";
import { PluginsController } from "./interface/plugins.controller.js";

/** admin · plugins (ADR-0035): the marketplace of Kintsugi plugins. */
@Module({
  controllers: [PluginsController],
  providers: [PluginsService, { provide: PluginCatalog, useClass: PackagedPluginCatalog }],
  exports: [PluginsService],
})
export class PluginsModule {}
