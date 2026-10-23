import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Public, type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import { CodingAgentOAuthService } from "../application/coding-agent-oauth.service.js";

const authorizeSchema = z.object({
  projectId: z.string().trim().min(1).max(200),
  clientName: z.string().trim().min(1).max(80),
  redirectUri: z.string().url().max(500),
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  codeChallengeMethod: z.literal("S256"),
}).strict();

const tokenSchema = z.discriminatedUnion("grantType", [
  z.object({ grantType: z.literal("authorization_code"), code: z.string().min(1).max(200), codeVerifier: z.string().min(43).max(128), redirectUri: z.string().url().max(500) }).strict(),
  z.object({ grantType: z.literal("refresh_token"), refreshToken: z.string().min(1).max(200) }).strict(),
]);
const revokeSchema = z.object({ refreshToken: z.string().min(1).max(200) }).strict();

type AuthorizeInput = z.infer<typeof authorizeSchema>;
type TokenInput = z.infer<typeof tokenSchema>;
type RevokeInput = z.infer<typeof revokeSchema>;

@ApiTags("auth · member")
@Controller("auth/coding-agent")
export class CodingAgentOAuthController {
  constructor(private readonly oauth: CodingAgentOAuthService) {}

  @Post("authorize")
  @RequirePermission("member.read")
  @ApiOperation({ summary: "Create a short-lived, project-scoped authorization code after member consent" })
  @ApiOkResponse({ description: "A validated loopback redirect containing a single-use authorization code and client state." })
  authorize(@Body({ schema: authorizeSchema }) body: AuthorizeInput, @CurrentActor() actor: Actor) {
    return this.oauth.authorize(actor, body);
  }

  @Post("token")
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: "Exchange a PKCE code or rotate a Kintsugi member refresh credential" })
  @ApiOkResponse({ description: "A short-lived access token and rotating refresh credential." })
  token(@Body({ schema: tokenSchema }) body: TokenInput) {
    return this.oauth.token(body);
  }

  @Post("revoke")
  @Public()
  @HttpCode(204)
  @ApiOperation({ summary: "Revoke the connection associated with a refresh credential" })
  @ApiNoContentResponse({ description: "The connection is revoked when the refresh credential is valid." })
  async revoke(@Body({ schema: revokeSchema }) body: RevokeInput): Promise<void> {
    await this.oauth.revokeByRefreshCredential(body.refreshToken);
  }

}
