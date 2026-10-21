// Versioned, read-only HTTP interface for the local Coding Agent Workflow client.

import {
  BadRequestException,
  Controller,
  createParamDecorator,
  ForbiddenException,
  Get,
  type ExecutionContext,
  HttpException,
  Param,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AllowMemberRead, RequirePermission } from "#common/auth/decorators.js";
import { bearerToken } from "#common/auth/session-cookie.js";
import { openEventStream } from "#common/interface/sse.js";
import type { AuthenticatedRequest, MemberPrincipal } from "#modules/core/auth/index.js";
import { AgentContextService } from "../application/agent-context.service.js";
import { MemberEventService } from "../application/member-event.service.js";
import {
  documentQuerySchema,
  documentSearchQuerySchema,
  projectQuerySchema,
  reviewQuerySchema,
  taskBriefQuerySchema,
  taskEventQuerySchema,
  taskQuerySchema,
  taskStatusQuerySchema,
  type DocumentQuery,
  type DocumentSearchQuery,
  type ProjectQuery,
  type ReviewQuery,
  type TaskBriefQuery,
  type TaskIdentity,
  type TaskEventQuery,
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
  constructor(
    private readonly context: AgentContextService,
    private readonly events: MemberEventService,
  ) {}

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

  @Get("task-events")
  @RequirePermission("member.read")
  @AllowMemberRead({ projectIdFrom: "query" })
  @ApiOperation({ summary: "Watch retained task events and resume from Last-Event-ID" })
  async taskEvents(
    @CurrentMemberPrincipal() principal: MemberPrincipal,
    @Query({ schema: taskEventQuerySchema }) query: TaskEventQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const lastEventHeader = request.headers["last-event-id"];
    if (Array.isArray(lastEventHeader)) throw new BadRequestException("Last-Event-ID must be a single event id");
    const token = bearerToken(request);
    if (token === undefined) throw new UnauthorizedException("A Coding Agent Workflow bearer token is required");

    // Prepare before writing headers so an expired or out-of-scope cursor is a normal 409 envelope.
    const prepared = await this.events.prepare(principal, query, lastEventHeader);
    const stream = openEventStream(request, response);
    try {
      for await (const event of this.events.follow(prepared, token, stream.signal)) {
        stream.send("task-event", event, event.id);
      }
    } catch (error) {
      if (!stream.signal.aborted) stream.send("error", memberEventStreamError(error));
    } finally {
      stream.close();
    }
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

function memberEventStreamError(error: unknown): { code: string; message: string } {
  if (error instanceof UnauthorizedException) {
    return { code: "MEMBER_EVENT_UNAUTHENTICATED", message: "The Coding Agent Workflow token expired or was revoked. Authenticate again." };
  }
  if (error instanceof ForbiddenException) {
    return { code: "MEMBER_EVENT_ACCESS_REVOKED", message: "Member read access or Project Access was revoked. Fetch task_status after access is restored." };
  }
  if (error instanceof HttpException && error.getStatus() === 409) {
    return { code: "MEMBER_EVENT_CURSOR_EXPIRED", message: "The task event cursor is no longer available; fetch task_status and start a new watch." };
  }
  return { code: "MEMBER_EVENT_STREAM_FAILED", message: "The task event stream failed. Fetch task_status before reconnecting." };
}
