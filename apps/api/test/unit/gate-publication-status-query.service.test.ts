import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { GatePublicationStatusQueryService } from "../../src/modules/governance/gate-publication/application/gate-publication-status-query.service.js";
import type { MemberPrincipal } from "../../src/modules/core/auth/index.js";

const principal = { userId: "member-1", projectIds: ["shop"] } as unknown as MemberPrincipal;

describe("GatePublicationStatusQueryService", () => {
  it("allows the same gate ID on different predecessor units", async () => {
    const publications = { listLatestForTask: vi.fn(async () => []) };
    const projectAccess = { requireRead: vi.fn(async () => undefined) };
    const subject = new GatePublicationStatusQueryService(
      publications as never,
      projectAccess as never,
    );

    const gates = [
      { unitId: "web/core/invoice", gateId: "G3" },
      { unitId: "web/catalog/product", gateId: "G3" },
    ];
    await expect(subject.listForTask(principal, { projectId: "shop", unitId: "web/core/invoice" }, gates)).resolves.toEqual([]);
    expect(publications.listLatestForTask).toHaveBeenCalledWith("shop", gates);
  });

  it("rejects a duplicate unit and gate pair", async () => {
    const publications = { listLatestForTask: vi.fn(async () => []) };
    const projectAccess = { requireRead: vi.fn(async () => undefined) };
    const subject = new GatePublicationStatusQueryService(
      publications as never,
      projectAccess as never,
    );

    const gates = [
      { unitId: "web/core/invoice", gateId: "G3" },
      { unitId: "web/core/invoice", gateId: "G3" },
    ];
    await expect(subject.listForTask(principal, { projectId: "shop", unitId: "web/core/invoice" }, gates)).rejects.toBeInstanceOf(BadRequestException);
    expect(publications.listLatestForTask).not.toHaveBeenCalled();
  });

  it("rejects more than twenty task gate identities", async () => {
    const publications = { listLatestForTask: vi.fn(async () => []) };
    const projectAccess = { requireRead: vi.fn(async () => undefined) };
    const subject = new GatePublicationStatusQueryService(
      publications as never,
      projectAccess as never,
    );

    const gates = Array.from({ length: 21 }, (_, index) => ({ unitId: `web/core/unit-${index + 1}`, gateId: "G3" }));
    await expect(subject.listForTask(principal, { projectId: "shop", unitId: "web/core/invoice" }, gates)).rejects.toBeInstanceOf(BadRequestException);
    expect(publications.listLatestForTask).not.toHaveBeenCalled();
  });
});
