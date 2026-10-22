// Wiring of the auth module: sessions, sign-in lockout, global guards, bootstrap admin (ADR-0008).

import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { RolesModule } from "#modules/admin/roles/index.js";
import { UsersModule } from "#modules/admin/users/index.js";
import { AuthService } from "./application/auth.service.js";
import { LoginThrottle } from "./application/login-throttle.js";
import { SessionRepository } from "./domain/session.repository.js";
import { PgSessionRepository } from "./infrastructure/pg-session.repository.js";
import { AuthController } from "./interface/auth.controller.js";
import { AuthGuard, CsrfGuard, PermissionsGuard } from "./interface/auth.guard.js";

@Module({
  imports: [UsersModule, RolesModule],
  controllers: [AuthController],
  exports: [AuthService],
  providers: [
    AuthService,
    LoginThrottle,
    { provide: SessionRepository, useClass: PgSessionRepository },
    // Global guards run in this order: CSRF → authentication → permissions.
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AuthModule {}
