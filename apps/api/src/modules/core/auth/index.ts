// Public surface of the auth module: other modules import only from here.

export { AuthModule } from "./auth.module.js";
export { AuthService, type SessionUser } from "./application/auth.service.js";
