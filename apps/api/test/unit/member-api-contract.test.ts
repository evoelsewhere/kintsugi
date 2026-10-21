import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { reviewReportSchema, taskStatusSchema, type TaskIdentity, type TaskPullRequest } from "@kintsugi/harness-sdk";
import type { GatePublicationStatus } from "../../src/modules/governance/gate-publication/index.js";
import type { MemberPrincipal } from "../../src/modules/core/auth/index.js";
import type { ProjectAccessPort } from "../../src/modules/delivery/agent-context/domain/project-access.ports.js";
import type { TaskQueryService } from "../../src/modules/delivery/agent-context/application/task-query.service.js";
import type { SnapshotService } from "../../src/modules/delivery/agent-context/application/snapshot.service.js";
import type { DocumentQueryService } from "../../src/modules/delivery/agent-context/application/document-query.service.js";
import { AgentContextService } from "../../src/modules/delivery/agent-context/application/agent-context.service.js";
import { describe, expect, it, vi } from "vitest";

const principal: MemberPrincipal = {
  userId: "alice",
  tokenId: "token-1",
  projectIds: ["alpha", "beta", "hidden"],
  credentialKind: "coding-agent-read",
};

function service() {
  const projectAccess = {
    requireRead: vi.fn(async () => undefined),
    listReadableProjects: vi.fn(async () => [
      { projectId: "alpha", name: "Alpha" },
      { projectId: "beta", name: "Beta" },
    ]),
  } as unknown as ProjectAccessPort;
  const tasks = { list: vi.fn(), get: vi.fn() } as unknown as TaskQueryService;
  const snapshots = { brief: vi.fn() } as unknown as SnapshotService;
  const documents = { get: vi.fn(), search: vi.fn() } as unknown as DocumentQueryService;
  const reviews = {
    get: vi.fn(),
    listCurrentIds: vi.fn(async (_principal: MemberPrincipal, _identity: TaskIdentity): Promise<string[]> => []),
  };
  const pullRequests = {
    listForTask: vi.fn(async (_principal: MemberPrincipal, _identity: TaskIdentity): Promise<TaskPullRequest[]> => []),
  };
  const gatePublications = {
    listForTask: vi.fn(async (_principal: MemberPrincipal, _identity: TaskIdentity, _gates: readonly { unitId: string; gateId: string }[]): Promise<GatePublicationStatus[]> => []),
  };
  return {
    subject: new AgentContextService(projectAccess, tasks, snapshots, documents, reviews, pullRequests as never, gatePublications as never),
    projectAccess, tasks, reviews, pullRequests, gatePublications,
  };
}

