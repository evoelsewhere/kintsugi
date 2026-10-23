// Wiring of auth, personal Kintsugi member tokens and global guards (ADR-0008).

import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ProjectAccessModule } from "#modules/admin/project-access/index.js";
import { RolesModule } from "#modules/admin/roles/index.js";
import { InstallationSettingsModule } from "#modules/admin/settings/index.js";
import { UsersModule } from "#modules/admin/users/index.js";
import { AuthService } from "./application/auth.service.js";
import { CodingAgentOAuthService } from "./application/coding-agent-oauth.service.js";
import { LoginThrottle } from "./application/login-throttle.js";
import { MemberTokenService } from "./application/member-token.service.js";
import { MemberConnectionRepository } from "./domain/member-connection.repository.js";
import { MemberTokenRepository } from "./domain/member-token.repository.js";
import { SessionRepository } from "./domain/session.repository.js";
import { PgMemberConnectionRepository } from "./infrastructure/pg-member-connection.repository.js";
import { PgMemberTokenRepository } from "./infrastructure/pg-member-token.repository.js";
import { PgSessionRepository } from "./infrastructure/pg-session.repository.js";
import { AuthController } from "./interface/auth.controller.js";
import { AuthGuard, CsrfGuard, PermissionsGuard } from "./interface/auth.guard.js";
import { AdminMemberConnectionsController } from "./interface/admin-member-connections.controller.js";
import { CodingAgentOAuthController } from "./interface/coding-agent-oauth.controller.js";
import { MemberConnectionsController } from "./interface/member-connections.controller.js";
import { MemberTokensController } from "./interface/member-tokens.controller.js";

@Module({
  imports: [UsersModule, RolesModule, ProjectAccessModule, InstallationSettingsModule],
  controllers: [AuthController, CodingAgentOAuthController, MemberConnectionsController, AdminMemberConnectionsController, MemberTokensController],
  providers: [
    AuthService,
    CodingAgentOAuthService,
    LoginThrottle,
    MemberTokenService,
    { provide: MemberConnectionRepository, useClass: PgMemberConnectionRepository },
    { provide: MemberTokenRepository, useClass: PgMemberTokenRepository },
    { provide: SessionRepository, useClass: PgSessionRepository },
    // Global guards run in this order: CSRF → authentication → permissions.
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [AuthService, CodingAgentOAuthService, MemberTokenService],
})
export class AuthModule {}
