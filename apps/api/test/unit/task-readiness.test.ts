import { ConflictException, ForbiddenException } from "@nestjs/common";
import type { MemberPrincipal } from "../../src/modules/core/auth/index.js";
import { TaskQueryService } from "../../src/modules/delivery/agent-context/application/task-query.service.js";
import type {
  IndexedMemberTask,
  MemberTaskProjection,
  ProjectTaskSnapshot,
  TaskApprovalEvidenceReader,
  TaskProjectionRepository,
  TaskSourceReader,
} from "../../src/modules/delivery/agent-context/domain/task.js";
import type { ProjectAccessPort } from "../../src/modules/delivery/agent-context/domain/project-access.ports.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const COMMIT = "a".repeat(40);
const principal: MemberPrincipal = {
  userId: "user-alice",
  tokenId: "token-1",
  projectIds: ["project-a"],
  credentialKind: "coding-agent-read",
};

function projection(unitId = "billing/invoices/tax", assignedUserId: string | null = "user-alice"): IndexedMemberTask {
  const workItem = {
    id: unitId,
    application: "billing",
    module: "invoices",
    kind: "calculation",
    title: "Invoice tax",
    phase: "migrate" as const,
    status: "pending" as const,
    ...(assignedUserId === null ? {} : { assignee: assignedUserId === "user-alice" ? "alice" : "bob" }),
    gates: { G3: { status: "approved" as const } },
  };
  const requiredInputs = [
    {
      sourceId: "src:task-pack",
      role: "task-pack",
      path: "applications/billing/units/invoices/tax/task.md",
      requiredFor: ["design", "implementation", "verification"] as const,
      availability: "present" as const,
      publication: "published" as const,
      approval: "not-required" as const,
    },
    {
      sourceId: "src:as-is",
      role: "as-is-specification",
      path: "applications/billing/units/invoices/tax/as-is.md",
      requiredFor: ["design", "implementation"] as const,
      availability: "present" as const,
      publication: "published" as const,
      approval: "not-required" as const,
    },
    {
      sourceId: "src:basic",
      role: "basic-design",
      path: "applications/billing/to-be/design.md",
      requiredFor: ["implementation", "verification"] as const,
      availability: "missing" as const,
      publication: "unknown" as const,
      approval: "unknown" as const,
    },
    {
      sourceId: "src:detailed",
      role: "detailed-design",
      path: "applications/billing/units/invoices/tax/design.md",
      requiredFor: ["implementation", "verification"] as const,
      producedBy: "design" as const,
      availability: "missing" as const,
      publication: "unknown" as const,
      approval: "unknown" as const,
    },
  ];
  const value: MemberTaskProjection = {
    projectId: "project-a",
    unitId,
    repositoryId: "docs",
    sourceCommit: COMMIT,
    sourcePath: "applications/billing/units/invoices/tax/unit.md",
    sourceHash: "b".repeat(64),
    workItem,
    requiredInputs,
    sourceReferences: requiredInputs.map((input) => ({
      ...input,
      repositoryId: "docs",
      path: input.sourceId.slice(input.sourceId.indexOf(":") + 1),
    })),
    predecessorGates: [{ gateId: "G3", unitId, status: "unknown", requiredFor: ["implementation", "verification"] }],
  };
  return {
    ...value,
    ...(assignedUserId === null ? {} : { assignedUserId }),
    assignmentState: assignedUserId === null ? "unassigned" : "resolved",
  };
}

