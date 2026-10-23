// Wiring of member monitoring: the use cases plus the Postgres store bound to its port.

import { Module } from "@nestjs/common";
import { MemberActivityService } from "./application/member-activity.service.js";
import { MemberActivityRepository } from "./domain/member-activity.repository.js";
import { PgMemberActivityRepository } from "./infrastructure/pg-member-activity.repository.js";
import { MemberActivityController } from "./interface/member-activity.controller.js";

/** monitoring · member activity: what members' connections did, per member and plugin (ADR-0069). */
@Module({
  controllers: [MemberActivityController],
  providers: [MemberActivityService, { provide: MemberActivityRepository, useClass: PgMemberActivityRepository }],
  exports: [MemberActivityService],
})
export class MemberActivityModule {}
