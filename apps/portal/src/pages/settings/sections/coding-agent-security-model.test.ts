import { describe, expect, it } from "vitest";
import {
  canManageCodingAgentSecurity,
  connectionListFromApi,
  connectionRenewalExpired,
  codingAgentConnectionLifetimeOptions,
  sanitizeCodingAgentConnections,
} from "./coding-agent-security-model";

describe("coding agent security model", () => {
  it("offers only the supported 15- and 30-day connection ages", () => {
    expect(codingAgentConnectionLifetimeOptions).toEqual([
      { value: 15, label: "15 days" },
      { value: 30, label: "30 days" },
    ]);
  });

  it("allows policy management only with security.manage", () => {
    expect(canManageCodingAgentSecurity(["security.manage"])).toBe(true);
    expect(canManageCodingAgentSecurity(["member.read"])).toBe(false);
    expect(canManageCodingAgentSecurity([])).toBe(false);
  });

  it("marks a connection expired at its configured maximum age", () => {
    const createdAt = "2026-10-01T00:00:00.000Z";
    expect(connectionRenewalExpired(createdAt, 15, Date.parse("2026-10-15T23:59:59.999Z"))).toBe(false);
    expect(connectionRenewalExpired(createdAt, 15, Date.parse("2026-10-16T00:00:00.000Z"))).toBe(true);
    expect(connectionRenewalExpired(createdAt, 30, Date.parse("2026-10-16T00:00:00.000Z"))).toBe(false);
  });

  it("keeps only connection metadata and strips any unexpected credential fields", () => {
    const connection = {
      id: "conn-1",
      userId: "user-1",
      clientName: "Kintsugi CLI",
      projectIds: ["billing"],
      createdAt: "2026-10-22T00:00:00.000Z",
      lastUsedAt: "2026-10-22T01:00:00.000Z",
      accessToken: "knt_caw_secret",
      refreshToken: "knt_crt_secret",
    };
    expect(connectionListFromApi({ items: [connection], token: "should-not-be-used" })).toEqual([{
      id: "conn-1",
      userId: "user-1",
      clientName: "Kintsugi CLI",
      projectIds: ["billing"],
      createdAt: "2026-10-22T00:00:00.000Z",
      lastUsedAt: "2026-10-22T01:00:00.000Z",
    }]);
    expect(JSON.stringify(connectionListFromApi({ items: [connection] }))).not.toMatch(/knt_(?:caw|crt)_/);
    expect(sanitizeCodingAgentConnections([connection])).toHaveLength(1);
  });

  it("keeps API connection metadata when the response omits userId", () => {
    const connection = {
      id: "conn-api-shape",
      clientName: "Kintsugi CLI",
      projectIds: ["caw-e2e-20261023"],
      createdAt: "2026-10-23T01:01:33.419Z",
      lastUsedAt: "2026-10-23T01:19:03.252Z",
    };
    expect(connectionListFromApi({ items: [connection] })).toEqual([connection]);
  });
  it("drops malformed connection records rather than rendering untrusted values", () => {
    expect(sanitizeCodingAgentConnections([
      { id: "", userId: "user-1", clientName: "CLI", projectIds: [], createdAt: "2026-10-22T00:00:00.000Z" },
      { id: "conn-2", userId: "user-2", clientName: "CLI", projectIds: [2], createdAt: "not-a-date" },
    ])).toEqual([]);
  });
});
