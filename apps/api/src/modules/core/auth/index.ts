// Public surface of the auth module. Other modules import through this file.

export type { MemberPrincipal } from "./application/member-token.service.js";
export type { AuthenticatedRequest } from "./interface/auth.guard.js";
export { AuthModule } from "./auth.module.js";
export { AuthService, type SessionUser } from "./application/auth.service.js";
export { MemberTokenService } from "./application/member-token.service.js";
