import { DocumentQueryService } from "../../src/modules/delivery/agent-context/application/document-query.service.js";
import type { SnapshotRepository, SnapshotSectionIndex, SnapshotSource } from "../../src/modules/delivery/agent-context/domain/snapshot.js";
import type { SnapshotService } from "../../src/modules/delivery/agent-context/application/snapshot.service.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const snapshotId = "ctx_00000000-0000-4000-8000-000000000101";
const sourceId = "src_dense";
const query = {
  projectId: "shop",
  unitId: "web/core/invoice",
  snapshotId,
  query: "needle",
  limit: 25,
};

describe("bounded snapshot search", () => {
  afterEach(() => vi.restoreAllMocks());

  it("splits one source once, returns a bounded page, and preserves search continuation", async () => {
    const sections: SnapshotSectionIndex[] = Array.from({ length: 400 }, (_, index) => ({
      sectionId: "sec_" + index,
      title: "Requirement " + index,
      startLine: index * 2 + 1,
      endLine: index * 2 + 2,
      byteLength: 30,
      required: true,
    }));
    const source: SnapshotSource = {
      sourceId,
      role: "detailed-design",
      repositoryId: "docs",
      path: "applications/web/units/core/invoice/design.md",
      commit: "a".repeat(40),
      contentHash: "sha256:" + "b".repeat(64),
      availability: "present",
      publication: "published",
      approval: "approved",
      requiredFor: ["implementation"],
      required: true,
      readable: true,
      sections,
    };
    const markdown = sections.map((section) => "## " + section.title + "\nneedle is present in this source section").join("\n");
    const snapshotService = {
      authorize: vi.fn(async () => undefined),
      requireSnapshot: vi.fn(async () => ({
        manifest: {
          snapshotId,
          projectId: query.projectId,
          unitId: query.unitId,
          activity: "implementation",
          sources: [source],
        },
        status: "ready",
        expiresAt: "2026-10-21T00:00:00.000Z",
      })),
      assertIdentity: vi.fn(),
      assertAvailable: vi.fn(),
      readSource: vi.fn(async () => markdown),
    } as unknown as SnapshotService;
    const snapshots = {
      getCursor: vi.fn(async () => undefined),
      createCursor: vi.fn(async () => "00000000-0000-4000-8000-000000000102"),
    } as unknown as SnapshotRepository;
    const service = new DocumentQueryService(snapshots, snapshotService);

    const originalSplit = String.prototype.split;
    let sourceSplitCount = 0;
    const trackedSplit = function (this: string, separator?: string | RegExp, limit?: number): string[] {
      if (this === markdown && separator instanceof RegExp) sourceSplitCount += 1;
      return Reflect.apply(originalSplit, this, [separator, limit]) as string[];
    };
    vi.spyOn(String.prototype, "split").mockImplementation(trackedSplit as never);
    const result = await service.search({
      userId: "user-1",
      tokenId: "token-1",
      projectIds: [query.projectId],
      credentialKind: "coding-agent-read",
    }, query);

    expect(result.items).toHaveLength(25);
    expect(result.nextCursor).toBe("00000000-0000-4000-8000-000000000102");
    expect(sourceSplitCount).toBe(1);
  });
});
