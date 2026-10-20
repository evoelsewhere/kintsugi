import { createHash } from "node:crypto";
import { ConflictException, ForbiddenException, NotFoundException, PayloadTooLargeException } from "@nestjs/common";
import { evaluateReadiness, type WorkItemFile } from "@kintsugi/domain";
import { DocumentQueryService } from "../../src/modules/delivery/agent-context/application/document-query.service.js";
import { SnapshotService } from "../../src/modules/delivery/agent-context/application/snapshot.service.js";
import { SnapshotRepository, type SnapshotRecord, type SnapshotSource } from "../../src/modules/delivery/agent-context/domain/snapshot.js";
import type { TaskQueryService } from "../../src/modules/delivery/agent-context/application/task-query.service.js";
import type { MemberTaskRecord } from "../../src/modules/delivery/agent-context/domain/task.js";
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

function service(
  get: () => Promise<SnapshotRecord | undefined>,
  isAvailable: (snapshotId: string) => Promise<boolean> = async () => true,
): SnapshotService {
  const repository = { get, isAvailable } as unknown as SnapshotRepository;
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
    const pending = instance.waitUntilReady(snapshotId).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(30_100);

    expect(await pending).toMatchObject({
      response: { details: { code: "SNAPSHOT_PREPARING", snapshotId, retryAfterMs: 1000 } },
    });
  });

  it("returns a stable unavailable code for a failed retained object", async () => {
    const instance = service(async () => snapshot("failed"));
    await expect(instance.brief(principal, {
      projectId: "shop",
      unitId: "web/core/invoice",
      activity: "design",
      snapshotId,
    })).rejects.toMatchObject({
      response: { details: { code: "SNAPSHOT_UNAVAILABLE", snapshotId } },
    });
  });

  it("rejects an expired snapshot handle", async () => {
    const instance = service(async () => snapshot("expired"), async () => false);
    await expect(instance.requireSnapshot(snapshotId).then((record) => instance.assertAvailable(record))).rejects.toMatchObject({
      response: { details: { code: "SNAPSHOT_EXPIRED", snapshotId } },
    });
  });

  it("uses persisted Postgres availability when the API clock is ahead", async () => {
    const instance = service(async () => snapshot("ready", "2026-10-21T00:00:00.000Z"), async () => true);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-22T00:00:00.000Z"));
    try {
      await expect(instance.assertAvailable(snapshot("ready", "2026-10-21T00:00:00.000Z"))).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a snapshot Postgres says is expired when the API clock is behind", async () => {
    const instance = service(async () => snapshot("ready", "2026-10-21T00:00:00.000Z"), async () => false);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T00:00:00.000Z"));
    try {
      await expect(instance.assertAvailable(snapshot("ready", "2026-10-21T00:00:00.000Z"))).rejects.toThrow("SNAPSHOT_EXPIRED");
    } finally {
      vi.useRealTimers();
    }
  });
});

function briefFixture(currentError?: Error, resolveError?: Error, createStatus: SnapshotRecord["status"] = "preparing", contextError?: Error) {
  const workItem: WorkItemFile = {
    id: "web/core/invoice", application: "web", module: "core", kind: "module",
    title: "Historical invoice task", phase: "migrate", status: "pending",
    requiredDeliverables: [
      { id: "code", repositoryId: "invoice-api", path: "src/invoice.ts" },
      { id: "design", repositoryId: "docs", path: "applications/web/units/core/invoice/design.md" },
    ],
  };
  const readiness = evaluateReadiness({ workItem, requiredInputs: [], predecessorGates: [] });
  const content = "# Invoice unit\n";
  const sourceHash = createHash("sha256").update(content).digest("hex");
  const task: MemberTaskRecord = {
    projectId: "shop", unitId: workItem.id, repositoryId: "docs", sourceCommit: "a".repeat(40),
    sourcePath: "applications/web/units/core/invoice/unit.md", sourceHash, workItem,
    requiredInputs: [], sourceReferences: [], predecessorGates: [], assignmentState: "unassigned", readiness,
  };
  const record = { ...snapshot("ready"), workItem, readiness };
  const records = new Map([[snapshotId, record]]);
  const repository = {
    get: async (id: string) => records.get(id),
    isAvailable: async () => true,
    create: async (input: { manifest: SnapshotRecord["manifest"] }) => {
      records.set(input.manifest.snapshotId, { ...record, manifest: input.manifest, status: createStatus });
    },
  } as unknown as SnapshotRepository;
  const documents = {
    context: async () => { if (contextError !== undefined) throw contextError; return { repo: { repositoryId: "docs" } }; },
    resolve: async (_context: unknown, commit: string) => { if (resolveError !== undefined) throw resolveError; return { commit }; },
    readText: async () => content,
  } as unknown as DocumentsService;
  const instance = new SnapshotService(
    { get: async () => { if (currentError !== undefined) throw currentError; return task; } } as unknown as TaskQueryService,
    {} as TaskApprovalEvidenceReader,
    { requireRead: async () => undefined } as unknown as ProjectAccessPort,
    documents,
    repository,
  );
  return { instance, records };
}

const briefQuery = { projectId: "shop", unitId: "web/core/invoice", activity: "design" as const };

