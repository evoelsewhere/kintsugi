import { apiGet, apiSend } from "../api";
import { connectionListFromApi, type CodingAgentConnectionMetadata } from "./coding-agent-security";

export interface MemberInstallation {
  baseUrl: string;
}

export interface MemberAuthorizeInput {
  projectId: string;
  clientName: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

export interface MemberTokenMetadata {
  id: string;
  name: string;
  projectIds: string[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export const memberApi = {
  installation: () => apiGet<MemberInstallation>("/api/auth/coding-agent/installation"),
  authorize: (input: MemberAuthorizeInput) => apiSend<{ redirectTo: string }>("/api/auth/coding-agent/authorize", "POST", input),
  tokens: () => apiGet<{ items: MemberTokenMetadata[] }>("/api/auth/member-tokens"),
  revokeToken: (tokenId: string) => apiSend<void>(`/api/auth/member-tokens/${encodeURIComponent(tokenId)}`, "DELETE"),
  async connections(): Promise<CodingAgentConnectionMetadata[]> {
    return connectionListFromApi(await apiGet<unknown>("/api/auth/member-connections"));
  },
  revokeConnection: (connectionId: string) => apiSend<void>(`/api/auth/member-connections/${encodeURIComponent(connectionId)}`, "DELETE"),
};
