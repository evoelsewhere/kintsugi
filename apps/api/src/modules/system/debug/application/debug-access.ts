// Who may use the debug MCP server (ADR-0056): an account of the installation, signed in with HTTP Basic on every
// request and holding `debug.access` (the admin role has it). The check is the sign-in check: the same lockout after
// failures, no session created.

import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import type { Actor } from "#common/auth/decorators.js";
import { AuthService } from "#modules/core/auth/index.js";

export const DEBUG_PERMISSION = "debug.access";

/** `username` and `password` from an `Authorization: Basic …` header; undefined for any other header. */
export function basicCredentials(header: string | undefined): { username: string; password: string } | undefined {
  if (header === undefined || !/^basic\s+/i.test(header)) return undefined;
  const decoded = Buffer.from(header.replace(/^basic\s+/i, ""), "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon <= 0) return undefined;
  return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

@Injectable()
export class DebugAccess {
  constructor(private readonly auth: AuthService) {}

  async authenticate(request: Request): Promise<Actor> {
    const credentials = basicCredentials(request.headers.authorization);
    if (credentials === undefined) throw new UnauthorizedException("Sign in with HTTP Basic (Authorization: Basic base64(username:password)) as an account that holds debug.access");
    const user = await this.auth.verifyCredentials(credentials.username, credentials.password);
    if (!user.permissions.includes(DEBUG_PERMISSION)) throw new ForbiddenException(`Missing permission: ${DEBUG_PERMISSION}`);
    return { id: user.id, username: user.username, permissions: user.permissions };
  }
}