describe("resumable and historical briefs", () => {
  it("returns the first preparation handle so a timed-out brief resumes the same snapshot", async () => {
    vi.useFakeTimers();
    const { instance, records } = briefFixture();
    const pending = instance.brief(principal, briefQuery).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_100);
    const error = await pending;
    const prepared = [...records.values()].find((record) => record.status === "preparing");
    expect(prepared).toBeDefined();
    expect(error).toMatchObject({
      response: { details: { code: "SNAPSHOT_PREPARING", snapshotId: prepared!.manifest.snapshotId, retryAfterMs: 1000 } },
    });
    prepared!.status = "ready";
    const resumed = await instance.brief(principal, { ...briefQuery, snapshotId: prepared!.manifest.snapshotId });
    expect(resumed.snapshotId).toBe(prepared!.manifest.snapshotId);
    expect(records.size).toBe(2);
  });

  it("serves a ready historical brief when refreshing the newer HEAD exceeds its context limit", async () => {
    const { instance } = briefFixture(new PayloadTooLargeException("The newer context exceeds the source byte limit"));
    const brief = await instance.brief(principal, { ...briefQuery, snapshotId });
    expect(brief.snapshotId).toBe(snapshotId);
    expect(brief.documentRepoCommit).toBe("a".repeat(40));
    expect(brief.title).toBe("Historical invoice task");
    expect(brief.freshness).toMatchObject({ isCurrent: false });
    expect(brief.freshness.newerContextRevision).toBeUndefined();
  });

  it("keeps current access denial effective during a historical brief freshness check", async () => {
    const { instance } = briefFixture(new ForbiddenException("Project Access was revoked"));
    await expect(instance.brief(principal, { ...briefQuery, snapshotId })).rejects.toThrow("Project Access was revoked");
  });
});

describe("historical source availability errors", () => {
  it.each([false, true])("returns a stable unavailable code when source readable is %s", async (readable) => {
    const { instance, records } = briefFixture();
    const source: SnapshotSource = {
      sourceId: "src_task", role: "task", repositoryId: "docs", path: "unit.md", commit: "a".repeat(40),
      contentHash: "sha256:" + "b".repeat(64), availability: "present", publication: "published",
      approval: "not-required", requiredFor: ["design"], required: true, readable, sections: [],
    };
    await expect(instance.readSource(records.get(snapshotId)!, source)).rejects.toMatchObject({
      response: { details: { code: "SNAPSHOT_UNAVAILABLE", snapshotId } },
    });
  });
});

it("returns a stable unavailable error for a missing retained commit without reading HEAD", async () => {
  const { instance, records } = briefFixture(undefined, new NotFoundException("Commit is missing"));
  const source: SnapshotSource = {
    sourceId: "src_task", role: "task", repositoryId: "docs", path: "unit.md", commit: "a".repeat(40),
    contentHash: "sha256:" + "b".repeat(64), availability: "present", publication: "published",
    approval: "not-required", requiredFor: ["design"], required: true, readable: true, sections: [],
  };
  await expect(instance.readSource(records.get(snapshotId)!, source)).rejects.toMatchObject({
    response: { details: { code: "SNAPSHOT_UNAVAILABLE", snapshotId } },
  });
});

it("keeps declared code and design deliverable IDs in the prepared manifest and brief", async () => {
  const { instance, records } = briefFixture(undefined, undefined, "ready");
  const brief = await instance.brief(principal, briefQuery);
  expect(brief.requiredDeliverableIds).toEqual(["code", "design"]);
  expect(records.get(brief.snapshotId)!.manifest.requiredDeliverableIds).toEqual(["code", "design"]);
});

describe("historical source context availability", () => {
  const source: SnapshotSource = {
    sourceId: "src_task", role: "task", repositoryId: "docs", path: "unit.md", commit: "a".repeat(40),
    contentHash: "sha256:" + createHash("sha256").update("# Invoice unit\n").digest("hex"),
    availability: "present", publication: "published", approval: "not-required",
    requiredFor: ["design"], required: true, readable: true, sections: [],
  };

  it.each([
    ["removed repository link", "Project shop has no document repository"],
    ["missing mirror", "The document repo docs is not mirrored yet"],
  ])("returns structured unavailability for brief, document and search after %s", async (_label, message) => {
    const { instance, records } = briefFixture(undefined, undefined, "ready", new ConflictException(message));
    const record = records.get(snapshotId)!;
    record.manifest.sources = [source];
    const documents = new DocumentQueryService({} as SnapshotRepository, instance);
    const identity = { projectId: "shop", unitId: "web/core/invoice", snapshotId };
    for (const read of [
      () => instance.brief(principal, { ...identity, activity: "design" }),
      () => documents.get(principal, { ...identity, sourceId: source.sourceId }),
      () => documents.search(principal, { ...identity, query: "Invoice" }),
    ]) {
      await expect(read()).rejects.toMatchObject({
        response: { details: { code: "SNAPSHOT_UNAVAILABLE", snapshotId } },
      });
    }
  });

  it.each([
    new ForbiddenException("Project Access was revoked"),
    new Error("Unexpected context reader failure"),
  ])("preserves context failure $message", async (error) => {
    const { instance, records } = briefFixture(undefined, undefined, "ready", error);
    await expect(instance.readSource(records.get(snapshotId)!, source)).rejects.toBe(error);
  });
});
