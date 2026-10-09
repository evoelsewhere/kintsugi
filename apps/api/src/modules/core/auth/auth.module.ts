// Wiring of the auth module: sessions, global guards, bootstrap admin (ADR-0008).

import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { RolesModule } from "../../admin/roles/roles.module.js";
import { UsersModule } from "../../admin/users/users.module.js";
import { AuthService } from "./application/auth.service.js";
import { PgSessionRepository } from "./infrastructure/pg-session.repository.js";
import { AuthController } from "./interface/auth.controller.js";
import { AuthGuard, PermissionsGuard } from "./interface/auth.guard.js";

@Module({
  imports: [UsersModule, RolesModule],
  controllers: [AuthController],
  providers: [AuthService, PgSessionRepository, { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard }],
})
export class AuthModule {}
