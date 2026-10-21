// Composes authorized feature use cases into the shared Coding Agent Workflow contract.

import { BadRequestException, ForbiddenException, Injectable, PayloadTooLargeException } from "@nestjs/common";
import {
  DEFAULT_LIST_LIMIT,
  documentPageSchema,
  documentSearchResultSchema,
  projectListResultSchema,
  reviewReportSchema,
  taskBriefSchema,
  taskListResultSchema,
  taskStatusSchema,
  type CodingAgentWorkflowPort,
  type DocumentQuery,
  type DocumentSearchQuery,
  type ListResult,
  type ProjectQuery,
  type ProjectSummary,
  type ReviewQuery,
  type TaskBriefQuery,
  type TaskIdentity,
  type TaskQuery,
  type TaskStatus,
  type TaskSummary,
} from "@kintsugi/harness-sdk";
import { PROJECT_ID_PATTERN, type WorkItemStatus } from "@kintsugi/domain";
import type { MemberPrincipal } from "#modules/core/auth/index.js";
import { DocumentQueryService } from "./document-query.service.js";
import { SnapshotService } from "./snapshot.service.js";
import { TaskQueryService } from "./task-query.service.js";
import { ProjectAccessPort } from "../domain/project-access.ports.js";
import { ReviewReader } from "../domain/review-reader.port.js";

const MAX_PROJECTS_PER_TOKEN = 100;
const MAX_STATUS_GATES = 20;
type AuthenticatedOperation<Operation> = Operation extends (...args: infer Arguments) => infer Result
  ? (principal: MemberPrincipal, ...args: Arguments) => Result
  : never;
type AuthenticatedCodingAgentWorkflowPort = {
  [Key in Exclude<keyof CodingAgentWorkflowPort, "watchTask">]: AuthenticatedOperation<CodingAgentWorkflowPort[Key]>;
};

@Injectable()
export class AgentContextService implements AuthenticatedCodingAgentWorkflowPort {
  constructor(
    private readonly projectAccess: ProjectAccessPort,
    private readonly tasks: TaskQueryService,
    private readonly snapshots: SnapshotService,
    private readonly documents: DocumentQueryService,
    private readonly reviews: ReviewReader,
  ) {}

  async listProjects(principal: MemberPrincipal, query: ProjectQuery): Promise<ListResult<ProjectSummary>> {
    if (principal.projectIds.length === 0 || principal.projectIds.length > MAX_PROJECTS_PER_TOKEN) {
      throw new ForbiddenException("The token has no valid project scope");
    }
    const limit = this.validateLimit(query.limit);
    const afterProjectId = this.decodeProjectCursor(query.cursor);
    const allowed = new Set(principal.projectIds);
    const readable = await this.projectAccess.listReadableProjects(principal.userId, principal.projectIds);
    const ordered = [...new Map(
      readable
        .filter((project) => allowed.has(project.projectId))
        .map((project) => [project.projectId, { projectId: project.projectId, name: project.name }]),
    ).values()].sort((left, right) => compareProjectId(left.projectId, right.projectId));
    const candidates = ordered.filter((project) => afterProjectId === undefined || compareProjectId(project.projectId, afterProjectId) > 0);
    const items = candidates.slice(0, limit);
    const last = items.at(-1);
    return projectListResultSchema.parse({
      schemaVersion: "1",
      items,
      limit,
      ...(candidates.length > limit && last !== undefined ? { nextCursor: this.encodeProjectCursor(last.projectId) } : {}),
    });
  }

  async listTasks(principal: MemberPrincipal, query: TaskQuery): Promise<ListResult<TaskSummary>> {
    await this.authorize(principal, query.projectId);
    return taskListResultSchema.parse(await this.tasks.list(principal, query));
  }

  async briefTask(principal: MemberPrincipal, query: TaskBriefQuery) {
    await this.authorize(principal, query.projectId);
    return taskBriefSchema.parse(await this.snapshots.brief(principal, query));
  }

  async getDocument(principal: MemberPrincipal, query: DocumentQuery) {
    await this.authorize(principal, query.projectId);
    return documentPageSchema.parse(await this.documents.get(principal, query));
  }

  async searchDocuments(principal: MemberPrincipal, query: DocumentSearchQuery) {
    await this.authorize(principal, query.projectId);
    return documentSearchResultSchema.parse(await this.documents.search(principal, query));
  }

  async getReview(principal: MemberPrincipal, query: ReviewQuery) {
    await this.authorize(principal, query.projectId);
    return reviewReportSchema.parse(await this.reviews.get(principal, query));
  }

  async taskStatus(principal: MemberPrincipal, identity: TaskIdentity): Promise<TaskStatus> {
    await this.authorize(principal, identity.projectId);
    const task = await this.tasks.get(principal, identity);
    const currentReviewIds = await this.reviews.listCurrentIds(principal, identity);
    if (task.predecessorGates.length > MAX_STATUS_GATES) {
      throw new PayloadTooLargeException("The task has too many gates for the Coding Agent Workflow status response");
    }
    const result: TaskStatus = {
      schemaVersion: "1",
      projectId: task.projectId,
      unitId: task.unitId,
      status: task.workItem.status,
      evidenceAvailability: { pullRequests: "unavailable", reviews: "available" },
      pullRequests: [],
      currentReviewIds,
      gates: task.predecessorGates.map((gate) => ({
        gateId: gate.gateId,
        status: gate.status,
        publication: "unknown",
      })),
      nextAction: nextAction(task.workItem.status, task.readiness.byActivity.implementation.ready),
    };
    return taskStatusSchema.parse(result);
  }

  private async authorize(principal: MemberPrincipal, projectId: string): Promise<void> {
    if (!principal.projectIds.includes(projectId)) {
      throw new ForbiddenException("The token is not scoped to this project");
    }
    await this.projectAccess.requireRead(principal.userId, projectId);
  }

  private validateLimit(value: number | undefined): number {
    const limit = value ?? DEFAULT_LIST_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException("limit must be between 1 and 100");
    }
    return limit;
  }

  private decodeProjectCursor(cursor: string | undefined): string | undefined {
    if (cursor === undefined) return undefined;
    try {
      const decoded = Buffer.from(cursor, "base64url").toString("utf8");
      if (
        decoded.length === 0 ||
        Buffer.from(decoded, "utf8").toString("base64url") !== cursor ||
        !PROJECT_ID_PATTERN.test(decoded)
      ) throw new Error("invalid");
      return decoded;
    } catch {
      throw new BadRequestException("cursor is invalid");
    }
  }

  private encodeProjectCursor(projectId: string): string {
    return Buffer.from(projectId, "utf8").toString("base64url");
  }
}

function nextAction(status: WorkItemStatus, implementationReady: boolean): string {
  switch (status) {
    case "done":
    case "skipped":
      return "No further action is needed for this task.";
    case "awaiting-review":
      return "Wait for review feedback or address any requested changes.";
    case "rejected":
      return "Review the rejection feedback before continuing with the task.";
    case "blocked":
      return "Resolve the task's blocked status before implementation.";
    case "approved":
      return implementationReady
        ? "The task is approved; implement it, then create a pull request."
        : "Resolve the implementation readiness blockers before implementation.";
    default:
      return implementationReady
        ? "Implement the task, then create a pull request."
        : "Resolve the implementation readiness blockers before implementation.";
  }
}

function compareProjectId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
