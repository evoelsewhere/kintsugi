// Public surface of plugin access. Other modules import this feature only here.

export { PluginAccessModule } from "./plugin-access.module.js";
export { PluginAccessService } from "./application/plugin-access.service.js";
export type { PluginAccessGrant } from "./domain/plugin-access.repository.js";
