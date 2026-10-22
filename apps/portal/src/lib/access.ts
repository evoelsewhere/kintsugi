// Who may do what, derived from the roles the API sends.

import type { RoleRecord, UserRecord } from "./api/identity";

/** The permission codes a member holds through all of their roles. */
export function permissionsOf(user: UserRecord, roles: readonly RoleRecord[]): Set<string> {
  return new Set(roles.filter((role) => user.roleIds.includes(role.id)).flatMap((role) => role.permissions));
}
