// Interface layer: thin HTTP adapter — validates input, maps DTOs to application
// commands, delegates to the use cases. No business logic here.

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { User } from "../domain/user.js";
import { UsersService } from "../application/users.service.js";
import {
  type CreateUserInput,
  createUserSchema,
  type UpdateUserInput,
  updateUserSchema,
  toCreateCommand,
  toUpdateCommand,
} from "./user.dto.js";

@ApiTags("admin · identity & access")
@Controller("admin/users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: "List users" })
  @ApiOkResponse({ description: "The matching records." })
  list(): Promise<User[]> {
    return this.users.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one user" })
  @ApiOkResponse({ description: "The record." })
  get(@Param("id") id: string): Promise<User> {
    return this.users.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a user" })
  @ApiCreatedResponse({ description: "The created record." })
  create(@Body({ schema: createUserSchema }) input: CreateUserInput): Promise<User> {
    return this.users.create(toCreateCommand(input));
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a user" })
  @ApiOkResponse({ description: "The updated record." })
  update(@Param("id") id: string, @Body({ schema: updateUserSchema }) input: UpdateUserInput): Promise<User> {
    return this.users.update(id, toUpdateCommand(input));
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a user" })
  @ApiNoContentResponse({ description: "The record is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.users.remove(id);
  }
}
