// Typed access to member plugin grants (Project → Member plugins) and to what members' connections did
// (Monitoring → Members, ADR-0069). Mirrors apps/api → modules/admin/plugin-access and monitoring/member-activity.

import { apiGet, apiSend, type Page } from "../api";

/** The grant that covers every member with Project Access to the project. */
export const ALL_MEMBERS = "*";

export interface PluginAccessGrant {
  projectId: string;
  pluginName: string;
  /** A user id, or ALL_MEMBERS. */
  userId: string;
  grantedAt: string;
  grantedBy?: string;
}

export const pluginAccessApi = {
  list: (projectId: string) => apiGet<{ items: PluginAccessGrant[] }>(`/api/admin/plugin-access/${encodeURIComponent(projectId)}`),
  grant: (projectId: string, pluginName: string, userId: string) =>
    apiSend<void>(`/api/admin/plugin-access/${encodeURIComponent(projectId)}/${encodeURIComponent(pluginName)}/${encodeURIComponent(userId)}`, "PUT"),
  revoke: (projectId: string, pluginName: string, userId: string) =>
    apiSend<void>(`/api/admin/plugin-access/${encodeURIComponent(projectId)}/${encodeURIComponent(pluginName)}/${encodeURIComponent(userId)}`, "DELETE"),
};

export interface MemberUsage {
  userId: string;
  username: string;
  displayName: string;
  lastSeenAt: string;
  events: number;
  kinds: Record<string, number>;
  plugins: Record<string, number>;
}

export interface MemberUsageSummary {
  projectId: string;
  from: string;
  to: string;
  members: MemberUsage[];
}

export interface MemberActivity {
  id: string;
  at: string;
  userId: string;
  username: string;
  projectId: string;
  pluginName?: string;
  harness?: string;
  kind: string;
  summary: string;
  detail: Record<string, unknown>;
}

export const memberActivityApi = {
  summary: (projectId: string) => apiGet<MemberUsageSummary>(`/api/monitoring/member-activity/summary?projectId=${encodeURIComponent(projectId)}`),
  list: (projectId: string, options: { userId?: string; limit: number; offset: number }) => {
    const params = new URLSearchParams({ projectId, limit: String(options.limit), offset: String(options.offset) });
    if (options.userId !== undefined && options.userId !== "") params.set("userId", options.userId);
    return apiGet<Page<MemberActivity>>(`/api/monitoring/member-activity?${params.toString()}`);
  },
};
