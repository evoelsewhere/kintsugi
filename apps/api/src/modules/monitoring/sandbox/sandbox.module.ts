// Wiring of the sandbox view of Monitoring (ADR-0058): the use cases plus the disk, Postgres and queue adapters bound to
// the domain ports.

import { Module } from "@nestjs/common";
import { InstallationSettingsModule } from "#modules/admin/settings/index.js";
import { SandboxService } from "./application/sandbox.service.js";
import { WorkspaceDisk, WorkspaceRemovals, WorkspaceRuns } from "./domain/sandbox.js";
import { DiskWorkspaces } from "./infrastructure/disk-workspaces.js";
import { PgBossWorkspaceRemovals } from "./infrastructure/pg-boss-workspace-removals.js";
import { PgWorkspaceRuns } from "./infrastructure/pg-workspace-runs.js";
import { SandboxController } from "./interface/sandbox.controller.js";

/** monitoring · sandbox: the job workspaces and their removal. */
@Module({
  imports: [InstallationSettingsModule],
  controllers: [SandboxController],
  providers: [
    SandboxService,
    { provide: WorkspaceDisk, useClass: DiskWorkspaces },
    { provide: WorkspaceRuns, useClass: PgWorkspaceRuns },
    { provide: WorkspaceRemovals, useClass: PgBossWorkspaceRemovals },
  ],
})
export class SandboxModule {}
