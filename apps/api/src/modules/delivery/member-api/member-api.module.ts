// Wiring of the common member API (projects and documents read by member harnesses).

import { Module } from "@nestjs/common";
import { ProjectAccessModule } from "#modules/admin/project-access/index.js";
import { AuthModule } from "#modules/core/auth/index.js";
import { DocumentsModule } from "#modules/delivery/documents/index.js";
import { MemberApiService } from "./application/member-api.service.js";
import { MemberApiController } from "./interface/member-api.controller.js";

/** delivery · member API: the base contract plugins extend (ADR-0067). */
@Module({
  imports: [AuthModule, DocumentsModule, ProjectAccessModule],
  controllers: [MemberApiController],
  providers: [MemberApiService],
})
export class MemberApiModule {}
