// Versioned, read-only HTTP interface for member harnesses (CLI and local MCP bridge). It is the common
// base every plugin builds on: which projects the member may read and those projects' documents.

import { Controller, createParamDecorator, type ExecutionContext, Get, Query, UnauthorizedException } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { documentFileQuerySchema, documentTreeQuerySchema, projectQuerySchema } from "@kintsugi/harness-sdk";
import type { z } from "zod";
import { AllowMemberRead, RequirePermission } from "#common/auth/decorators.js";
import type { AuthenticatedRequest, MemberPrincipal } from "#modules/core/auth/index.js";
import { MemberApiService } from "../application/member-api.service.js";

const CurrentMemberPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext): MemberPrincipal => {
  const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().memberPrincipal;
  if (principal === undefined) throw new UnauthorizedException("A member token is required");
  return principal;
});

@ApiTags("member")
@Controller("member/v1")
export class MemberApiController {
  constructor(private readonly member: MemberApiService) {}

  @Get("projects")
  @RequirePermission("member.read")
  @AllowMemberRead({ projectIdFrom: "token-projects" })
  @ApiOperation({ summary: "List projects within token scope and current Project Access" })
  projects(@CurrentMemberPrincipal() principal: MemberPrincipal, @Query({ schema: projectQuerySchema }) query: z.infer<typeof projectQuerySchema>) {
    return this.member.listProjects(principal, query);
  }

  @Get("documents/tree")
  @RequirePermission("member.read")
  @AllowMemberRead({ projectIdFrom: "query" })
  @ApiOperation({ summary: "List a directory of an authorized project's document repository" })
  tree(@Query({ schema: documentTreeQuerySchema }) query: z.infer<typeof documentTreeQuerySchema>) {
    return this.member.documentTree(query.projectId, query.ref, query.path);
  }

  @Get("documents/file")
  @RequirePermission("member.read")
  @AllowMemberRead({ projectIdFrom: "query" })
  @ApiOperation({ summary: "Read a Markdown file of an authorized project's document repository" })
  file(@Query({ schema: documentFileQuerySchema }) query: z.infer<typeof documentFileQuerySchema>) {
    return this.member.documentFile(query.projectId, query.ref, query.path);
  }
}
