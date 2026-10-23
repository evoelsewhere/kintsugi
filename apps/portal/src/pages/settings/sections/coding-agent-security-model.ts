import type { CodingAgentConnectionLifetime } from "@/lib/api/coding-agent-security-contract";
export { connectionListFromApi, sanitizeCodingAgentConnections } from "@/lib/api/coding-agent-security-contract";
export type { CodingAgentConnectionLifetime, CodingAgentConnectionMetadata } from "@/lib/api/coding-agent-security-contract";

export const codingAgentConnectionLifetimeOptions: ReadonlyArray<{ value: CodingAgentConnectionLifetime; label: string }> = [
  { value: 15, label: "15 days" },
  { value: 30, label: "30 days" },
];

export function canManageCodingAgentSecurity(permissions: readonly string[]): boolean {
  return permissions.includes("security.manage");
}

export function connectionRenewalDeadline(createdAt: string, maxAgeDays: CodingAgentConnectionLifetime): string {
  return new Date(Date.parse(createdAt) + maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
}

export function connectionRenewalExpired(createdAt: string, maxAgeDays: CodingAgentConnectionLifetime, now = Date.now()): boolean {
  return Date.parse(connectionRenewalDeadline(createdAt, maxAgeDays)) <= now;
}
