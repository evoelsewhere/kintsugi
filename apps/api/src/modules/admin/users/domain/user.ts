// Domain of members (Admin · Identity & Access, A2): users and their role assignments.
// Pure types — no framework, no I/O.

export interface UserRecord {
  id: string;
  username: string;
  email: string;
  displayName: string;
  enabled: boolean;
  /** Role ids: one primary role plus optional sub-roles. */
  roleIds: string[];
  createdAt: string;
}

export interface CreateUser {
  username: string;
  password: string;
  email?: string;
  displayName?: string;
  roleIds?: string[];
}

export interface UpdateUser {
  email?: string;
  displayName?: string;
  enabled?: boolean;
  roleIds?: string[];
}
