import { apiGet, apiSend } from "../api";
import type {
  DocumentSearchQuery,
  ListResult,
  ReviewQuery,
  ReviewReport,
  SourceHit,
  TaskBrief,
  TaskBriefQuery,
  TaskIdentity,
  TaskQuery,
  TaskStatus,
  TaskSummary,
} from "@kintsugi/harness-sdk";

export interface MemberTokenMetadata {
  id: string;
  name: string;
  projectIds: string[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface IssuedMemberToken {
  token: string;
  metadata: MemberTokenMetadata;
}

export interface ProjectAccessGrant {
  projectId: string;
  userId: string;
  grantedAt: string;
  grantedBy?: string;
}

function query(values: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params.toString();
}

export const agentContextApi = {
  tasks(input: TaskQuery): Promise<ListResult<TaskSummary>> {
    return apiGet(`/api/member/v1/tasks?${query(input)}`);
  },
  brief(input: TaskBriefQuery): Promise<TaskBrief> {
    return apiGet(`/api/member/v1/task-brief?${query(input)}`);
  },
  status(input: TaskIdentity): Promise<TaskStatus> {
    return apiGet(`/api/member/v1/task-status?${query(input)}`);
  },
  review(input: ReviewQuery): Promise<ReviewReport> {
    const { reviewId, ...filters } = input;
    return apiGet(`/api/member/v1/reviews/${encodeURIComponent(reviewId)}?${query(filters)}`);
  },
  tokens: () => apiGet<{ items: MemberTokenMetadata[] }>("/api/auth/member-tokens"),
  issueToken: (input: { name: string; projectIds: string[]; expiresAt: string }) =>
    apiSend<IssuedMemberToken>("/api/auth/member-tokens", "POST", input),
  revokeToken: (tokenId: string) => apiSend<void>(`/api/auth/member-tokens/${encodeURIComponent(tokenId)}`, "DELETE"),
  projectAccess: (projectId: string) => apiGet<{ items: ProjectAccessGrant[] }>(`/api/admin/project-access/${encodeURIComponent(projectId)}`),
  grantProjectAccess: (projectId: string, userId: string) =>
    apiSend<void>(`/api/admin/project-access/${encodeURIComponent(projectId)}/${encodeURIComponent(userId)}`, "PUT"),
  revokeProjectAccess: (projectId: string, userId: string) =>
    apiSend<void>(`/api/admin/project-access/${encodeURIComponent(projectId)}/${encodeURIComponent(userId)}`, "DELETE"),
  search: (input: DocumentSearchQuery) => apiGet<ListResult<SourceHit>>(`/api/member/v1/search?${query(input)}`),
};

export interface GatePublication {
  decisionId: string;
  projectId: string;
  unitId: string;
  gateId: string;
  decision: "approved" | "rejected" | "waived";
  state: "pending-publication" | "awaiting-merge" | "effective" | "stale" | "failed" | "rejected";
  evidenceHash: string;
  recordPath: string;
  documentWriteId: string;
  documentWriteStatus: string;
  createdAt: string;
  updatedAt: string;
  prUrl?: string;
  recordCommit?: string;
}

export interface GatePublicationPage {
  items: GatePublication[];
  total: number;
  limit: number;
  offset: number;
}

export const gatePublicationsApi = {
  list: (projectId: string, options: { limit?: number; offset?: number } = {}) =>
    apiGet<GatePublicationPage>(`/api/governance/gate-publications?${query({ projectId, limit: options.limit ?? 10, offset: options.offset ?? 0 })}`),
};

export type { TaskBrief, TaskSummary, TaskStatus };
