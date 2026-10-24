// Wiring of the installation settings module: the use cases plus the Postgres adapter bound
// to the port.

import { Module } from "@nestjs/common";
import { InstallationSettingsService } from "./application/installation-settings.service.js";
import { InstallationSettings } from "./domain/installation-settings.js";
import { PgInstallationSettings } from "./infrastructure/pg-installation-settings.js";
import { InstallationSettingsController, SandboxSettingsController, TelemetryExportController } from "./interface/installation-settings.controller.js";
import { CodingAgentSecurityController } from "./interface/coding-agent-security.controller.js";

/** admin · installation settings managed in the portal (commit identity, …). */
@Module({
  controllers: [InstallationSettingsController, SandboxSettingsController, TelemetryExportController, CodingAgentSecurityController],
  providers: [InstallationSettingsService, { provide: InstallationSettings, useClass: PgInstallationSettings }],
  exports: [InstallationSettingsService],
})
export class InstallationSettingsModule {}
