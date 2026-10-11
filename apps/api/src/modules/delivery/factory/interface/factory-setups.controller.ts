// Interface layer: thin HTTP adapter — validates input, maps DTOs to application
// commands, delegates to the use cases. No business logic here.

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "#common/auth/decorators.js";
import type { FactorySetup } from "../domain/factory-setup.js";
import { FactorySetupsService } from "../application/factory-setups.service.js";
import {
  type CreateFactorySetupInput,
  createFactorySetupSchema,
  type UpdateFactorySetupInput,
  updateFactorySetupSchema,
  toCreateCommand,
  toUpdateCommand,
} from "./factory-setup.dto.js";

@ApiTags("delivery · factory setup")
@Controller("delivery/factory")
export class FactorySetupsController {
  constructor(private readonly factorySetups: FactorySetupsService) {}

  @Get()
  @ApiOperation({ summary: "List factory setups" })
  @ApiOkResponse({ description: "The matching records." })
  list(): Promise<FactorySetup[]> {
    return this.factorySetups.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one factory setup" })
  @ApiOkResponse({ description: "The record." })
  get(@Param("id") id: string): Promise<FactorySetup> {
    return this.factorySetups.get(id);
  }

  @RequirePermission("workitems.manage")
  @Post()
  @ApiOperation({ summary: "Create a factory setup" })
  @ApiCreatedResponse({ description: "The created record." })
  create(@Body({ schema: createFactorySetupSchema }) input: CreateFactorySetupInput): Promise<FactorySetup> {
    return this.factorySetups.create(toCreateCommand(input));
  }

  @RequirePermission("workitems.manage")
  @Patch(":id")
  @ApiOperation({ summary: "Update a factory setup" })
  @ApiOkResponse({ description: "The updated record." })
  update(@Param("id") id: string, @Body({ schema: updateFactorySetupSchema }) input: UpdateFactorySetupInput): Promise<FactorySetup> {
    return this.factorySetups.update(id, toUpdateCommand(input));
  }

  @RequirePermission("workitems.manage")
  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a factory setup" })
  @ApiNoContentResponse({ description: "The record is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.factorySetups.remove(id);
  }
}
