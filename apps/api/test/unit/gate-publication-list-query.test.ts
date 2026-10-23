import { describe, expect, it } from "vitest";
import { gatePublicationListQuerySchema } from "../../src/modules/governance/gate-publication/interface/gate-publication.dto.js";

describe("gate publication list query", () => {
  it("uses a small default page and requires an explicit project", () => {
    expect(gatePublicationListQuerySchema.parse({ projectId: "shop" })).toEqual({ projectId: "shop", limit: 10, offset: 0 });
    expect(gatePublicationListQuerySchema.safeParse({ limit: 10 }).success).toBe(false);
  });

  it("rejects oversized pages, invalid offsets and unexpected scope fields", () => {
    expect(gatePublicationListQuerySchema.safeParse({ projectId: "shop", limit: 51 }).success).toBe(false);
    expect(gatePublicationListQuerySchema.safeParse({ projectId: "shop", offset: -1 }).success).toBe(false);
    expect(gatePublicationListQuerySchema.safeParse({ projectId: "shop", userId: "other" }).success).toBe(false);
  });
});
