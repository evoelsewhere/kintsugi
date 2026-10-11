// Interface layer: thin HTTP adapter — validates input, maps DTOs to application
// commands, delegates to the use cases. No business logic here.

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "#common/auth/decorators.js";
import type { Incident } from "../domain/incident.js";
import { IncidentsService } from "../application/incidents.service.js";
import {
  type CreateIncidentInput,
  createIncidentSchema,
  type UpdateIncidentInput,
  updateIncidentSchema,
  toCreateCommand,
  toUpdateCommand,
} from "./incident.dto.js";

@ApiTags("delivery · hypercare & operate")
@Controller("delivery/hypercare")
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get()
  @ApiOperation({ summary: "List incidents" })
  @ApiOkResponse({ description: "The matching records." })
  list(): Promise<Incident[]> {
    return this.incidents.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one incident" })
  @ApiOkResponse({ description: "The record." })
  get(@Param("id") id: string): Promise<Incident> {
    return this.incidents.get(id);
  }

  @RequirePermission("workitems.manage")
  @Post()
  @ApiOperation({ summary: "Create a incident" })
  @ApiCreatedResponse({ description: "The created record." })
  create(@Body({ schema: createIncidentSchema }) input: CreateIncidentInput): Promise<Incident> {
    return this.incidents.create(toCreateCommand(input));
  }

  @RequirePermission("workitems.manage")
  @Patch(":id")
  @ApiOperation({ summary: "Update a incident" })
  @ApiOkResponse({ description: "The updated record." })
  update(@Param("id") id: string, @Body({ schema: updateIncidentSchema }) input: UpdateIncidentInput): Promise<Incident> {
    return this.incidents.update(id, toUpdateCommand(input));
  }

  @RequirePermission("workitems.manage")
  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a incident" })
  @ApiNoContentResponse({ description: "The record is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.incidents.remove(id);
  }
}
