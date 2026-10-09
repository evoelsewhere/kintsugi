import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ConnectorsService } from "./connectors.service.js";
import {
  type CreateConnectorInput,
  createConnectorSchema,
  type UpdateConnectorInput,
  updateConnectorSchema,
  type Connector,
} from "./connector.dto.js";

@ApiTags("admin · connectors")
@Controller("admin/connectors")
export class ConnectorsController {
  constructor(private readonly connectors: ConnectorsService) {}

  @Get()
  @ApiOperation({ summary: "List connectors" })
  @ApiOkResponse({ description: "The matching connector records." })
  list(): Promise<Connector[]> {
    return this.connectors.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one connector" })
  @ApiOkResponse({ description: "The connector." })
  get(@Param("id") id: string): Promise<Connector> {
    return this.connectors.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a connector" })
  @ApiCreatedResponse({ description: "The created connector." })
  create(@Body({ schema: createConnectorSchema }) input: CreateConnectorInput): Promise<Connector> {
    return this.connectors.create(input);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a connector" })
  @ApiOkResponse({ description: "The updated connector." })
  update(@Param("id") id: string, @Body({ schema: updateConnectorSchema }) input: UpdateConnectorInput): Promise<Connector> {
    return this.connectors.update(id, input);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a connector" })
  @ApiNoContentResponse({ description: "The connector is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.connectors.remove(id);
  }
}
