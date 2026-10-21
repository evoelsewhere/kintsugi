import { createHash } from "node:crypto";
import { Body, Controller, Get, Param, Post, Req, UnauthorizedException } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import { sessionToken } from "#common/auth/session-cookie.js";
import { GatePublicationService } from "../application/gate-publication.service.js";
import type { GateDecisionResult, GatePublication } from "../domain/gate-publication.js";
import { type RequestGateDecisionInput, requestGateDecisionSchema } from "./gate-publication.dto.js";

@ApiTags("governance · evidence-bound gate publication")
@Controller("governance/gate-publications")
@RequirePermission("gates.decide")
export class GatePublicationController {
  constructor(private readonly publications: GatePublicationService) {}

  @Post()
  @ApiOperation({ summary: "Record an authorized gate decision and publish its evidence through a reviewed document-repository PR" })
  @ApiCreatedResponse({ description: "The evidence-bound decision or its current evidence blockers." })
  requestDecision(
    @Body({ schema: requestGateDecisionSchema }) body: RequestGateDecisionInput,
    @CurrentActor() actor: Actor,
    @Req() request: Request,
  ): Promise<GateDecisionResult> {
    const token = sessionToken(request);
    if (token === undefined) throw new UnauthorizedException("An authenticated session is required");
    const authorizationId = "session:" + createHash("sha256").update(token, "utf8").digest("hex");
    return this.publications.requestDecision(actor, authorizationId, body);
  }

  @Get(":decisionId")
  @ApiOperation({ summary: "Get publication, merge and effective-gate status" })
  @ApiOkResponse({ description: "The evidence-bound gate publication." })
  get(@Param("decisionId") decisionId: string, @CurrentActor() actor: Actor): Promise<GatePublication> {
    return this.publications.get(decisionId, actor);
  }
}
