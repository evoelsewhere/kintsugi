// Versioned, read-only HTTP interface for the local Coding Agent Workflow client.

import { Controller, createParamDecorator, Get, type ExecutionContext, Param, Query, UnauthorizedException } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AllowMemberRead, RequirePermission } from "#common/auth/decorators.js";
import type { AuthenticatedRequest, MemberPrincipal } from "#modules/core/auth/index.js";
import { AgentContextService } from "../application/agent-context.service.js";
import {
  documentQuerySchema,
  documentSearchQuerySchema,
  projectQuerySchema,
  reviewQuerySchema,
  taskBriefQuerySchema,
  taskQuerySchema,
  taskStatusQuerySchema,
  type DocumentQuery,
  type DocumentSearchQuery,
  type ProjectQuery,
  type ReviewQuery,
  type TaskBriefQuery,
  type TaskIdentity,
  type TaskQuery,
} from "./agent-context.dto.js";

const CurrentMemberPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext): MemberPrincipal => {
  const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().memberPrincipal;
  if (principal === undefined) throw new UnauthorizedException("A Coding Agent Workflow token is required");
  return principal;
});

@ApiTags("Coding Agent Workflow")
@Controller("member/v1")
export class AgentContextController {
  constructor(private readonly context: AgentContextService) {}

  @Get("projects")
  @RequirePermission("member.read")
  @AllowMemberRead({ projectIdFrom: "token-projects" })
  @ApiOperation({ summary: "List projects within token scope and current Project Access" })
  projects(
    @CurrentMemberPrincipal() principal: MemberPrincipal,
    @Query({ schema: projectQuerySchema }) query: ProjectQuery,
  ) {
    return this.context.listProjects(principal, query);
  }

  @Get("tasks")
  @RequirePermission("member.read")
  @AllowMemberRead({ projectIdFrom: "query" })
  @ApiOperation({ summary: "List indexed tasks and readiness for an authorized project" })
  tasks(
    @CurrentMemberPrincipal() principal: MemberPrincipal,
    @Query({ schema: taskQuerySchema }) query: TaskQuery,
  ) {
    return this.context.listTasks(principal, query);
  }

  @Get("task-brief")
  @RequirePermission("member.read")
  @AllowMemberRead({ projectIdFrom: "query" })
  @ApiOperation({ summary: "Prepare an immutable, cited task brief" })
  taskBrief(
    @CurrentMemberPrincipal() principal: MemberPrincipal,
    @Query({ schema: taskBriefQuerySchema }) query: TaskBriefQuery,
  ) {
    return this.context.briefTask(principal, query);
  }

  @Get("documents")
  @RequirePermission("member.read")
  @AllowMemberRead({ projectIdFrom: "query" })
  @ApiOperation({ summary: "Read a page from an authorized immutable task snapshot" })
  document(
    @CurrentMemberPrincipal() principal: MemberPrincipal,
    @Query({ schema: documentQuerySchema }) query: DocumentQuery,
  ) {
    return this.context.getDocument(principal, query);
  }

  @Get("search")
  @RequirePermission("member.read")
  @AllowMemberRead({ projectIdFrom: "query" })
  @ApiOperation({ summary: "Search sources in an authorized immutable task snapshot" })
  search(
    @CurrentMemberPrincipal() principal: MemberPrincipal,
    @Query({ schema: documentSearchQuerySchema }) query: DocumentSearchQuery,
  ) {
    return this.context.searchDocuments(principal, query);
  }

  @Get("task-status")
  @RequirePermission("member.read")
  @AllowMemberRead({ projectIdFrom: "query" })
  @ApiOperation({ summary: "Read workflow status and known gates for a task" })
  taskStatus(
    @CurrentMemberPrincipal() principal: MemberPrincipal,
    @Query({ schema: taskStatusQuerySchema }) query: TaskIdentity,
  ) {
    return this.context.taskStatus(principal, query);
  }

  @Get("reviews/:reviewId")
  @RequirePermission("member.read")
  @AllowMemberRead({ projectIdFrom: "query" })
  @ApiOperation({ summary: "Read a review report when review evidence is configured" })
  review(
    @CurrentMemberPrincipal() principal: MemberPrincipal,
    @Param("reviewId", { schema: reviewQuerySchema.shape.reviewId }) reviewId: string,
    @Query({ schema: reviewQuerySchema.omit({ reviewId: true }).strict() }) query: Omit<ReviewQuery, "reviewId">,
  ) {
    return this.context.getReview(principal, { ...query, reviewId });
  }
}
