import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { MemberPrincipal } from "../../src/modules/core/auth/application/member-token.service.js";
import { memberReadPrincipalForRequest } from "../../src/modules/delivery/agent-context/interface/agent-context.controller.js";

describe("portal member-read principal", () => {
  it("scopes a session principal to only the requested project without persisting a token", () => {
    const principal = memberReadPrincipalForRequest({
      sessionUser: { id: "user-1" } as never,
      query: { projectId: "shop" },
    } as never);

    expect(principal).toMatchObject({
      userId: "user-1",
      tokenId: "session-read:user-1",
      projectIds: ["shop"],
      credentialKind: "coding-agent-read",
    });
    expect(Object.isFrozen(principal)).toBe(true);
    expect(Object.isFrozen(principal.projectIds)).toBe(true);
  });

  it("preserves the authenticated token principal", () => {
    const tokenPrincipal: MemberPrincipal = {
      userId: "user-2",
      tokenId: "token-1",
      projectIds: ["shop"],
      credentialKind: "coding-agent-read",
    };
    expect(memberReadPrincipalForRequest({
      memberPrincipal: tokenPrincipal,
      sessionUser: undefined,
      query: {},
    } as never)).toBe(tokenPrincipal);
  });

  it("rejects missing session identity or project scope", () => {
    expect(() => memberReadPrincipalForRequest({ query: { projectId: "shop" } } as never))
      .toThrow(UnauthorizedException);
    expect(() => memberReadPrincipalForRequest({
      sessionUser: { id: "user-1" } as never,
      query: {},
    } as never)).toThrow(ForbiddenException);
  });
});
