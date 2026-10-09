// Interface layer: roles & permissions management (dynamic permission grants per role).

import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "../../../../common/auth/decorators.js";
import type { PermissionRecord, RoleRecord } from "../domain/role.js";
import { RolesService } from "../application/roles.service.js";
import {
  type CreateSubRoleInput,
  createSubRoleSchema,
  type SetPermissionsInput,
  setPermissionsSchema,
  toCreateCommand,
} from "./role.dto.js";

@ApiTags("admin · roles & permissions")
@Controller("admin/roles")
@RequirePermission("roles.manage")
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @ApiOperation({ summary: "List roles with their granted permissions" })
  @ApiOkResponse({ description: "Primary roles and admin-defined sub-roles." })
  list(): Promise<RoleRecord[]> {
    return this.roles.list();
  }

  @Get("permissions")
  @ApiOperation({ summary: "The permission catalog (added by migrations, granted per role)" })
  @ApiOkResponse({ description: "All permission codes with their groups." })
  permissions(): Promise<PermissionRecord[]> {
    return this.roles.listPermissions();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one role" })
  @ApiOkResponse({ description: "The role with its grants." })
  get(@Param("id") id: string): Promise<RoleRecord> {
    return this.roles.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a sub-role (admin-defined: dev, ba, tester, …)" })
  @ApiCreatedResponse({ description: "The created sub-role." })
  createSubRole(@Body({ schema: createSubRoleSchema }) input: CreateSubRoleInput): Promise<RoleRecord> {
    return this.roles.createSubRole(toCreateCommand(input));
  }

  @Put(":id/permissions")
  @ApiOperation({ summary: "Replace a role's permission grants" })
  @ApiOkResponse({ description: "The role with its new grants." })
  setPermissions(@Param("id") id: string, @Body({ schema: setPermissionsSchema }) input: SetPermissionsInput): Promise<RoleRecord> {
    return this.roles.setPermissions(id, input.permissions);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Remove a sub-role" })
  @ApiNoContentResponse({ description: "The sub-role is removed." })
  async removeSubRole(@Param("id") id: string): Promise<void> {
    await this.roles.removeSubRole(id);
  }
}
