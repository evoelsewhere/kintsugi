// Typed access to identity & access APIs (members, roles, dynamic permissions).

import { apiGet, apiGetAll, apiSend } from "../api";

export interface RoleRecord {
  id: string;
  kind: "primary" | "sub";
  name: string;
  description: string;
  permissions: string[];
}

export interface PermissionRecord {
  code: string;
  group: string;
  description: string;
}

export interface UserRecord {
  id: string;
  username: string;
  email: string;
  displayName: string;
  enabled: boolean;
  roleIds: string[];
  createdAt?: string;
}

export interface CreateUserInput {
  username: string;
  password: string;
  email?: string;
  displayName?: string;
  roleIds?: string[];
}

export const identityApi = {
  roles: () => apiGetAll<RoleRecord>("/api/admin/roles"),
  permissions: () => apiGet<PermissionRecord[]>("/api/admin/roles/permissions"),
  createSubRole: (input: { id: string; name: string; description?: string }) => apiSend<RoleRecord>("/api/admin/roles", "POST", input),
  deleteSubRole: (id: string) => apiSend<void>(`/api/admin/roles/${id}`, "DELETE"),
  setPermissions: (id: string, permissions: string[]) => apiSend<RoleRecord>(`/api/admin/roles/${id}/permissions`, "PUT", { permissions }),

  users: () => apiGetAll<UserRecord>("/api/admin/users"),
  createUser: (input: CreateUserInput) => apiSend<UserRecord>("/api/admin/users", "POST", input),
  updateUser: (id: string, input: Partial<CreateUserInput> & { enabled?: boolean; roleIds?: string[] }) =>
    apiSend<UserRecord>(`/api/admin/users/${id}`, "PATCH", input),
  setPassword: (id: string, password: string) => apiSend<void>(`/api/admin/users/${id}/password`, "POST", { password }),
  deleteUser: (id: string) => apiSend<void>(`/api/admin/users/${id}`, "DELETE"),
};
