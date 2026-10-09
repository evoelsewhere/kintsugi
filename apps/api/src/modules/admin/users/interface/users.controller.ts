// Interface layer: members management (Admin · Identity & Access, A2).

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "../../../../common/auth/decorators.js";
import type { UserRecord } from "../domain/user.js";
import { UsersService } from "../application/users.service.js";
import {
  type CreateUserInput,
  createUserSchema,
  type SetPasswordInput,
  setPasswordSchema,
  type UpdateUserInput,
  toCreateCommand,
  toUpdateCommand,
  updateUserSchema,
} from "./user.dto.js";

@ApiTags("admin · members")
@Controller("admin/users")
@RequirePermission("members.manage")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: "List members with their roles" })
  @ApiOkResponse({ description: "The members." })
  list(): Promise<UserRecord[]> {
    return this.users.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one member" })
  @ApiOkResponse({ description: "The member." })
  get(@Param("id") id: string): Promise<UserRecord> {
    return this.users.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a member" })
  @ApiCreatedResponse({ description: "The created member." })
  create(@Body({ schema: createUserSchema }) input: CreateUserInput): Promise<UserRecord> {
    return this.users.create(toCreateCommand(input));
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a member (profile, enabled, roles)" })
  @ApiOkResponse({ description: "The updated member." })
  update(@Param("id") id: string, @Body({ schema: updateUserSchema }) input: UpdateUserInput): Promise<UserRecord> {
    return this.users.update(id, toUpdateCommand(input));
  }

  @Post(":id/password")
  @HttpCode(204)
  @ApiOperation({ summary: "Reset a member's password" })
  @ApiNoContentResponse({ description: "The password is updated." })
  async setPassword(@Param("id") id: string, @Body({ schema: setPasswordSchema }) input: SetPasswordInput): Promise<void> {
    await this.users.setPassword(id, input.password);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Remove a member" })
  @ApiNoContentResponse({ description: "The member is removed." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.users.remove(id);
  }
}
