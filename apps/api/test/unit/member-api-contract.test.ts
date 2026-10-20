import { BadRequestException, HttpException } from "@nestjs/common";
import { taskStatusSchema } from "@kintsugi/harness-sdk";
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
  const reviews = { get: vi.fn() };
  return { subject: new AgentContextService(projectAccess, tasks, snapshots, documents, reviews), projectAccess, tasks, reviews };
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

  it("returns task status in the shared client schema without claiming unobserved PR or review evidence", async () => {
    const { subject, tasks } = service();
    vi.mocked(tasks.get).mockResolvedValue({
      projectId: "alpha",
      unitId: "web/core/invoice",
      workItem: { status: "pending" },
      predecessorGates: [{ unitId: "web/core/invoice", gateId: "G3", status: "unknown" }],
      readiness: { readyFor: ["implementation"], blockers: [], byActivity: {
        design: { ready: true, blockers: [] },
        implementation: { ready: true, blockers: [] },
        verification: { ready: false, blockers: [] },
      } },
    } as never);

    const status = await subject.taskStatus(principal, { projectId: "alpha", unitId: "web/core/invoice" });
    expect(taskStatusSchema.parse(status)).toEqual(status);
    expect(status.pullRequests).toEqual([]);
    expect(status.currentReviewIds).toEqual([]);
    expect(status.evidenceAvailability).toEqual({ pullRequests: "unavailable", reviews: "unavailable" });
    expect(status.gates).toEqual([{ gateId: "G3", status: "unknown", publication: "unknown" }]);
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

  it("reports review capability as unsupported without returning a verdict", async () => {
    const { subject, reviews } = service();
    vi.mocked(reviews.get).mockRejectedValue(new HttpException({
      message: "Review evidence is not available yet",
      details: { code: "UNSUPPORTED_CAPABILITY", capability: "reviews" },
    }, 501));

    const error = await subject.getReview(principal, { projectId: "alpha", reviewId: "review-1" }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(501);
    expect((error as HttpException).getResponse()).toMatchObject({ details: { code: "UNSUPPORTED_CAPABILITY", capability: "reviews" } });
    expect(reviews.get).toHaveBeenCalledWith(principal, { projectId: "alpha", reviewId: "review-1" });
  });
});
