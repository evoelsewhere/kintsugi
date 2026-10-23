import { describe, expect, it, vi } from "vitest";
import type { AuditRecord } from "../../src/common/audit/audit-trail.js";
import { AuditService } from "../../src/modules/governance/audit/application/audit.service.js";
import type { AuditLog } from "../../src/modules/governance/audit/domain/audit-log.port.js";

describe("AuditService.recordWithIds", () => {
  it("returns persisted append-only audit event IDs in input order", async () => {
    const appendWithIds = vi.fn(async (_entries: readonly AuditRecord[]) => ["1842", "1843"]);
    const log = {
      append: vi.fn(async () => undefined),
      appendWithIds,
      list: vi.fn(),
      get: vi.fn(),
    } as unknown as AuditLog;
    const audit = new AuditService(log);

    await expect(audit.recordWithIds([
      { actor: "user-1", action: "gate.decision.request", subject: "decision-1" },
      { actor: "user-1", action: "gate.decision.request", subject: "decision-2" },
    ])).resolves.toEqual(["1842", "1843"]);
    expect(appendWithIds).toHaveBeenCalledTimes(1);
  });

  it("uses a caller transaction when gate audit and publication must commit together", async () => {
    const appendWithIds = vi.fn(async (_entries: readonly AuditRecord[]) => ["1844"]);
    const log = { append: vi.fn(), appendWithIds, list: vi.fn(), get: vi.fn() } as unknown as AuditLog;
    const audit = new AuditService(log);
    const transaction = { query: vi.fn() };
    const append = (audit.recordWithIds as unknown as (entries: readonly AuditRecord[], tx: typeof transaction) => Promise<string[]>).bind(audit);

    await expect(append([{ actor: "user-1", action: "gate.decision.request" }], transaction)).resolves.toEqual(["1844"]);
    expect(appendWithIds).toHaveBeenCalledWith([{ actor: "user-1", action: "gate.decision.request" }], transaction);
  });
});
