// Public auth feature surface. Other modules consume identity contracts through this file.

export type { MemberPrincipal } from "./application/member-token.service.js";
export type { AuthenticatedRequest } from "./interface/auth.guard.js";
export { AuthService } from "./application/auth.service.js";
export { MemberTokenService } from "./application/member-token.service.js";
export { AuthModule } from "./auth.module.js";
