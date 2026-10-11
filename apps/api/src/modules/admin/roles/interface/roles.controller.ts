// Interface layer: installation access-role management (dynamic permission grants per access role).

import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Page, PageQuery } from "#common/application/pagination.js";
import { pageQuerySchema } from "#common/interface/pagination.js";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import type { PermissionRecord, RoleRecord } from "../domain/role.js";
import { RolesService } from "../application/roles.service.js";
import {
  type CreateSubRoleInput,
  createSubRoleSchema,
  type SetPermissionsInput,
  setPermissionsSchema,
  toCreateCommand,
} from "./role.dto.js";

@ApiTags("admin · access roles & permissions")
@Controller("admin/roles")
@RequirePermission("roles.manage")
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermission("roles.manage", "members.manage") // members managers pick access roles to assign
  @ApiOperation({ summary: "List access roles with their granted permissions" })
  @ApiOkResponse({ description: "Primary access roles and admin-defined access sub-roles." })
  list(@Query({ schema: pageQuerySchema }) query: PageQuery): Promise<Page<RoleRecord>> {
    return this.roles.listPage(query);
  }

  @Get("permissions")
  @ApiOperation({ summary: "The permission catalog (added by migrations, granted per access role)" })
  @ApiOkResponse({ description: "All permission codes with their groups." })
  permissions(): Promise<PermissionRecord[]> {
    return this.roles.listPermissions();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one access role" })
  @ApiOkResponse({ description: "The access role with its grants." })
  get(@Param("id") id: string): Promise<RoleRecord> {
    return this.roles.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Create an access sub-role (admin-defined: dev, ba, tester, …)" })
  @ApiCreatedResponse({ description: "The created access sub-role." })
  createSubRole(@Body({ schema: createSubRoleSchema }) input: CreateSubRoleInput): Promise<RoleRecord> {
    return this.roles.createSubRole(toCreateCommand(input));
  }

  @Put(":id/permissions")
  @ApiOperation({ summary: "Replace an access role's permission grants" })
  @ApiOkResponse({ description: "The access role with its new grants." })
  setPermissions(
    @Param("id") id: string,
    @Body({ schema: setPermissionsSchema }) input: SetPermissionsInput,
    @CurrentActor() actor: Actor,
  ): Promise<RoleRecord> {
    return this.roles.setPermissions(id, input.permissions, actor);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Remove an access sub-role" })
  @ApiNoContentResponse({ description: "The access sub-role is removed." })
  async removeSubRole(@Param("id") id: string): Promise<void> {
    await this.roles.removeSubRole(id);
  }
}
