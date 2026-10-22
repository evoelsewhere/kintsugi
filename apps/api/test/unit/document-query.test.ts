import { DocumentQueryService } from "../../src/modules/delivery/agent-context/application/document-query.service.js";
import type { SnapshotRecord, SnapshotRepository, SnapshotSectionIndex, SnapshotSource } from "../../src/modules/delivery/agent-context/domain/snapshot.js";
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
      path: "10-applications/web/02-modern/core/invoice/detail/logic.md",
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

function queryService(content: string, status: SnapshotRecord["status"] = "ready"): DocumentQueryService {
  const source: SnapshotSource = {
    sourceId, role: "task-pack", repositoryId: "docs", path: "task.md", commit: "a".repeat(40),
    contentHash: "sha256:" + "b".repeat(64), availability: "present", publication: "published",
    approval: "not-required", requiredFor: ["design"], required: true, readable: true,
    sections: [{ sectionId: "sec_text", title: "Text", startLine: 1, endLine: 1, byteLength: Buffer.byteLength(content), required: true }],
  };
  const snapshotService = {
    authorize: async () => undefined,
    requireSnapshot: async () => ({ manifest: { snapshotId, projectId: query.projectId, unitId: query.unitId, activity: "design", sources: [source] }, status }),
    assertIdentity: () => undefined,
    assertAvailable: async () => undefined,
    readSource: async () => content,
  } as unknown as SnapshotService;
  return new DocumentQueryService({} as SnapshotRepository, snapshotService);
}

const principal = { userId: "user-1", tokenId: "token-1", projectIds: [query.projectId], credentialKind: "coding-agent-read" as const };

describe("snapshot query edge cases", () => {
  it.each(["ΟΣ", "ος", "Σ", "σ", "ς"])("finds context-sensitive Unicode text with query %s", async (needle) => {
    const result = await queryService("ΟΣ").search(principal, { ...query, query: needle });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.excerpt).toBe("ΟΣ");
  });

  it.each([
    ["astral characters", "\u{1f600}".repeat(200) + "needle", "\u{1f600}".repeat(80) + "needle"],
    ["lowercase expansions", "\u0130".repeat(200) + "needle", "\u0130".repeat(80) + "needle"],
  ])("keeps a matching search excerpt after %s", async (_name, content, expected) => {
    const result = await queryService(content).search(principal, query);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.excerpt).toBe(expected);
    expect(result.items[0]!.citation).toMatchObject({ sourceId, path: "task.md", startLine: 1, endLine: 1 });
  });

  it.each(["preparing", "failed"] as const)("returns a machine-readable %s error for document and search reads", async (status) => {
    const service = queryService("needle", status);
    const details = { code: status === "preparing" ? "SNAPSHOT_PREPARING" : "SNAPSHOT_UNAVAILABLE", snapshotId };
    await expect(service.get(principal, { projectId: query.projectId, unitId: query.unitId, snapshotId, sourceId })).rejects.toMatchObject({ response: { details } });
    await expect(service.search(principal, query)).rejects.toMatchObject({ response: { details } });
  });
});
