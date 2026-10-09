import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UsersService } from "./users.service.js";
import {
  type CreateUserInput,
  createUserSchema,
  type UpdateUserInput,
  updateUserSchema,
  type User,
} from "./user.dto.js";

@ApiTags("admin · identity & access")
@Controller("admin/users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: "List users" })
  @ApiOkResponse({ description: "The matching user records." })
  list(): Promise<User[]> {
    return this.users.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one user" })
  @ApiOkResponse({ description: "The user." })
  get(@Param("id") id: string): Promise<User> {
    return this.users.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a user" })
  @ApiCreatedResponse({ description: "The created user." })
  create(@Body({ schema: createUserSchema }) input: CreateUserInput): Promise<User> {
    return this.users.create(input);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a user" })
  @ApiOkResponse({ description: "The updated user." })
  update(@Param("id") id: string, @Body({ schema: updateUserSchema }) input: UpdateUserInput): Promise<User> {
    return this.users.update(id, input);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a user" })
  @ApiNoContentResponse({ description: "The user is deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    await this.users.remove(id);
  }
}
