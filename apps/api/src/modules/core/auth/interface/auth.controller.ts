// Interface layer: sign-in / sign-out / current session.

import { Body, Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Public } from "../../../../common/auth/decorators.js";
import { AuthService, type SessionUser } from "../application/auth.service.js";
import type { AuthenticatedRequest } from "./auth.guard.js";

const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});
type LoginInput = z.infer<typeof loginSchema>;

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: "Sign in with username and password (ADR-0008)" })
  @ApiOkResponse({ description: "The session token and the signed-in user." })
  login(@Body({ schema: loginSchema }) input: LoginInput): Promise<{ token: string; user: SessionUser }> {
    return this.auth.login(input.username, input.password);
  }

  @Post("logout")
  @HttpCode(204)
  @ApiOperation({ summary: "Sign out — revoke the current session" })
  async logout(@Req() request: AuthenticatedRequest): Promise<void> {
    const header = request.headers.authorization;
    if (header?.startsWith("Bearer ")) await this.auth.logout(header.slice("Bearer ".length));
  }

  @Get("me")
  @ApiOperation({ summary: "The signed-in user with roles and effective permissions" })
  @ApiOkResponse({ description: "The current session user." })
  me(@Req() request: AuthenticatedRequest): SessionUser {
    return request.sessionUser!;
  }
}
