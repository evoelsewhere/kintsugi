import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../src/common/db/pool.js", () => ({ getPool: () => ({ query }) }));

import { PgMemberEventReader } from "../../src/modules/delivery/agent-context/infrastructure/pg-member-event.reader.js";

describe("PgMemberEventReader", () => {
  beforeEach(() => query.mockReset());

  it("treats a malformed opaque cursor as expired without querying PostgreSQL", async () => {
    const reader = new PgMemberEventReader();

    await expect(reader.resolveCursor("shop", "web/core/invoice", "evt_bad")).resolves.toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it("maps retained rows to SDK events and bounds replay to the requested task and seven days", async () => {
    query.mockResolvedValue({ rows: [{
      id: "00000000-0000-4000-8000-000000000001",
      project_id: "shop",
      sequence: "10",
      unit_id: "web/core/invoice",
      kind: "gate.effective",
      metadata: { gateId: "G4" },
      created_at: new Date("2026-10-21T00:00:00.000Z"),
    }] });
    const reader = new PgMemberEventReader();

    await expect(reader.readAfter("shop", "web/core/invoice", "9", 5)).resolves.toEqual([{
      sequence: "10",
      event: {
        schemaVersion: "1",
        projectId: "shop",
        unitId: "web/core/invoice",
        id: "00000000-0000-4000-8000-000000000001",
        kind: "gate.effective",
        occurredAt: "2026-10-21T00:00:00.000Z",
        metadata: { gateId: "G4" },
      },
    }]);
    expect(query.mock.calls[0]?.[0]).toContain("created_at >= now() - interval '7 days'");
    expect(query.mock.calls[0]?.[1]).toEqual(["shop", "web/core/invoice", "9", 5]);
  });
});
