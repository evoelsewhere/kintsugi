// Wiring of the Brain module (ADR-0091): the tree index of a project's document repository branch, read through
// the worker's store and the document mirror, built by the worker on request.

import { Module } from "@nestjs/common";
import { GitModule } from "#modules/admin/git/index.js";
import { ProjectAccessModule } from "#modules/admin/project-access/index.js";
import { DocumentsModule } from "#modules/delivery/documents/index.js";
import { BrainService } from "./application/brain.service.js";
import { BrainBuildQueue, BrainIndex } from "./domain/brain.ports.js";
import { PgBossBrainBuildQueue } from "./infrastructure/pg-boss-brain-build.queue.js";
import { PgBrainIndex } from "./infrastructure/pg-brain.index.js";
import { WikiBranchFollower } from "./application/wiki-branch.follower.js";
import { BrainController } from "./interface/brain.controller.js";
import { WikiController } from "./interface/wiki.controller.js";

@Module({
  imports: [DocumentsModule, ProjectAccessModule, GitModule],
  controllers: [BrainController, WikiController],
  providers: [BrainService, WikiBranchFollower, { provide: BrainIndex, useClass: PgBrainIndex }, { provide: BrainBuildQueue, useClass: PgBossBrainBuildQueue }],
  exports: [BrainService],
})
export class BrainModule {}
