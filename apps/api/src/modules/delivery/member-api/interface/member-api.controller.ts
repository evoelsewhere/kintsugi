// Versioned HTTP interface for member harnesses (CLI and local MCP bridge). It is the common base every
// plugin builds on: the projects the member may read, those projects' documents, the member plugins the
// member may install, and one write: the record of what a plugin did (ADR-0069).

import { Body, Controller, createParamDecorator, type ExecutionContext, Get, HttpCode, Param, Post, Query, UnauthorizedException } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  activityInputSchema,
  brainGrepQuerySchema,
  brainLookupQuerySchema,
  brainReadQuerySchema,
  brainTreeQuerySchema,
  documentFileQuerySchema,
  documentTreeQuerySchema,
  pluginBundleQuerySchema,
  pluginListQuerySchema,
  projectQuerySchema,
} from "@kintsugi/harness-sdk";
import type { z } from "zod";
import { AllowMemberRead, type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
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
  file(@CurrentActor() actor: Actor, @Query({ schema: documentFileQuerySchema }) query: z.infer<typeof documentFileQuerySchema>) {
    return this.member.documentFile(actor.id, query.projectId, query.ref, query.path);
  }

  @Get("brain/tree")
  @RequirePermission("member.read")
  @AllowMemberRead({ projectIdFrom: "query" })
  @ApiOperation({ summary: "One level of an authorized project's Brain (the tree index of its documents), with summaries" })
  brainTree(@Query({ schema: brainTreeQuerySchema }) query: z.infer<typeof brainTreeQuerySchema>) {
    return this.member.brainTree(query);
  }

  @Get("brain/read")
  @RequirePermission("member.read")
  @AllowMemberRead({ projectIdFrom: "query" })
  @ApiOperation({ summary: "A Brain node's text at the indexed commit, with its citation, children and links" })
  brainRead(@CurrentActor() actor: Actor, @Query({ schema: brainReadQuerySchema }) query: z.infer<typeof brainReadQuerySchema>) {
    return this.member.brainRead(actor.id, query);
  }

  @Get("brain/lookup")
  @RequirePermission("member.read")
  @AllowMemberRead({ projectIdFrom: "query" })
  @ApiOperation({ summary: "The Brain nodes a reference id, node id or repository path names" })
  brainLookup(@Query({ schema: brainLookupQuerySchema }) query: z.infer<typeof brainLookupQuerySchema>) {
    return this.member.brainLookup(query);
  }

  @Get("brain/grep")
  @RequirePermission("member.read")
  @AllowMemberRead({ projectIdFrom: "query" })
  @ApiOperation({ summary: "The Brain nodes whose text holds a fixed string" })
  brainGrep(@Query({ schema: brainGrepQuerySchema }) query: z.infer<typeof brainGrepQuerySchema>) {
    return this.member.brainGrep(query);
  }

  @Get("plugins")
  @RequirePermission("member.read")
  @AllowMemberRead({ projectIdFrom: "query" })
  @ApiOperation({ summary: "List the member plugins the caller may install in an authorized project" })
  plugins(@CurrentActor() actor: Actor, @Query({ schema: pluginListQuerySchema }) query: z.infer<typeof pluginListQuerySchema>) {
    return this.member.listPlugins(actor.id, query.projectId);
  }

  @Get("plugins/:name")
  @RequirePermission("member.read")
  @AllowMemberRead({ projectIdFrom: "query" })
  @ApiOperation({ summary: "Download the files of one member plugin the caller may install" })
  plugin(
    @CurrentActor() actor: Actor,
    @Param("name") name: string,
    @Query({ schema: pluginBundleQuerySchema.omit({ name: true }) }) query: Omit<z.infer<typeof pluginBundleQuerySchema>, "name">,
  ) {
    return this.member.pluginBundle(actor.id, query.projectId, name);
  }

  @Post("activity")
  @HttpCode(201)
  @RequirePermission("member.read")
  @AllowMemberRead({ projectIdFrom: "body", write: true })
  @ApiOperation({ summary: "Record what a plugin did in the caller's harness (bounded, per member, shown in Monitoring)" })
  activity(@CurrentActor() actor: Actor, @Body({ schema: activityInputSchema }) body: z.infer<typeof activityInputSchema>) {
    return this.member.recordActivity(actor.id, body);
  }
}
