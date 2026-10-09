// Interface layer: thin HTTP adapter — validates input, maps DTOs to application
// commands, delegates to the use cases. No business logic here.

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Connector } from "../domain/connector.js";
import { ConnectorsService } from "../application/connectors.service.js";
import {
  type CreateConnectorInput,
  createConnectorSchema,
  type UpdateConnectorInput,
  updateConnectorSchema,
  toCreateCommand,
  toUpdateCommand,
} from "./connector.dto.js";

@ApiTags("admin · connectors")
@Controller("admin/connectors")
export class ConnectorsController {
  constructor(private readonly connectors: ConnectorsService) {}

  @Get()
  @ApiOperation({ summary: "List connectors" })
  @ApiOkResponse({ description: "The matching records." })
  list(): Promise<Connector[]> {
    return this.connectors.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one connector" })
  @ApiOkResponse({ description: "The record." })
  get(@Param("id") id: string): Promise<Connector> {
    return this.connectors.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a connector" })
  @ApiCreatedResponse({ description: "The created record." })
  create(@Body({ schema: createConnectorSchema }) input: CreateConnectorInput): Promise<Connector> {
    return this.connectors.create(toCreateCommand(input));
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a connector" })
  @ApiOkResponse({ description: "The updated record." })
  update(@Param("id") id: string, @Body({ schema: updateConnectorSchema }) input: UpdateConnectorInput): Promise<Connector> {
    return this.connectors.update(id, toUpdateCommand(input));
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a connector" })
  @ApiNoContentResponse({ description: "The record is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.connectors.remove(id);
  }
}
