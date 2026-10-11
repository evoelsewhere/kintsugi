// Interface layer: thin HTTP adapter — validates input, maps DTOs to application
// commands, delegates to the use cases. No business logic here.

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "#common/auth/decorators.js";
import type { Policy } from "../domain/policy.js";
import { PoliciesService } from "../application/policies.service.js";
import {
  type CreatePolicyInput,
  createPolicySchema,
  type UpdatePolicyInput,
  updatePolicySchema,
  toCreateCommand,
  toUpdateCommand,
} from "./policy.dto.js";

@ApiTags("governance · policy engine")
@Controller("governance/policies")
export class PoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  @Get()
  @ApiOperation({ summary: "List policies" })
  @ApiOkResponse({ description: "The matching records." })
  list(): Promise<Policy[]> {
    return this.policies.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one policy" })
  @ApiOkResponse({ description: "The record." })
  get(@Param("id") id: string): Promise<Policy> {
    return this.policies.get(id);
  }

  @RequirePermission("governance.manage")
  @Post()
  @ApiOperation({ summary: "Create a policy" })
  @ApiCreatedResponse({ description: "The created record." })
  create(@Body({ schema: createPolicySchema }) input: CreatePolicyInput): Promise<Policy> {
    return this.policies.create(toCreateCommand(input));
  }

  @RequirePermission("governance.manage")
  @Patch(":id")
  @ApiOperation({ summary: "Update a policy" })
  @ApiOkResponse({ description: "The updated record." })
  update(@Param("id") id: string, @Body({ schema: updatePolicySchema }) input: UpdatePolicyInput): Promise<Policy> {
    return this.policies.update(id, toUpdateCommand(input));
  }

  @RequirePermission("governance.manage")
  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a policy" })
  @ApiNoContentResponse({ description: "The record is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.policies.remove(id);
  }
}
