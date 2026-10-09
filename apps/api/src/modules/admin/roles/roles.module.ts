// Wiring of the roles & permissions module (Roles & Permissions UI).

import { Module } from "@nestjs/common";
import { RolesService } from "./application/roles.service.js";
import { RoleRepository } from "./domain/role.repository.js";
import { PgRoleRepository } from "./infrastructure/pg-role.repository.js";
import { RolesController } from "./interface/roles.controller.js";

@Module({
  controllers: [RolesController],
  providers: [RolesService, { provide: RoleRepository, useClass: PgRoleRepository }],
  exports: [RolesService],
})
export class RolesModule {}
