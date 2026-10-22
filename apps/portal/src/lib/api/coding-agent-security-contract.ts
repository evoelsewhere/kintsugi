export type CodingAgentConnectionLifetime = 15 | 30;

export interface CodingAgentConnectionLifetimeView {
  maxAgeDays: CodingAgentConnectionLifetime;
  isDefault: boolean;
  updatedBy?: string;
  updatedAt?: string;
}

export interface CodingAgentConnectionMetadata {
  id: string;
  userId: string;
  clientName: string;
  projectIds: string[];
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** Drop unexpected fields at the API boundary, especially any credential-shaped response. */
export function sanitizeCodingAgentConnections(value: unknown): CodingAgentConnectionMetadata[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): CodingAgentConnectionMetadata[] => {
    if (!isRecord(item)
      || typeof item.id !== "string" || item.id.length === 0
      || typeof item.userId !== "string" || item.userId.length === 0
      || typeof item.clientName !== "string" || item.clientName.length === 0
      || !Array.isArray(item.projectIds) || !item.projectIds.every((id) => typeof id === "string")
      || !validTimestamp(item.createdAt)
      || (item.lastUsedAt !== undefined && !validTimestamp(item.lastUsedAt))
      || (item.revokedAt !== undefined && !validTimestamp(item.revokedAt))) return [];
    return [{
      id: item.id,
      userId: item.userId,
      clientName: item.clientName,
      projectIds: [...item.projectIds] as string[],
      createdAt: item.createdAt,
      ...(typeof item.lastUsedAt === "string" ? { lastUsedAt: item.lastUsedAt } : {}),
      ...(typeof item.revokedAt === "string" ? { revokedAt: item.revokedAt } : {}),
    }];
  });
}

export function connectionListFromApi(value: unknown): CodingAgentConnectionMetadata[] {
  return isRecord(value) ? sanitizeCodingAgentConnections(value.items) : [];
}
