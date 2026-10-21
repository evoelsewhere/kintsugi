import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { MemberPrincipal } from "../../src/modules/core/auth/index.js";
import { AuthMemberEventPrincipalRevalidator } from "../../src/modules/delivery/agent-context/infrastructure/auth-member-event-principal.revalidator.js";

const principal: MemberPrincipal = {
  userId: "user-1",
  tokenId: "token-1",
  projectIds: ["shop"],
  credentialKind: "coding-agent-read",
};

describe("AuthMemberEventPrincipalRevalidator", () => {
  it("rejects a token that was revoked or replaced while the stream is open", async () => {
    const tokens = { authenticateMemberToken: vi.fn(async () => undefined) };
    const auth = { authenticateUser: vi.fn(async () => ({ permissions: ["member.read"] })) };
    const revalidator = new AuthMemberEventPrincipalRevalidator(tokens as never, auth as never);

    await expect(revalidator.revalidate(principal, "shop", "revoked-token")).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.authenticateUser).not.toHaveBeenCalled();
  });

  it("rejects lost read permission and changed token scope", async () => {
    const tokens = { authenticateMemberToken: vi.fn(async () => principal) };
    const auth = { authenticateUser: vi.fn(async () => ({ permissions: [] })) };
    const revalidator = new AuthMemberEventPrincipalRevalidator(tokens as never, auth as never);

    await expect(revalidator.revalidate(principal, "shop", "token")).rejects.toBeInstanceOf(ForbiddenException);
    await expect(revalidator.revalidate(principal, "other", "token")).rejects.toBeInstanceOf(ForbiddenException);
    expect(auth.authenticateUser).toHaveBeenCalledTimes(1);
  });
});