function setup(records: IndexedMemberTask[] = [projection()]) {
  let indexCommit: string | undefined;
  let indexed = records;
  const snapshot: ProjectTaskSnapshot = {
    projectId: "project-a",
    repositoryId: "docs",
    commit: COMMIT,
    tasks: records,
    issues: [],
  };
  const source = {
    currentRevision: vi.fn(async () => ({ repositoryId: "docs", commit: COMMIT })),
    readProject: vi.fn(async () => snapshot),
  };
  const repository = {
    indexRevision: vi.fn(async () => indexCommit === undefined ? undefined : ({ repositoryId: "docs", commit: indexCommit })),
    replaceProject: vi.fn(async (next: ProjectTaskSnapshot) => {
      indexCommit = next.commit;
      indexed = next.tasks.map((task) => ({
        ...task,
        ...(task.workItem.assignee === "alice" ? { assignedUserId: "user-alice" } : {}),
        ...(task.workItem.assignee === "bob" ? { assignedUserId: "user-bob" } : {}),
        assignmentState: task.workItem.assignee === undefined
          ? "unassigned" as const
          : task.workItem.assignee === "alice" || task.workItem.assignee === "bob" ? "resolved" as const : "unresolved" as const,
      }));
    }),
    list: vi.fn(async (_projectId: string, afterUnitId?: string) => indexed.filter((task) => afterUnitId === undefined || task.unitId > afterUnitId)),
    get: vi.fn(async (_projectId: string, unitId: string) => indexed.find((task) => task.unitId === unitId)),
  };
  const projectAccess = { requireRead: vi.fn(async () => undefined) };
  const approvals = {
    sourceApproval: vi.fn(async () => "unknown" as const),
    predecessorStatus: vi.fn(async () => "unknown" as const),
  };
  const service = new TaskQueryService(
    source as unknown as TaskSourceReader,
    repository as unknown as TaskProjectionRepository,
    projectAccess as unknown as ProjectAccessPort,
    approvals as unknown as TaskApprovalEvidenceReader,
  );
  return { service, source, repository, projectAccess, approvals };
}

describe("TaskQueryService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("matches --mine by stable user ID and leaves reads unclaimed", async () => {
    const { service, repository, projectAccess } = setup([projection(), projection("billing/invoices/base", "user-bob"), projection("billing/invoices/empty", null)]);
    const result = await service.list(principal, { projectId: "project-a", mine: true, limit: 10 });
    expect(result.items.map((task) => task.unitId)).toEqual(["billing/invoices/tax"]);
    expect(repository.replaceProject).toHaveBeenCalledTimes(1);
    expect(projectAccess.requireRead).toHaveBeenCalledWith("user-alice", "project-a");
  });

  it("allows drafting a missing detailed design while blocking implementation on missing approval", async () => {
    const { service } = setup();
    const draft = await service.list(principal, { projectId: "project-a", readyFor: "design", limit: 10 });
    expect(draft.items.map((task) => task.unitId)).toEqual(["billing/invoices/tax"]);

    const record = await service.get(principal, { projectId: "project-a", unitId: "billing/invoices/tax" });
    expect(record.readiness.byActivity.implementation.ready).toBe(false);
    expect(record.readiness.blockers.some((blocker) => blocker.code === "SOURCE_MISSING" && blocker.sourceId === "src:basic")).toBe(true);
    expect(record.readiness.blockers.some((blocker) => blocker.code === "GATE_UNKNOWN" && blocker.gateId === "G3")).toBe(true);
    expect(record.readiness.blockers.some((blocker) => blocker.code === "GATE_PENDING")).toBe(false);
  });

  it("rejects a project outside the token scope before reading Git or the index", async () => {
    const { service, source, repository, projectAccess } = setup();
    await expect(service.list(principal, { projectId: "project-b" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(source.currentRevision).not.toHaveBeenCalled();
    expect(repository.indexRevision).not.toHaveBeenCalled();
    expect(projectAccess.requireRead).not.toHaveBeenCalled();
  });

  it("fails closed when an approval source has no indexed repository path", async () => {
    const record = projection();
    const incomplete = {
      ...record,
      sourceReferences: record.sourceReferences.filter((source) => source.role !== "detailed-design"),
    };
    const { service } = setup([incomplete]);
    await expect(service.get(principal, { projectId: "project-a", unitId: "billing/invoices/tax" }))
      .rejects.toBeInstanceOf(ConflictException);
  });
});
