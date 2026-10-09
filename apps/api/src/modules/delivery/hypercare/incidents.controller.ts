import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IncidentsService } from "./incidents.service.js";
import {
  type CreateIncidentInput,
  createIncidentSchema,
  type UpdateIncidentInput,
  updateIncidentSchema,
  type Incident,
} from "./incident.dto.js";

@ApiTags("delivery · hypercare & operate")
@Controller("delivery/hypercare")
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get()
  @ApiOperation({ summary: "List incidents" })
  @ApiOkResponse({ description: "The matching incident records." })
  list(): Promise<Incident[]> {
    return this.incidents.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one incident" })
  @ApiOkResponse({ description: "The incident." })
  get(@Param("id") id: string): Promise<Incident> {
    return this.incidents.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a incident" })
  @ApiCreatedResponse({ description: "The created incident." })
  create(@Body({ schema: createIncidentSchema }) input: CreateIncidentInput): Promise<Incident> {
    return this.incidents.create(input);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a incident" })
  @ApiOkResponse({ description: "The updated incident." })
  update(@Param("id") id: string, @Body({ schema: updateIncidentSchema }) input: UpdateIncidentInput): Promise<Incident> {
    return this.incidents.update(id, input);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a incident" })
  @ApiNoContentResponse({ description: "The incident is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.incidents.remove(id);
  }
}
