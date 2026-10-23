// Wiring of the CLI download: the use cases plus the folder store bound to its port.

import { Module } from "@nestjs/common";
import { ReleasesService } from "./application/releases.service.js";
import { ReleaseStore } from "./domain/release.store.js";
import { FsReleaseStore } from "./infrastructure/fs-release.store.js";
import { ReleasesController } from "./interface/releases.controller.js";

/** system · releases: how members get the CLI from the installation (ADR-0070). */
@Module({
  controllers: [ReleasesController],
  providers: [ReleasesService, { provide: ReleaseStore, useClass: FsReleaseStore }],
})
export class ReleasesModule {}
