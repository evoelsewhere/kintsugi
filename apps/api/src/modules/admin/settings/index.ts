// Public surface of the installation settings module: other modules import only from here.

export { InstallationSettingsModule } from "./installation-settings.module.js";
export { InstallationSettingsService } from "./application/installation-settings.service.js";
export type { CommitIdentity, CommitIdentityView, SandboxSettingsView } from "./domain/installation-settings.js";
