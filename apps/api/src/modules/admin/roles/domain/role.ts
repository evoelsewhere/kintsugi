// Domain of roles & permissions (Roles & Permissions UI): primary roles and admin-defined
// sub-roles, plus the dynamic permission catalog (rows in core.permission, added by
// migrations so they appear automatically in the UI). Pure types — no framework, no I/O.

export type RoleKind = "primary" | "sub";

export interface RoleRecord {
  id: string;
  kind: RoleKind;
  name: string;
  description: string;
  /** Granted permission codes. */
  permissions: string[];
}

export interface PermissionRecord {
  code: string;
  group: string;
  description: string;
}

export interface CreateSubRole {
  id: string;
  name: string;
  description?: string;
}

/** The seeded primary role that administers the installation. */
export const ADMIN_ROLE_ID = "admin";

/** Grants the admin role can never lose — without them nobody could repair members or roles. */
export const ADMIN_LOCKED_PERMISSIONS: readonly string[] = ["members.manage", "roles.manage"];
