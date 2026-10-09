import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PoliciesService } from "./policies.service.js";
import {
  type CreatePolicyInput,
  createPolicySchema,
  type UpdatePolicyInput,
  updatePolicySchema,
  type Policy,
} from "./policy.dto.js";

@ApiTags("governance · policy engine")
@Controller("governance/policies")
export class PoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  @Get()
  @ApiOperation({ summary: "List policies" })
  @ApiOkResponse({ description: "The matching policy records." })
  list(): Promise<Policy[]> {
    return this.policies.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one policy" })
  @ApiOkResponse({ description: "The policy." })
  get(@Param("id") id: string): Promise<Policy> {
    return this.policies.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a policy" })
  @ApiCreatedResponse({ description: "The created policy." })
  create(@Body({ schema: createPolicySchema }) input: CreatePolicyInput): Promise<Policy> {
    return this.policies.create(input);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a policy" })
  @ApiOkResponse({ description: "The updated policy." })
  update(@Param("id") id: string, @Body({ schema: updatePolicySchema }) input: UpdatePolicyInput): Promise<Policy> {
    return this.policies.update(id, input);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a policy" })
  @ApiNoContentResponse({ description: "The policy is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.policies.remove(id);
  }
}
