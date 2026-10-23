import { apiGet, apiSend } from "../api";
import type { CodingAgentConnectionLifetime, CodingAgentConnectionLifetimeView } from "./coding-agent-security-contract";
import { connectionListFromApi, type CodingAgentConnectionMetadata } from "./coding-agent-security-contract";

export type { CodingAgentConnectionLifetime, CodingAgentConnectionMetadata } from "./coding-agent-security-contract";
export { connectionListFromApi, sanitizeCodingAgentConnections } from "./coding-agent-security-contract";

export type { CodingAgentConnectionLifetimeView } from "./coding-agent-security-contract";

export const codingAgentSecurityApi = {
  lifetime: () => apiGet<CodingAgentConnectionLifetimeView>("/api/admin/settings/coding-agent-connection-lifetime"),
  setLifetime: (maxAgeDays: CodingAgentConnectionLifetime) =>
    apiSend<CodingAgentConnectionLifetimeView>("/api/admin/settings/coding-agent-connection-lifetime", "PUT", { maxAgeDays }),
  async connections(): Promise<CodingAgentConnectionMetadata[]> {
    return connectionListFromApi(await apiGet<unknown>("/api/admin/coding-agent-connections"));
  },
  revokeConnection: (connectionId: string) =>
    apiSend<void>(`/api/admin/coding-agent-connections/${encodeURIComponent(connectionId)}`, "DELETE"),
};
