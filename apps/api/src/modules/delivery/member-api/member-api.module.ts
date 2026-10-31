// Wiring of the common member API (projects, documents, the Brain, plugins and the activity record for member harnesses).

import { Module } from "@nestjs/common";
import { PluginAccessModule } from "#modules/admin/plugin-access/index.js";
import { PluginsModule } from "#modules/admin/plugins/index.js";
import { ProjectAccessModule } from "#modules/admin/project-access/index.js";
import { AuthModule } from "#modules/core/auth/index.js";
import { BrainModule } from "#modules/delivery/brain/index.js";
import { DocumentsModule } from "#modules/delivery/documents/index.js";
import { MemberActivityModule } from "#modules/monitoring/member-activity/index.js";
import { MemberApiService } from "./application/member-api.service.js";
import { MemberApiController } from "./interface/member-api.controller.js";

/** delivery · member API: the base contract plugins extend (ADR-0069). */
@Module({
  imports: [AuthModule, BrainModule, DocumentsModule, MemberActivityModule, PluginAccessModule, PluginsModule, ProjectAccessModule],
  controllers: [MemberApiController],
  providers: [MemberApiService],
})
export class MemberApiModule {}
