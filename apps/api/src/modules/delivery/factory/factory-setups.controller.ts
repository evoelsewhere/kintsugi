import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { FactorySetupsService } from "./factory-setups.service.js";
import {
  type CreateFactorySetupInput,
  createFactorySetupSchema,
  type UpdateFactorySetupInput,
  updateFactorySetupSchema,
  type FactorySetup,
} from "./factory-setup.dto.js";

@ApiTags("delivery · factory setup")
@Controller("delivery/factory")
export class FactorySetupsController {
  constructor(private readonly factorySetups: FactorySetupsService) {}

  @Get()
  @ApiOperation({ summary: "List factory setups" })
  @ApiOkResponse({ description: "The matching factory-setup records." })
  list(): Promise<FactorySetup[]> {
    return this.factorySetups.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one factory-setup" })
  @ApiOkResponse({ description: "The factory-setup." })
  get(@Param("id") id: string): Promise<FactorySetup> {
    return this.factorySetups.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a factory-setup" })
  @ApiCreatedResponse({ description: "The created factory-setup." })
  create(@Body({ schema: createFactorySetupSchema }) input: CreateFactorySetupInput): Promise<FactorySetup> {
    return this.factorySetups.create(input);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a factory-setup" })
  @ApiOkResponse({ description: "The updated factory-setup." })
  update(@Param("id") id: string, @Body({ schema: updateFactorySetupSchema }) input: UpdateFactorySetupInput): Promise<FactorySetup> {
    return this.factorySetups.update(id, input);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a factory-setup" })
  @ApiNoContentResponse({ description: "The factory-setup is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.factorySetups.remove(id);
  }
}
