// Application use cases for authorized, read-only Coding Agent Workflow task queries.

import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import type { ListResult, TaskIdentity, TaskQuery, TaskSummary } from "@kintsugi/harness-sdk";
import { evaluateReadiness, isFullUnitId, type PredecessorGate, type ReadinessResult } from "@kintsugi/domain";
import type { MemberPrincipal } from "#modules/core/auth/index.js";
import { ProjectAccessPort } from "../domain/project-access.ports.js";
import {
  TaskApprovalEvidenceReader,
  TaskProjectionRepository,
  TaskSourceReader,
  sameTaskSourceRevision,
  type IndexedMemberTask,
  type MemberTaskRecord,
} from "../domain/task.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_FRESHNESS_ATTEMPTS = 3;

@Injectable()
export class TaskQueryService {
  constructor(
    private readonly source: TaskSourceReader,
    private readonly projections: TaskProjectionRepository,
    private readonly projectAccess: ProjectAccessPort,
    private readonly approvals: TaskApprovalEvidenceReader,
  ) {}

  async list(principal: MemberPrincipal, query: TaskQuery): Promise<ListResult<TaskSummary>> {
    await this.authorize(principal, query.projectId);
    const limit = this.validateLimit(query.limit);
    const afterUnitId = this.decodeCursor(query.cursor);
    await this.ensureFresh(query.projectId);

    const records = (await this.projections.list(query.projectId)).sort((left, right) =>
      left.unitId < right.unitId ? -1 : left.unitId > right.unitId ? 1 : 0);
    const items: TaskSummary[] = [];
    for (const record of records) {
      if (afterUnitId !== undefined && record.unitId <= afterUnitId) continue;
      if (query.mine === true && record.assignedUserId !== principal.userId) continue;
      const readiness = await this.readiness(record);
      if (query.readyFor !== undefined && !readiness.byActivity[query.readyFor].ready) continue;
      items.push({
        projectId: record.projectId,
        unitId: record.unitId,
        title: record.workItem.title,
        phase: record.workItem.phase,
        status: record.workItem.status,
        ...(record.workItem.assignee === undefined ? {} : { assignee: record.workItem.assignee }),
        readiness,
      });
    }

    const page = items.slice(0, limit);
    const hasMore = items.length > limit;
    const last = page[page.length - 1];
    return {
      schemaVersion: "1",
      items: page,
      limit,
      ...(hasMore && last !== undefined ? { nextCursor: this.encodeCursor(last.unitId) } : {}),
    };
  }

  async get(principal: MemberPrincipal, identity: TaskIdentity): Promise<MemberTaskRecord> {
    await this.authorize(principal, identity.projectId);
    if (!isFullUnitId(identity.unitId)) throw new BadRequestException("unitId must be application/module/unit");
    await this.ensureFresh(identity.projectId);
    const record = await this.projections.get(identity.projectId, identity.unitId);
    if (record === undefined) throw new ConflictException("The task is not present in the current document repository index");
    return { ...record, readiness: await this.readiness(record) };
  }

  private async authorize(principal: MemberPrincipal, projectId: string): Promise<void> {
    if (!principal.projectIds.includes(projectId)) throw new ForbiddenException("The token is not scoped to this project");
    await this.projectAccess.requireRead(principal.userId, projectId);
  }

  private validateLimit(value: number | undefined): number {
    const limit = value ?? DEFAULT_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new BadRequestException("limit must be between 1 and " + MAX_LIMIT);
    }
    return limit;
  }

  private decodeCursor(cursor: string | undefined): string | undefined {
    if (cursor === undefined) return undefined;
    try {
      const decoded = Buffer.from(cursor, "base64url").toString("utf8");
      if (Buffer.from(decoded, "utf8").toString("base64url") !== cursor || !isFullUnitId(decoded)) {
        throw new Error("invalid");
      }
      return decoded;
    } catch {
      throw new BadRequestException("cursor is invalid");
    }
  }

  private encodeCursor(unitId: string): string {
    return Buffer.from(unitId, "utf8").toString("base64url");
  }

  private async ensureFresh(projectId: string): Promise<void> {
    for (let attempt = 0; attempt < MAX_FRESHNESS_ATTEMPTS; attempt += 1) {
      const revision = await this.source.currentRevision(projectId);
      const indexed = await this.projections.indexRevision(projectId);
      if (sameTaskSourceRevision(indexed, revision)) return;

      const snapshot = await this.source.readProject(projectId, revision);
      if (
        snapshot.projectId !== projectId ||
        !sameTaskSourceRevision(snapshot, revision)
      ) {
        throw new ConflictException("The document repository returned an inconsistent task snapshot");
      }

      const beforeWrite = await this.source.currentRevision(projectId);
      if (!sameTaskSourceRevision(beforeWrite, revision)) continue;

      if (!await this.projections.replaceProject(snapshot, indexed)) continue;
      const afterWrite = await this.source.currentRevision(projectId);
      if (sameTaskSourceRevision(afterWrite, revision)) {
        const stored = await this.projections.indexRevision(projectId);
        if (sameTaskSourceRevision(stored, revision)) return;
      }
    }
    throw new ConflictException("The document repository changed while its task index was being refreshed");
  }

  private async readiness(record: IndexedMemberTask): Promise<ReadinessResult> {
    const requiredInputs = await Promise.all(record.requiredInputs.map(async (input) => {
      if (input.approval === "not-required") return input;
      const approval = await this.approvals.sourceApproval(record.projectId, inputPath(record, input.sourceId), record.sourceCommit);
      return { ...input, approval };
    }));

    const predecessorGates: PredecessorGate[] = await Promise.all(record.predecessorGates.map(async (gate) => ({
      ...gate,
      // Gate status is derived from evidence-bound records, never from unit-card frontmatter.
      status: await this.approvals.predecessorStatus(record.projectId, gateUnitId(record, gate), gate.gateId, record.sourceCommit),
    })));
    return evaluateReadiness({ workItem: record.workItem, requiredInputs, predecessorGates });
  }
}

function inputPath(record: IndexedMemberTask, sourceId: string): string {
  const source = record.sourceReferences.find((candidate) => candidate.sourceId === sourceId);
  if (source === undefined) throw new ConflictException("The task index is missing a required source reference");
  return source.path;
}

function gateUnitId(record: IndexedMemberTask, gate: PredecessorGate): string {
  return gate.unitId ?? record.unitId;
}
