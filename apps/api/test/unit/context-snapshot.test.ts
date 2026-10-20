import { SnapshotService } from "../../src/modules/delivery/agent-context/application/snapshot.service.js";
import { SnapshotRepository, type SnapshotRecord } from "../../src/modules/delivery/agent-context/domain/snapshot.js";
import type { TaskQueryService } from "../../src/modules/delivery/agent-context/application/task-query.service.js";
import type { TaskApprovalEvidenceReader } from "../../src/modules/delivery/agent-context/domain/task.js";
import type { ProjectAccessPort } from "../../src/modules/delivery/agent-context/domain/project-access.ports.js";
import type { DocumentsService } from "../../src/modules/delivery/documents/index.js";
import type { MemberPrincipal } from "../../src/modules/core/auth/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const snapshotId = "ctx_00000000-0000-4000-8000-000000000001";
const principal: MemberPrincipal = {
  userId: "member-1",
  tokenId: "token-1",
  projectIds: ["shop"],
  credentialKind: "coding-agent-read",
};

function snapshot(status: SnapshotRecord["status"], expiresAt = new Date(Date.now() + 60_000).toISOString()): SnapshotRecord {
  return {
    manifest: {
      snapshotId,
      projectId: "shop",
      unitId: "web/core/invoice",
      activity: "design",
      repositories: [],
      task: { sourceId: "src_task", repositoryId: "docs", path: "unit.md", commit: "a".repeat(40), contentHash: "sha256:" + "b".repeat(64) },
      sources: [],
      requiredDeliverableIds: [],
      policyRevision: "member-context-v1",
      contextRevision: "sha256:" + "c".repeat(64),
    },
    workItem: {} as SnapshotRecord["workItem"],
    readiness: {} as SnapshotRecord["readiness"],
    requestedByUserId: "member-1",
    status,
    createdAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt,
    ...(status === "failed" ? { errorCode: "SNAPSHOT_PIN_FAILED" } : {}),
  };
}

function service(get: () => Promise<SnapshotRecord | undefined>): SnapshotService {
  const repository = { get } as unknown as SnapshotRepository;
  return new SnapshotService(
    {} as TaskQueryService,
    {} as TaskApprovalEvidenceReader,
    { requireRead: async () => undefined } as unknown as ProjectAccessPort,
    {} as DocumentsService,
    repository,
  );
}

afterEach(() => vi.useRealTimers());

describe("snapshot lifecycle errors", () => {
  it("returns the preparing code after the bounded 30-second wait", async () => {
    vi.useFakeTimers();
    const instance = service(async () => snapshot("preparing"));
    const pending = expect(instance.waitUntilReady(snapshotId)).rejects.toThrow("SNAPSHOT_PREPARING");

    await vi.advanceTimersByTimeAsync(30_100);

    await pending;
  });

  it("returns a stable unavailable code for a failed retained object", async () => {
    const instance = service(async () => snapshot("failed"));
    await expect(instance.brief(principal, {
      projectId: "shop",
      unitId: "web/core/invoice",
      activity: "design",
      snapshotId,
    })).rejects.toThrow("SNAPSHOT_PIN_FAILED");
  });

  it("rejects an expired snapshot handle", async () => {
    const instance = service(async () => snapshot("expired", new Date(Date.now() - 1000).toISOString()));
    await expect(instance.requireSnapshot(snapshotId).then((record) => instance.assertAvailable(record))).rejects.toThrow("SNAPSHOT_EXPIRED");
  });
});
