// Domain of members (Admin · Identity & Access, A2): users and their access-role assignments.
// Pure types — no framework, no I/O.

export interface UserRecord {
  id: string;
  username: string;
  email: string;
  displayName: string;
  enabled: boolean;
  /** Access-role ids: one primary access role plus optional access sub-roles. */
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