describe("AgentContextService Coding Agent Workflow contract", () => {
  it("lists only current Project Access within token scope and uses a stable project cursor", async () => {
    const { subject, projectAccess } = service();

    const first = await subject.listProjects(principal, { limit: 1 });
    expect(first).toEqual({ schemaVersion: "1", items: [{ projectId: "alpha", name: "Alpha" }], limit: 1, nextCursor: Buffer.from("alpha").toString("base64url") });
    expect(projectAccess.listReadableProjects).toHaveBeenCalledWith("alice", principal.projectIds);

    const next = await subject.listProjects(principal, { limit: 1, cursor: first.nextCursor });
    expect(next.items.map((project) => project.projectId)).toEqual(["beta"]);
    expect(next.nextCursor).toBeUndefined();
  });

  it("rejects noncanonical project cursors", async () => {
    const { subject } = service();
    await expect(subject.listProjects(principal, { cursor: "YWxwaGE=" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("returns confirmed pull requests and current gate publication states", async () => {
    const { subject, tasks, reviews, pullRequests, gatePublications } = service();
    vi.mocked(reviews.listCurrentIds).mockResolvedValue(["rev_018f0000-0000-4000-8000-000000000001"]);
    const pullRequest = {
      repositoryId: "billing-api",
      pullRequestId: "pr_42",
      state: "merged" as const,
      headRevision: "a".repeat(40),
      updatedAt: "2026-10-21T09:00:00.000Z",
    };
    const effectiveGate: GatePublicationStatus = {
      unitId: "web/core/invoice",
      gateId: "G3",
      decision: "waived",
      state: "effective",
    };
    vi.mocked(pullRequests.listForTask).mockResolvedValue([pullRequest]);
    vi.mocked(gatePublications.listForTask).mockResolvedValue([
      effectiveGate,
      { unitId: "web/catalog/product", gateId: "G3", decision: "approved", state: "awaiting-merge" },
      { unitId: "web/core/invoice", gateId: "G4", decision: "approved", state: "awaiting-merge" },
      { unitId: "web/core/invoice", gateId: "G5", decision: "approved", state: "failed" },
    ]);

    vi.mocked(tasks.get).mockResolvedValue({
      projectId: "alpha",
      unitId: "web/core/invoice",
      workItem: { status: "pending" },
      predecessorGates: [
        { unitId: "web/core/invoice", gateId: "G3", status: "unknown" },
        { unitId: "web/catalog/product", gateId: "G3", status: "unknown" },
        { unitId: "web/core/invoice", gateId: "G4", status: "unknown" },
        { unitId: "web/core/invoice", gateId: "G5", status: "unknown" },
      ],
      readiness: { readyFor: ["implementation"], blockers: [], byActivity: {
        design: { ready: true, blockers: [] },
        implementation: { ready: true, blockers: [] },
        verification: { ready: false, blockers: [] },
      } },
    } as never);

    const status = await subject.taskStatus(principal, { projectId: "alpha", unitId: "web/core/invoice" });
    expect(taskStatusSchema.parse(status)).toEqual(status);
    expect(status.pullRequests).toEqual([pullRequest]);
    expect(status.currentReviewIds).toEqual(["rev_018f0000-0000-4000-8000-000000000001"]);
    expect(status.evidenceAvailability).toEqual({ pullRequests: "available", reviews: "available" });
    expect(status.gates).toEqual([
      { unitId: "web/core/invoice", gateId: "G3", status: "waived", publication: "effective" },
      { unitId: "web/catalog/product", gateId: "G3", status: "pending", publication: "awaiting-merge" },
      { unitId: "web/core/invoice", gateId: "G4", status: "pending", publication: "awaiting-merge" },
      { unitId: "web/core/invoice", gateId: "G5", status: "unknown", publication: "failed" },
    ]);
    expect(gatePublications.listForTask).toHaveBeenCalledWith(principal, { projectId: "alpha", unitId: "web/core/invoice" }, [
      { unitId: "web/core/invoice", gateId: "G3" },
      { unitId: "web/catalog/product", gateId: "G3" },
      { unitId: "web/core/invoice", gateId: "G4" },
      { unitId: "web/core/invoice", gateId: "G5" },
    ]);
    expect(status.nextAction).toContain("pull request");
  });

  it.each([
    { status: "done", action: "No further action" },
    { status: "skipped", action: "No further action" },
    { status: "awaiting-review", action: "Wait for review feedback" },
    { status: "rejected", action: "Review the rejection feedback" },
    { status: "blocked", action: "Resolve the task's blocked status" },
  ] as const)("recommends a status-aware action for $status tasks", async ({ status, action }) => {
    const { subject, tasks } = service();
    vi.mocked(tasks.get).mockResolvedValue({
      projectId: "alpha",
      unitId: "web/core/invoice",
      workItem: { status },
      predecessorGates: [],
      readiness: { readyFor: ["implementation"], blockers: [], byActivity: {
        design: { ready: true, blockers: [] },
        implementation: { ready: true, blockers: [] },
        verification: { ready: true, blockers: [] },
      } },
    } as never);

    const result = await subject.taskStatus(principal, { projectId: "alpha", unitId: "web/core/invoice" });
    expect(result.nextAction).not.toContain("Implement the task");
    expect(result.nextAction).toContain(action);
  });

  it.each([
    { ready: true, action: "The task is approved; implement it, then create a pull request." },
    { ready: false, action: "Resolve the implementation readiness blockers before implementation." },
  ] as const)("keeps approved task guidance explicit when implementation readiness is $ready", async ({ ready, action }) => {
    const { subject, tasks } = service();
    vi.mocked(tasks.get).mockResolvedValue({
      projectId: "alpha",
      unitId: "web/core/invoice",
      workItem: { status: "approved" },
      predecessorGates: [],
      readiness: { readyFor: ready ? ["implementation"] : [], blockers: [], byActivity: {
        design: { ready: true, blockers: [] },
        implementation: { ready, blockers: [] },
        verification: { ready: true, blockers: [] },
      } },
    } as never);

    const result = await subject.taskStatus(principal, { projectId: "alpha", unitId: "web/core/invoice" });
    expect(result.nextAction).toBe(action);
  });

  it("returns a validated review report through the authorized query port", async () => {
    const { subject, reviews } = service();
    const report = reviewReportSchema.parse({
      schemaVersion: "1", projectId: "alpha", unitId: "web/core/invoice", reviewId: "rev_018f0000-0000-4000-8000-000000000001",
      generation: 1, currentness: "current", verdict: "fail", reviewedHead: "a".repeat(40), reviewedBase: "b".repeat(40),
      mergeBase: "c".repeat(40), contextRevision: `sha256:${"c".repeat(64)}`, policyRevision: "policy-v1", agentVersion: "review-agent-v1", coverage: "complete",
      findings: [{ findingId: "finding-001", severity: "high", title: "Boundary is unchecked", rationale: "The input is multiplied first.",
        repairGuidance: "Check the bound before multiplication.", citation: { sourceId: "pull-request", path: "src/invoice.ts", startLine: 3 }, currentness: "current" }],
    });
    vi.mocked(reviews.get).mockResolvedValue(report);
    vi.mocked(reviews.listCurrentIds).mockResolvedValue([report.reviewId]);

    await expect(subject.getReview(principal, { projectId: "alpha", reviewId: report.reviewId })).resolves.toEqual(report);
    expect(reviews.get).toHaveBeenCalledWith(principal, { projectId: "alpha", reviewId: report.reviewId });
    await expect(subject.getReview({ ...principal, projectIds: ["beta"] }, { projectId: "alpha", reviewId: report.reviewId }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(reviews.get).toHaveBeenCalledTimes(1);
  });
});


it("continues project pagination across valid 100-character project IDs", async () => {
  const { subject, projectAccess } = service();
  const projectId = "a".repeat(100);
  vi.mocked(projectAccess.listReadableProjects).mockResolvedValue([{ projectId, name: "Long" }, { projectId: "beta", name: "Beta" }]);
  const scoped = { ...principal, projectIds: [projectId, "beta"] };
  const first = await subject.listProjects(scoped, { limit: 1 });
  const next = await subject.listProjects(scoped, { limit: 1, cursor: first.nextCursor });
  expect(next.items.map(({ projectId }) => projectId)).toEqual(["beta"]);
});
