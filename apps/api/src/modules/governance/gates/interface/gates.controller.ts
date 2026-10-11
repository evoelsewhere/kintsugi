// Interface layer: thin HTTP adapter of gates. Reading needs a session; requesting a gate needs
// gates.request (or gates.decide); deciding needs gates.decide.

import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Page } from "#common/application/pagination.js";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import { GatesService } from "../application/gates.service.js";
import type { Gate } from "../domain/gate.js";
import { type DecideGateInput, type ListGatesQuery, type RequestGateInput, decideGateSchema, listGatesQuerySchema, requestGateSchema } from "./gate.dto.js";

@ApiTags("governance · quality gates")
@Controller("governance/gates")
export class GatesController {
  constructor(private readonly gates: GatesService) {}

  @Get()
  @ApiOperation({ summary: "List gates, newest request first (filter by project, application, gate key, status list)" })
  @ApiOkResponse({ description: "A page of gates." })
  list(@Query({ schema: listGatesQuerySchema }) query: ListGatesQuery): Promise<Page<Gate>> {
    return this.gates.list(
      {
        ...(query.projectId === undefined ? {} : { projectId: query.projectId }),
        ...(query.applicationId === undefined ? {} : { applicationId: query.applicationId }),
        ...(query.gateKey === undefined ? {} : { gateKey: query.gateKey }),
        ...(query.status === undefined ? {} : { statuses: query.status }),
      },
      { limit: query.limit, offset: query.offset },
    );
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one gate" })
  @ApiOkResponse({ description: "The gate." })
  get(@Param("id") id: string): Promise<Gate> {
    return this.gates.get(id);
  }

  @Get(":id/history")
  @ApiOperation({ summary: "Every request of the same project, application and gate key, newest first" })
  @ApiOkResponse({ description: "The gate's history, this gate included." })
  history(@Param("id") id: string): Promise<Gate[]> {
    return this.gates.history(id);
  }

  @RequirePermission("gates.request", "gates.decide")
  @Post()
  @ApiOperation({ summary: "Request a decision on a gate (pending until decided); 409 when the same gate is already pending" })
  @ApiCreatedResponse({ description: "The pending gate." })
  request(@Body({ schema: requestGateSchema }) body: RequestGateInput, @CurrentActor() actor: Actor): Promise<Gate> {
    return this.gates.request(
      {
        projectId: body.projectId,
        gateKey: body.gateKey,
        title: body.title,
        ...(body.applicationId === undefined ? {} : { applicationId: body.applicationId }),
        ...(body.subject === undefined ? {} : { subject: body.subject }),
        ...(body.detail === undefined ? {} : { detail: body.detail }),
      },
      actor,
    );
  }

  @RequirePermission("gates.decide")
  @Post(":id/decision")
  @HttpCode(200)
  @ApiOperation({ summary: "Approve, reject or waive a pending gate (a note is required to reject or waive); 409 once decided" })
  @ApiOkResponse({ description: "The decided gate." })
  decide(@Param("id") id: string, @Body({ schema: decideGateSchema }) body: DecideGateInput, @CurrentActor() actor: Actor): Promise<Gate> {
    return this.gates.decide(id, { decision: body.decision, ...(body.note === undefined ? {} : { note: body.note }) }, actor);
  }
}
