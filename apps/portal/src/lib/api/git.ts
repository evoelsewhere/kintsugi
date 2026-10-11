// Typed access to Git servers and repositories (Settings → Git).
// Mirrors apps/api → modules/admin/git (ADR-0025). Credentials are write-only.

import type { GitServerKind } from "@kintsugi/domain";
import { apiGet, apiGetAll, apiSend } from "../api";

export type GitAuthType = "none" | "token" | "ssh-key";

export interface GitServerView {
  id: string;
  kind: GitServerKind;
  name: string;
  baseUrl: string;
  authType: GitAuthType;
  username?: string;
  knownHosts?: string;
  hasCredential: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GitServerInput {
  kind: GitServerKind;
  name: string;
  baseUrl: string;
  authType: GitAuthType;
  username?: string;
  /** Write-only; omit to keep the stored one. */
  token?: string;
  /** Write-only; omit to keep the stored one. */
  privateKey?: string;
  knownHosts?: string;
}

export type SyncStatus = "pending" | "cloning" | "ready" | "error";

export interface GitRepositoryView {
  id: string;
  serverId: string;
  url: string;
  defaultBranch?: string;
  syncStatus: SyncStatus;
  lastCommit?: string;
  lastSyncedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TestAccessResult {
  ok: boolean;
  message: string;
  defaultBranch?: string;
  branchCount?: number;
}

const SERVERS = "/api/admin/git-servers";
const REPOSITORIES = "/api/admin/git-repositories";

/** Name and email of kintsugi-bot's commits to document repos (installation setting). */
export interface CommitIdentityView {
  name: string;
  email: string;
  /** True while none was set: the built-in defaults apply. */
  isDefault: boolean;
  updatedBy?: string;
  updatedAt?: string;
}

const COMMIT_IDENTITY = "/api/admin/settings/commit-identity";

export const gitApi = {
  commitIdentity: () => apiGet<CommitIdentityView>(COMMIT_IDENTITY),
  setCommitIdentity: (input: { name: string; email: string }) => apiSend<CommitIdentityView>(COMMIT_IDENTITY, "PUT", input),
  listServers: () => apiGetAll<GitServerView>(SERVERS),
  getServer: (id: string) => apiGet<GitServerView>(`${SERVERS}/${id}`),
  createServer: (input: GitServerInput & { id: string }) => apiSend<GitServerView>(SERVERS, "POST", input),
  replaceServer: (id: string, input: GitServerInput) => apiSend<GitServerView>(`${SERVERS}/${id}`, "PATCH", input),
  removeServer: (id: string) => apiSend<void>(`${SERVERS}/${id}`, "DELETE"),
  testAccess: (serverId: string, url: string) => apiSend<TestAccessResult>(`${SERVERS}/${serverId}/test`, "POST", { url }),
  listRepositories: () => apiGetAll<GitRepositoryView>(REPOSITORIES),
  createRepository: (input: { id: string; serverId: string; url: string }) => apiSend<GitRepositoryView>(REPOSITORIES, "POST", input),
  removeRepository: (id: string) => apiSend<void>(`${REPOSITORIES}/${id}`, "DELETE"),
};
