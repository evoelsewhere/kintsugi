// Public surface of the plugin catalog module: other modules import only from here.

export { PluginsModule } from "./plugins.module.js";
export { PluginsService } from "./application/plugins.service.js";
export type { PluginDetail, PluginSummary } from "./domain/plugin.js";
