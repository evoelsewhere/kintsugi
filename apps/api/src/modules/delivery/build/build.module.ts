// Wiring of the build module (ADR-0071): what members recorded for the designed units they built, what the review of their merge
// requests found, and the runs that review. Documents, design and the runs come from their modules.

import { Module } from "@nestjs/common";
import { ProjectsModule } from "#modules/admin/projects/index.js";
import { DesignModule } from "#modules/delivery/design/index.js";
import { DocumentsModule } from "#modules/delivery/documents/index.js";
import { RuntimeJobsModule } from "#modules/delivery/runtime-jobs/index.js";
import { MemberActivityModule } from "#modules/monitoring/member-activity/index.js";
import { BuildReviewsService } from "./application/build-reviews.service.js";
import { BuildService } from "./application/build.service.js";
import { BuildController } from "./interface/build.controller.js";

/** delivery · the units members build and the review of their merge requests (ADR-0071). */
@Module({
  imports: [ProjectsModule, DesignModule, DocumentsModule, RuntimeJobsModule, MemberActivityModule],
  controllers: [BuildController],
  providers: [BuildService, BuildReviewsService],
  exports: [BuildService],
})
export class BuildModule {}
