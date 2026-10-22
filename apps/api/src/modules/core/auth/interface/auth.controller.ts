// Interface layer: sign-in / sign-out / current session. The session token travels
// in an httpOnly cookie (common/auth/session-cookie.ts) and never in a response body.

import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { Public } from "#common/auth/decorators.js";
import { clearSessionCookie, sessionToken, setSessionCookie } from "#common/auth/session-cookie.js";
import { loadEnv } from "#common/config/env.js";
import { AuthService, type SessionUser } from "../application/auth.service.js";
import { SESSION_TTL_SECONDS } from "../domain/session.repository.js";
import type { AuthenticatedRequest } from "./auth.guard.js";

const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});
type LoginInput = z.infer<typeof loginSchema>;

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  readonly #env = loadEnv();

  constructor(private readonly auth: AuthService) {}

  @Post("login")
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: "Sign in with username and password; sets the session cookie (ADR-0008)" })
  @ApiOkResponse({ description: "The signed-in user." })
  async login(
    @Body({ schema: loginSchema }) input: LoginInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: SessionUser }> {
    const { token, user } = await this.auth.login(input.username, input.password);
    setSessionCookie(response, token, { maxAgeSeconds: SESSION_TTL_SECONDS, secure: this.#env.secureCookies });
    return { user };
  }

  @Post("logout")
  @Public()
  @HttpCode(204)
  @ApiOperation({ summary: "Sign out — revoke the current session and clear the cookie" })
  async logout(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response): Promise<void> {
    const token = sessionToken(request);
    if (token !== undefined) await this.auth.logout(token);
    clearSessionCookie(response, { secure: this.#env.secureCookies });
  }

  @Get("coding-agent/installation")
  @Public()
  @ApiOperation({ summary: "Read the canonical Kintsugi installation URL for Coding Agent Workflow setup" })
  @ApiOkResponse({ description: "The configured public URL; never derived from request headers." })
  codingAgentInstallation(): { baseUrl: string } {
    return { baseUrl: this.#env.publicUrl };
  }

  @Get("me")
  @ApiOperation({ summary: "The signed-in user with roles and effective permissions" })
  @ApiOkResponse({ description: "The current session user." })
  me(@Req() request: AuthenticatedRequest): SessionUser {
    return request.sessionUser!;
  }
}
