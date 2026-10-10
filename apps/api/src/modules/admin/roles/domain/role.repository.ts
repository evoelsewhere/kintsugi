// Port for installation access roles and permissions. Implemented by infrastructure adapters.

import type { CreateSubRole, PermissionRecord, RoleRecord } from "./role.js";

export abstract class RoleRepository {
  abstract list(): Promise<RoleRecord[]>;
  abstract get(id: string): Promise<RoleRecord | undefined>;
  abstract createSubRole(input: CreateSubRole): Promise<RoleRecord>;
  abstract removeSubRole(id: string): Promise<boolean>;
  abstract setPermissions(roleId: string, codes: string[]): Promise<RoleRecord | undefined>;
  abstract listPermissions(): Promise<PermissionRecord[]>;
  /** Effective permissions of a user = union of grants across their access roles. */
  abstract permissionsOfUser(userId: string): Promise<string[]>;
}
