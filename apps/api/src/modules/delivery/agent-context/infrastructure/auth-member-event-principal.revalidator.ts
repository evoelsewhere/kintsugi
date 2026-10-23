// Rechecks a long-lived member event stream against current credentials and permissions.

import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthService, MemberTokenService, type MemberPrincipal } from "#modules/core/auth/index.js";
import { MemberEventPrincipalRevalidator } from "../domain/member-event.port.js";

@Injectable()
export class AuthMemberEventPrincipalRevalidator extends MemberEventPrincipalRevalidator {
  constructor(
    private readonly memberTokens: MemberTokenService,
    private readonly auth: AuthService,
  ) {
    super();
  }

  async revalidate(principal: MemberPrincipal, projectId: string, bearerToken: string): Promise<void> {
    const current = await this.memberTokens.authenticateMemberToken(bearerToken);
    if (current === undefined || current.userId !== principal.userId || current.tokenId !== principal.tokenId) {
      throw new UnauthorizedException("Invalid or expired token");
    }
    if (!current.projectIds.includes(projectId)) throw new ForbiddenException("Token is no longer scoped to this project");

    const user = await this.auth.authenticateUser(current.userId);
    if (user === undefined) throw new UnauthorizedException("Invalid or expired token");
    if (!user.permissions.includes("member.read")) throw new ForbiddenException("Missing permission: member.read");
  }
}
